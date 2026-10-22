import "server-only";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { cronFromDailyTime, isValidCron, nextCronRun } from "@/lib/cron";
import {
  uploadToOpenlist,
  testOpenlist,
  normalizeRemotePath,
  type OpenlistConfig,
} from "./openlist.client";
import {
  DEFAULT_BACKUP_SETTINGS,
  BACKUP_KEEP_MAX,
  BACKUP_KEEP_MIN,
  UPLOAD_LOG_MAX,
  formatBytes,
  type BackupCreateResult,
  type BackupFile,
  type BackupKind,
  type BackupListResult,
  type BackupRestoreResult,
  type BackupSettings,
  type BackupSettingsPatch,
  type BackupUploadResult,
  type OpenlistTestResult,
} from "./backup.types";

/**
 * 数据备份 / 恢复。
 *
 * 为什么备份是「拷一份 SQLite 文件」而不是导出 JSON：
 * 家具店的账是「流水推出来的」，单据、明细、批次、单件、流水之间有几十条外键。
 * 导出成 JSON 再导回来，一旦顺序或字段对不上，库存就会默默算错——这种错最难查。
 * 整库快照是唯一能保证「恢复完和备份那一刻一模一样」的做法。
 *
 * 三条硬规矩：
 * 1. **快照用 `VACUUM INTO`**：SQLite 自己把一致性快照写到新文件，
 *    不会拷到一半的页；失败才退回到「先 checkpoint 再 copyFile」。
 * 2. **手动备份永不参与轮转**：份数限制只作用于自动备份。
 *    手动备的那一份是出事后的唯一指望，谁也不能把它挤掉。
 * 3. **恢复前先给当前数据拍一张**：命名 `pre-restore-*`。导错了还能退回来。
 *
 * 目录跟着库文件走：`<库所在目录>/backups`，容器里就是 `/app/data/backups`
 * ——和 `suteng.db`、`uploads/` 在同一个挂载卷里，整卷备份/迁移一并带走。
 */

const FILE_RE = /^suteng-(auto|manual|pre-restore)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/;

/** 恢复过程中挡住其它备份动作（并发恢复会把库写坏） */
let restoring = false;

export function isRestoring(): boolean {
  return restoring;
}

/* ------------------------------------------------------------------ 路径 */

/**
 * 库文件的绝对路径。
 *
 * 注意相对路径的基准：Prisma 把 `file:xxx` 里的相对路径解析成**相对 schema 所在目录**
 * （也就是 `<项目>/prisma/`），不是相对 process.cwd()。
 * 本地 .env 写的是 `file:../data/suteng.db`，落到 `<项目>/data/suteng.db`。
 * 这里必须跟 Prisma 完全一致，否则备份会对着一个不存在的路径干活。
 * 容器里是绝对路径 `/app/data/suteng.db`，两种都覆盖。
 */
function dbFilePath(): string {
  const raw = env.DATABASE_URL.startsWith("file:") ? env.DATABASE_URL.slice(5) : env.DATABASE_URL;
  const clean = raw.split("?")[0] ?? raw;
  if (path.isAbsolute(clean)) return clean;
  return path.resolve(path.join(process.cwd(), "prisma"), clean);
}

export function backupDir(): string {
  const override = process.env.BACKUP_DIR?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
  }
  return path.join(path.dirname(dbFilePath()), "backups");
}

async function ensureDir(): Promise<string> {
  const dir = backupDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

function stamp(d: Date): string {
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function parseKind(name: string): BackupKind | null {
  const m = FILE_RE.exec(name);
  if (!m) return null;
  return m[1] as BackupKind;
}

/* ---------------------------------------------------------------- 设置项 */

const KEY = {
  enabled: "backup.enabled",
  cron: "backup.cron",
  /** v1 的老字段（每天 HH:mm）。只读，用来把老部署平滑升级成 cron */
  dailyTime: "backup.dailyTime",
  keepCount: "backup.keepCount",
  lastAutoAt: "backup.lastAutoAt",
  lastAutoError: "backup.lastAutoError",
  lastUploadAt: "backup.lastUploadAt",
  lastUploadError: "backup.lastUploadError",
  olEnabled: "backup.openlist.enabled",
  olUrl: "backup.openlist.url",
  olUser: "backup.openlist.username",
  olPassword: "backup.openlist.password",
  olToken: "backup.openlist.token",
  olRemote: "backup.openlist.remotePath",
  uploadLog: "backup.uploadLog",
} as const;

/** 上传记录：列表里靠它标「已上传」，也留最近一次失败原因给界面提示 */
type UploadRecord = { name: string; at: string; ok: boolean; error: string | null };

async function readSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
  return row?.value ?? null;
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: json },
    update: { value: json },
  });
}

function decode<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const SETTING_KEYS = Object.values(KEY) as string[];

async function readAllSettings(): Promise<Map<string, string>> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: SETTING_KEYS } },
    select: { key: true, value: true },
  });
  return new Map(rows.map((r) => [r.key, r.value]));
}

function str(map: Map<string, string>, key: string, fallback = ""): string {
  const v = decode<unknown>(map.get(key) ?? null, fallback);
  return typeof v === "string" ? v : fallback;
}

/** 内部用：带明文的网盘配置。只在服务端流转，接口永远不返回密码与令牌 */
async function loadOpenlistConfig(): Promise<{ cfg: OpenlistConfig; enabled: boolean }> {
  const map = await readAllSettings();
  return {
    enabled: decode<boolean>(map.get(KEY.olEnabled) ?? null, false) === true,
    cfg: {
      url: str(map, KEY.olUrl),
      username: str(map, KEY.olUser),
      password: str(map, KEY.olPassword),
      token: str(map, KEY.olToken),
      remotePath: normalizeRemotePath(str(map, KEY.olRemote)),
    },
  };
}

/* ------------------------------------------------------------ 快照与列表 */

async function readFiles(): Promise<BackupFile[]> {
  const dir = backupDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const files: BackupFile[] = [];
  for (const name of names) {
    const kind = parseKind(name);
    if (!kind) continue;
    try {
      const s = await stat(path.join(dir, name));
      if (!s.isFile()) continue;
      files.push({
        name,
        kind,
        sizeBytes: s.size,
        // 用文件修改时间，比文件名里的秒更贴近「真的什么时候落的盘」
        createdAt: s.mtime.toISOString(),
        pinned: kind !== "auto",
        uploadedAt: null,
      });
    } catch {
      // 文件在扫描时被删掉了，跳过
    }
  }

  files.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return files;
}

async function readUploadLog(): Promise<UploadRecord[]> {
  const raw = await readSetting(KEY.uploadLog);
  const list = decode<UploadRecord[]>(raw, []);
  return Array.isArray(list) ? list.filter((r) => r && typeof r.name === "string") : [];
}

/** name → 最后一次**成功**上传的记录 */
async function uploadedIndex(): Promise<Map<string, UploadRecord>> {
  const map = new Map<string, UploadRecord>();
  for (const r of await readUploadLog()) {
    if (r.ok) map.set(r.name, r);
  }
  return map;
}

async function appendUploadLog(rec: UploadRecord): Promise<void> {
  const list = await readUploadLog();
  const next = [rec, ...list.filter((r) => r.name !== rec.name)].slice(0, UPLOAD_LOG_MAX);
  await Promise.all([
    writeSetting(KEY.uploadLog, next),
    writeSetting(KEY.lastUploadAt, rec.at),
    writeSetting(KEY.lastUploadError, rec.ok ? null : rec.error),
  ]);
}

/** 拍一张快照。`VACUUM INTO` 由 SQLite 自己保证一致性，失败再退回普通拷贝。 */
async function snapshot(kind: BackupKind): Promise<{ file: BackupFile; abs: string }> {
  const dir = await ensureDir();
  const now = new Date();
  const name = `suteng-${kind}-${stamp(now)}.db`;
  const abs = path.join(dir, name);

  // 同一秒内连点两次会撞名，撞了就往后退一秒，别覆盖已有备份
  let finalName = name;
  let finalAbs = abs;
  let seq = 0;
  while (await exists(finalAbs)) {
    seq += 1;
    const later = new Date(now.getTime() + seq * 1000);
    finalName = `suteng-${kind}-${stamp(later)}.db`;
    finalAbs = path.join(dir, finalName);
  }

  try {
    // SQLite 要求路径里的单引号翻倍；Windows 的反斜杠换成斜杠更稳
    const sqlPath = finalAbs.replace(/\\/g, "/").replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${sqlPath}'`);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "VACUUM INTO failed, falling back to file copy");
    // 退路：先把 WAL 并回主库，再整文件拷。并发写入时理论上可能拷到中间态，
    // 但对小团队的单机部署，这个窗口只有毫秒级，比没有备份好得多。
    await prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)").catch(() => undefined);
    await rm(finalAbs, { force: true });
    await copyFile(dbFilePath(), finalAbs);
  }

  const s = await stat(finalAbs);
  return {
    abs: finalAbs,
    file: {
      name: finalName,
      kind,
      sizeBytes: s.size,
      createdAt: s.mtime.toISOString(),
      pinned: kind !== "auto",
      uploadedAt: null,
    },
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 轮转：只删最旧的**自动**备份，手动与恢复前快照一律不动 */
async function rotate(keepCount: number): Promise<string[]> {
  const keep = Math.min(BACKUP_KEEP_MAX, Math.max(BACKUP_KEEP_MIN, keepCount));
  const files = await readFiles();
  const autos = files.filter((f) => f.kind === "auto");
  if (autos.length <= keep) return [];

  const doomed = autos.slice(keep);
  const dir = backupDir();
  const removed: string[] = [];
  for (const f of doomed) {
    try {
      await rm(path.join(dir, f.name), { force: true });
      removed.push(f.name);
    } catch (err) {
      logger.warn({ err: (err as Error).message, name: f.name }, "failed to remove old auto backup");
    }
  }
  return removed;
}

/** 把一份本地备份传到网盘。没开网盘就返回 null（表示「这件事根本没发生」） */
async function uploadOne(name: string): Promise<BackupUploadResult | null> {
  const { enabled, cfg } = await loadOpenlistConfig();
  if (!enabled) return null;

  try {
    const outcome = await uploadToOpenlist(cfg, path.join(backupDir(), name), name);
    await appendUploadLog({ name, at: new Date().toISOString(), ok: true, error: null });
    return { ok: true, name, remotePath: outcome.remotePath, error: null };
  } catch (err) {
    const message = (err as Error).message || "上传失败";
    await appendUploadLog({ name, at: new Date().toISOString(), ok: false, error: message });
    logger.error({ name, err: message }, "openlist upload failed");
    return { ok: false, name, remotePath: null, error: message };
  }
}

function stampUpload(file: BackupFile, upload: BackupUploadResult | null): BackupFile {
  return upload?.ok ? { ...file, uploadedAt: new Date().toISOString() } : file;
}

/* ------------------------------------------------------------------ 服务 */

export const backupService = {
  async list(): Promise<BackupListResult> {
    const [files, settings, uploaded] = await Promise.all([
      readFiles(),
      backupService.getSettings(),
      uploadedIndex(),
    ]);

    const items = files.map((f) => {
      const hit = uploaded.get(f.name);
      return hit ? { ...f, uploadedAt: hit.at } : f;
    });

    return {
      settings,
      items,
      dir: backupDir(),
      totalBytes: items.reduce((sum, f) => sum + f.sizeBytes, 0),
      autoCount: items.filter((f) => f.kind === "auto").length,
      manualCount: items.filter((f) => f.pinned).length,
    };
  },

  async getSettings(): Promise<BackupSettings> {
    const map = await readAllSettings();

    // cron 是 v2 才有的：老库里只有 dailyTime，升级时等价转换一次（不写库，只影响读数）
    let cron = str(map, KEY.cron);
    if (!cron) {
      const legacy = str(map, KEY.dailyTime);
      cron = (legacy ? cronFromDailyTime(legacy) : null) ?? DEFAULT_BACKUP_SETTINGS.cron;
    }
    if (!isValidCron(cron)) cron = DEFAULT_BACKUP_SETTINGS.cron;

    const next = nextCronRun(cron, new Date());

    return {
      enabled: decode<boolean>(map.get(KEY.enabled) ?? null, DEFAULT_BACKUP_SETTINGS.enabled) === true,
      cron,
      keepCount: Number(decode(map.get(KEY.keepCount) ?? null, DEFAULT_BACKUP_SETTINGS.keepCount)),
      lastAutoAt: decode<string | null>(map.get(KEY.lastAutoAt) ?? null, null),
      lastAutoError: decode<string | null>(map.get(KEY.lastAutoError) ?? null, null),
      nextRunAt: next ? next.toISOString() : null,
      lastUploadAt: decode<string | null>(map.get(KEY.lastUploadAt) ?? null, null),
      lastUploadError: decode<string | null>(map.get(KEY.lastUploadError) ?? null, null),
      openlist: {
        enabled: decode<boolean>(map.get(KEY.olEnabled) ?? null, false) === true,
        url: str(map, KEY.olUrl),
        username: str(map, KEY.olUser),
        remotePath: str(map, KEY.olRemote),
        passwordSet: str(map, KEY.olPassword).length > 0,
        tokenSet: str(map, KEY.olToken).length > 0,
      },
    };
  },

  async saveSettings(patch: BackupSettingsPatch, actor: { userId: string }): Promise<BackupSettings> {
    const current = await backupService.getSettings();

    const enabled = patch.enabled ?? current.enabled;
    const cron = (patch.cron ?? current.cron).trim();
    const keepCount = patch.keepCount ?? current.keepCount;

    const ol = patch.openlist ?? {};
    const nextOl = {
      enabled: ol.enabled ?? current.openlist.enabled,
      url: (ol.url ?? current.openlist.url).trim().replace(/\/+$/, ""),
      username: (ol.username ?? current.openlist.username).trim(),
      remotePath: normalizeRemotePath(ol.remotePath ?? current.openlist.remotePath),
    };

    const writes: Promise<void>[] = [
      writeSetting(KEY.enabled, enabled),
      writeSetting(KEY.cron, cron),
      writeSetting(KEY.keepCount, keepCount),
      writeSetting(KEY.olEnabled, nextOl.enabled),
      writeSetting(KEY.olUrl, nextOl.url),
      writeSetting(KEY.olUser, nextOl.username),
      writeSetting(KEY.olRemote, nextOl.remotePath),
    ];

    // 密码 / 令牌留空 = 沿用已存的（前端永远拿不到明文，也就不可能回填）
    if (ol.password) writes.push(writeSetting(KEY.olPassword, ol.password));
    if (ol.token) writes.push(writeSetting(KEY.olToken, ol.token));

    await Promise.all(writes);

    await audit(
      actor.userId,
      "backup.settings",
      `备份设置改为：${enabled ? "开启" : "关闭"} · ${cron} · 保留 ${keepCount} 份 · 网盘上传${
        nextOl.enabled ? `开启（${nextOl.remotePath || "未填目录"}）` : "关闭"
      }`,
    );

    // 关掉定时备份时不动定时器：定时器每分钟读一次设置，关了就自己跳过
    return backupService.getSettings();
  },

  /** 手动备份：不参与轮转，攒多少留多少（要清理由人来点删除） */
  async createManual(actor: { userId: string }): Promise<BackupCreateResult> {
    if (restoring) throw new ConflictError("正在恢复数据，等它跑完再备份");

    const { file } = await snapshot("manual");
    const upload = await uploadOne(file.name);

    await audit(
      actor.userId,
      "backup.manual",
      `手动备份「${file.name}」（${formatBytes(file.sizeBytes)}）${
        upload ? (upload.ok ? "，已上传网盘" : `，上传网盘失败：${upload.error}`) : ""
      }`,
    );
    return { file: stampUpload(file, upload), removed: [], upload };
  },

  /** 定时备份：拍完按份数轮转，并记下这次的完成时间 */
  async runScheduled(): Promise<BackupCreateResult> {
    if (restoring) throw new ConflictError("正在恢复数据，跳过本次定时备份");

    const settings = await backupService.getSettings();
    try {
      const { file } = await snapshot("auto");
      const removed = await rotate(settings.keepCount);
      const upload = await uploadOne(file.name);

      await Promise.all([
        writeSetting(KEY.lastAutoAt, new Date().toISOString()),
        writeSetting(KEY.lastAutoError, null),
      ]);
      await audit(
        null,
        "backup.auto",
        `定时备份「${file.name}」（${formatBytes(file.sizeBytes)}）${
          removed.length > 0 ? `，轮转清掉 ${removed.length} 份旧备份` : ""
        }${upload ? (upload.ok ? "，已上传网盘" : `，上传网盘失败：${upload.error}`) : ""}`,
      );
      return { file: stampUpload(file, upload), removed, upload };
    } catch (err) {
      const message = (err as Error).message || "未知错误";
      await Promise.all([
        writeSetting(KEY.lastAutoAt, new Date().toISOString()),
        writeSetting(KEY.lastAutoError, message),
      ]);
      throw err;
    }
  },

  /** 手动把某一份补传到网盘（网络恢复之后重新传，不用再备一份） */
  async uploadByName(name: string, actor: { userId: string }): Promise<BackupUploadResult> {
    const files = await readFiles();
    if (!files.some((f) => f.name === name)) {
      throw new NotFoundError("找不到这个备份文件，可能已经被删掉了");
    }

    const result = await uploadOne(name);
    if (!result) {
      throw new ValidationError("网盘上传还没开启，先在设置里打开并填好地址与目录");
    }

    await audit(
      actor.userId,
      "backup.upload",
      `手动上传备份「${name}」到网盘${result.ok ? "：成功" : `失败：${result.error}`}`,
    );
    if (!result.ok) throw new ConflictError(`上传失败：${result.error}`);
    return result;
  },

  /** 测试连接：允许用界面上还没保存的那套参数直接试 */
  async testOpenlist(input: {
    url?: string;
    username?: string;
    password?: string;
    token?: string;
    remotePath?: string;
  }): Promise<OpenlistTestResult> {
    const saved = await loadOpenlistConfig();
    const cfg: OpenlistConfig = {
      url: (input.url ?? saved.cfg.url).trim(),
      username: (input.username ?? saved.cfg.username).trim(),
      password: input.password ? input.password : saved.cfg.password,
      token: input.token ? input.token : saved.cfg.token,
      remotePath: normalizeRemotePath(input.remotePath ?? saved.cfg.remotePath),
    };
    return testOpenlist(cfg);
  },

  async remove(name: string, actor: { userId: string }): Promise<void> {
    if (restoring) throw new ConflictError("正在恢复数据，等它跑完再操作");

    const files = await readFiles();
    const target = files.find((f) => f.name === name);
    if (!target) throw new NotFoundError("找不到这个备份文件，可能已经被删掉了");

    await rm(path.join(backupDir(), name), { force: true });
    await audit(actor.userId, "backup.delete", `删除备份「${name}」`);
  },

  /** 下载用的绝对路径（调用方负责流式返回） */
  async resolveForDownload(name: string): Promise<{ abs: string; size: number }> {
    if (!parseKind(name)) throw new ValidationError("备份文件名不合法");
    const abs = path.join(backupDir(), name);
    if (path.dirname(path.resolve(abs)) !== path.resolve(backupDir())) {
      throw new ValidationError("备份文件名不合法");
    }
    try {
      const s = await stat(abs);
      if (!s.isFile()) throw new Error("not a file");
      return { abs, size: s.size };
    } catch {
      throw new NotFoundError("找不到这个备份文件");
    }
  },

  /**
   * 从上传的 .db 恢复。
   * 这是唯一会**替换整个数据库**的操作，所以每一步都先验证再动手，
   * 而且动手之前一定先给当前数据拍一张 `pre-restore` 快照。
   */
  async restore(buf: Buffer, originalName: string, actor: { userId: string }): Promise<BackupRestoreResult> {
    if (restoring) throw new ConflictError("已经有一个恢复任务在跑了，等它完成");
    restoring = true;

    const dir = await ensureDir();
    const tmp = path.join(dir, `incoming-${Date.now()}.tmp`);

    try {
      // 1) 只认 SQLite 文件头：防止把图片、Excel 传上来直接覆盖库
      if (buf.length < 4096 || buf.subarray(0, 15).toString("latin1") !== "SQLite format 3") {
        throw new ValidationError(
          "这个文件不是 SQLite 数据库。请上传本系统「手动备份 / 定时备份」下载下来的 .db 文件",
        );
      }

      await writeFile(tmp, buf);

      // 2) 用独立连接打开它：能读出表、能数出行，才算是一份能用的备份
      const counts = await probeBackup(tmp);

      // 3) 迁移差异要在替换前算好（算在旧库上没意义）
      const pendingMigrations = await pendingMigrationsOf(tmp);

      // 4) 先给现在这份数据拍张保命照，导错了还能退回来
      let safetyBackup: string | null = null;
      try {
        const { file } = await snapshot("pre-restore");
        safetyBackup = file.name;
      } catch (err) {
        // 保命照拍不出来就别硬上，数据只有一个，不能赌
        throw new ConflictError(
          `恢复前没能给当前数据拍快照（${(err as Error).message}），为了安全先不恢复。请先手动备份一次再试`,
        );
      }

      // 5) 换库：断开连接 → 覆盖文件 → 清掉 WAL/SHM（旧库的日志不能留给新库）
      const dbPath = dbFilePath();
      await prisma.$disconnect();
      await copyFile(tmp, dbPath);
      for (const suffix of ["-wal", "-shm"]) {
        await rm(`${dbPath}${suffix}`, { force: true });
      }

      // 6) 冒烟：能查就算通了；查不动说明表结构和当前代码对不上，让运维重启
      const needsRestart = pendingMigrations.length > 0 || !(await smokeTest());

      await audit(
        actor.userId,
        "backup.restore",
        `【管理员恢复数据】用「${originalName}」覆盖当前库；恢复前快照 ${safetyBackup ?? "无"}${
          needsRestart ? `；缺少迁移 ${pendingMigrations.length} 个，需重启服务补表结构` : ""
        }`,
      );

      return { from: originalName, safetyBackup, pendingMigrations, needsRestart, counts };
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined);
      restoring = false;
    }
  },
};

/* ------------------------------------------------------------------ 工具 */

async function probeBackup(file: string): Promise<BackupRestoreResult["counts"]> {
  const url = `file:${file.replace(/\\/g, "/")}`;
  const probe = new PrismaClient({ datasourceUrl: url });
  try {
    const tables = await probe.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    const names = new Set(tables.map((t) => t.name));
    for (const required of ["products", "documents", "users", "stock_movements"]) {
      if (!names.has(required)) {
        throw new ValidationError(
          `这份文件里找不到 ${required} 表，不像是本系统的数据库。请确认上传的是本系统的备份`,
        );
      }
    }

    const [products, documents, movements, users] = await Promise.all([
      probe.product.count(),
      probe.document.count(),
      probe.stockMovement.count(),
      probe.user.count(),
    ]);

    // 空库也允许恢复（就是想清空数据），但至少得是个结构完整的库
    return { products, documents, movements, users };
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(`备份文件打不开或已损坏：${(err as Error).message}`);
  } finally {
    await probe.$disconnect().catch(() => undefined);
  }
}

/** 备份里已应用的迁移 vs 当前代码里的迁移：差集就是「这份备份来自更早的版本」 */
async function pendingMigrationsOf(file: string): Promise<string[]> {
  const local = await localMigrations();
  if (local.length === 0) return [];

  const probe = new PrismaClient({ datasourceUrl: `file:${file.replace(/\\/g, "/")}` });
  let applied = new Set<string>();
  try {
    const rows = await probe.$queryRawUnsafe<{ migration_name: string }[]>(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL",
    );
    applied = new Set(rows.map((r) => r.migration_name));
  } catch {
    // 连迁移表都没有：当作全都没跑过
    return local;
  } finally {
    await probe.$disconnect().catch(() => undefined);
  }

  return local.filter((name) => !applied.has(name));
}

async function localMigrations(): Promise<string[]> {
  try {
    const dir = path.join(process.cwd(), "prisma", "migrations");
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** 换库之后试一下当前代码最关心的列能不能读——读不出来就说明表结构旧了 */
async function smokeTest(): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe("SELECT passwordChangedAt FROM users LIMIT 1");
    await prisma.$queryRawUnsafe("SELECT disposition FROM document_items LIMIT 1");
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "restore smoke test failed: schema may be older");
    return false;
  }
}

async function audit(userId: string | null, action: string, summary: string): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { userId, action, entityType: "backup", summary },
    });
  } catch {
    // 审计写失败不能把已经备完的数据回滚掉
  }
}
