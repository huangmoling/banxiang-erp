import "server-only";
import { copyFile, mkdir, open, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { isImageFile, uploadDir } from "@/lib/upload-dir";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { cronFromDailyTime, isValidCron, nextCronRun } from "@/lib/cron";
import {
  defaultRemoteUrl,
  normalizeRemotePathFor,
  testRemote as testRemoteStorage,
  uploadToRemote as uploadToRemoteStorage,
  type RemoteConfig,
} from "./remote";
import { extractTar, looksLikeTar, writeTar, type TarSource } from "./tar";
import {
  DEFAULT_BACKUP_SETTINGS,
  BACKUP_KEEP_MAX,
  BACKUP_KEEP_MIN,
  FILE_INFO_MAX,
  REMOTE_PROVIDER_LABEL,
  UPLOAD_LOG_MAX,
  formatBytes,
  type BackupCreateResult,
  type BackupFile,
  type BackupFormat,
  type BackupKind,
  type BackupListResult,
  type BackupRestoreResult,
  type BackupSettings,
  type BackupSettingsPatch,
  type BackupUploadResult,
  type RemoteProvider,
  type RemoteTestResult,
} from "./backup.types";

/**
 * 数据备份 / 恢复。
 *
 * 为什么备份是「拷一份 SQLite 文件」而不是导出 JSON：
 * 包包店的账是「流水推出来的」，单据、明细、批次、单件、流水之间有几十条外键。
 * 导出成 JSON 再导回来，一旦顺序或字段对不上，库存就会默默算错——这种错最难查。
 * 整库快照是唯一能保证「恢复完和备份那一刻一模一样」的做法。
 *
 * 为什么从 v1.5 起改成 tar（库 + 图片）：
 * 只备库不备图，一旦换机器/整卷丢了再恢复，商品图全部 404——
 * 数据库里存的是 `/api/files/<uuid>.jpg`，文件没了就是破图，账是对的但看着全是错的。
 * tar 里放三样：`suteng.db`、`uploads/`（全部商品图）、`manifest.json`（清单，便于人工排查）。
 * 不压缩：图片本来就压过，tar 还能用 7-Zip 直接打开看。
 *
 * 四条硬规矩：
 * 1. **快照用 `VACUUM INTO`**：SQLite 自己把一致性快照写到新文件，
 *    不会拷到一半的页；失败才退回到「先 checkpoint 再 copyFile」。
 * 2. **手动备份永不参与轮转**：份数限制只作用于自动备份。
 *    手动备的那一份是出事后的唯一指望，谁也不能把它挤掉。
 * 3. **恢复前先给当前数据拍一张**（`pre-restore-*`，同样含图片）。导错了还能退回来。
 * 4. **图片只合并不删除**：恢复进来的图按文件名补齐，已存在的同名图不重复写。
 *    永远不删当前目录里的图——宁可多几个孤儿文件，也不能删掉还有人在引用的图。
 *
 * 目录跟着库文件走：`<库所在目录>/backups`，容器里就是 `/app/data/backups`
 * ——和 `suteng.db`、`uploads/` 在同一个挂载卷里，整卷备份/迁移一并带走。
 */

/**
 * 备份文件名。新包用 `banxiang-`，老的 `suteng-` 包**继续认**——
 * 云端和本地目录里已经躺着几十个老包，不认等于把历史备份全废掉。
 * 前缀是非捕获组，后面的分组下标（m[1] kind、m[8] 格式）保持不变。
 */
const FILE_RE = /^(?:suteng|banxiang)-(auto|manual|pre-restore)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.(tar|db)$/;

/** 新备份的命名前缀（品牌更名后）。改这里就等于改所有新包的文件名。 */
const NAME_PREFIX = "banxiang";

/** 解除 tar 里图片文件的扩展名白名单（与上传接口一致） */
const MANIFEST_NAME = "manifest.json";
const DB_ENTRY = "suteng.db";

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

function parseFormat(name: string): BackupFormat | null {
  const m = FILE_RE.exec(name);
  if (!m) return null;
  return m[8] === "tar" ? "tar" : "db";
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
  /**
   * 云端存储的键名沿用 `backup.openlist.*`：
   * 老部署里已经存了地址、账号、密码，改键名等于让所有人重新配一遍。
   * 只有「用哪家」是新加的一个键。
   */
  rmEnabled: "backup.openlist.enabled",
  rmProvider: "backup.remote.provider",
  rmUrl: "backup.openlist.url",
  rmUser: "backup.openlist.username",
  rmPassword: "backup.openlist.password",
  rmToken: "backup.openlist.token",
  rmRemote: "backup.openlist.remotePath",
  uploadLog: "backup.uploadLog",
  fileInfo: "backup.fileInfo",
} as const;

/** 上传记录：列表里靠它标「已上传」，也留最近一次失败原因给界面提示 */
type UploadRecord = { name: string; at: string; ok: boolean; error: string | null };

/** 单个备份包的附加信息（带几张图、库里多大），给列表用，避免每次都去解包 */
type FileInfo = { images: number | null; dbBytes: number | null };

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

function providerOf(raw: string): RemoteProvider {
  return raw === "jianguoyun" ? "jianguoyun" : "openlist";
}

/** 内部用：带明文的云端配置。只在服务端流转，接口永远不返回密码与令牌 */
async function loadRemoteConfig(): Promise<{ cfg: RemoteConfig; enabled: boolean }> {
  const map = await readAllSettings();
  const provider = providerOf(str(map, KEY.rmProvider));
  return {
    enabled: decode<boolean>(map.get(KEY.rmEnabled) ?? null, false) === true,
    cfg: {
      provider,
      url: str(map, KEY.rmUrl),
      username: str(map, KEY.rmUser),
      password: str(map, KEY.rmPassword),
      token: str(map, KEY.rmToken),
      remotePath: normalizeRemotePathFor(provider, str(map, KEY.rmRemote)),
    },
  };
}

/* ------------------------------------------------------ 图片与文件清单 */

type ImageFile = { name: string; abs: string; mtime: Date };

/** 图片目录里现有的全部商品图。目录不存在时返回空数组（还没传过图的新部署） */
async function listImages(): Promise<ImageFile[]> {
  const dir = uploadDir();
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: ImageFile[] = [];

  for (const name of names) {
    if (!isImageFile(name)) continue;
    const abs = path.join(dir, name);
    const s = await stat(abs).catch(() => null);
    if (!s?.isFile()) continue;
    out.push({ name, abs, mtime: s.mtime });
  }

  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}

async function readFileInfo(): Promise<Map<string, FileInfo>> {
  const raw = await readSetting(KEY.fileInfo);
  const obj = decode<Record<string, FileInfo>>(raw, {});
  const map = new Map<string, FileInfo>();
  if (!obj || typeof obj !== "object") return map;
  for (const [name, info] of Object.entries(obj)) {
    if (!info || typeof info !== "object") continue;
    map.set(name, {
      images: typeof info.images === "number" ? info.images : null,
      dbBytes: typeof info.dbBytes === "number" ? info.dbBytes : null,
    });
  }
  return map;
}

async function rememberFileInfo(name: string, info: FileInfo): Promise<void> {
  const map = await readFileInfo();
  map.set(name, info);
  // 只留最近登记的若干条，免得这个键无限长大
  const entries = [...map.entries()].slice(-FILE_INFO_MAX);
  await writeSetting(KEY.fileInfo, Object.fromEntries(entries));
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

  const info = await readFileInfo();
  const files: BackupFile[] = [];

  for (const name of names) {
    const kind = parseKind(name);
    const format = parseFormat(name);
    if (!kind || !format) continue;
    try {
      const s = await stat(path.join(dir, name));
      if (!s.isFile()) continue;
      const extra = info.get(name);
      files.push({
        name,
        kind,
        format,
        sizeBytes: s.size,
        // 用文件修改时间，比文件名里的秒更贴近「真的什么时候落的盘」
        createdAt: s.mtime.toISOString(),
        pinned: kind !== "auto",
        uploadedAt: null,
        imageCount: extra?.images ?? null,
        dbBytes: extra?.dbBytes ?? null,
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

/** 把当前库写成一份一致性快照文件（`VACUUM INTO`，失败退回整文件拷贝） */
async function snapshotDb(target: string): Promise<void> {
  try {
    // SQLite 要求路径里的单引号翻倍；Windows 的反斜杠换成斜杠更稳
    const sqlPath = target.replace(/\\/g, "/").replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${sqlPath}'`);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "VACUUM INTO failed, falling back to file copy");
    // 退路：先把 WAL 并回主库，再整文件拷。并发写入时理论上可能拷到中间态，
    // 但对小团队的单机部署，这个窗口只有毫秒级，比没有备份好得多。
    await prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)").catch(() => undefined);
    await rm(target, { force: true });
    await copyFile(dbFilePath(), target);
  }
}

/**
 * 拍一份备份包：库 + 全部商品图 + 清单。
 * 库里那部分先落到临时文件，打完包立刻删掉，备份目录里只留 .tar。
 */
async function createArchive(kind: BackupKind): Promise<{ file: BackupFile; abs: string }> {
  const dir = await ensureDir();
  const now = new Date();

  let finalName = `${NAME_PREFIX}-${kind}-${stamp(now)}.tar`;
  let finalAbs = path.join(dir, finalName);
  let seq = 0;
  // 同一秒内连点两次会撞名，撞了就往后退一秒，别覆盖已有备份
  while (await exists(finalAbs)) {
    seq += 1;
    finalName = `${NAME_PREFIX}-${kind}-${stamp(new Date(now.getTime() + seq * 1000))}.tar`;
    finalAbs = path.join(dir, finalName);
  }

  const tmpDb = path.join(dir, `.snapshot-${stamp(now)}-${process.pid}.db`);

  try {
    await snapshotDb(tmpDb);
    const dbBytes = (await stat(tmpDb)).size;
    const images = await listImages();

    const manifest = {
      app: "半巷设计 ERP",
      format: 2,
      createdAt: now.toISOString(),
      dbBytes,
      images: images.length,
    };

    const sources: TarSource[] = [
      // 清单放最前面：拿 7-Zip 打开先看到这一份，就知道包里有什么
      { name: MANIFEST_NAME, data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), mtime: now },
      { name: DB_ENTRY, absPath: tmpDb, mtime: now },
      ...images.map((img) => ({ name: `uploads/${img.name}`, absPath: img.abs, mtime: img.mtime })),
    ];

    await writeTar(finalAbs, sources);
    const s = await stat(finalAbs);

    await rememberFileInfo(finalName, { images: images.length, dbBytes });

    return {
      abs: finalAbs,
      file: {
        name: finalName,
        kind,
        format: "tar",
        sizeBytes: s.size,
        createdAt: s.mtime.toISOString(),
        pinned: kind !== "auto",
        uploadedAt: null,
        imageCount: images.length,
        dbBytes,
      },
    };
  } catch (err) {
    // 半截包比没有包更危险：看着有、恢复时才发现坏的
    await rm(finalAbs, { force: true }).catch(() => undefined);
    throw err;
  } finally {
    await rm(tmpDb, { force: true }).catch(() => undefined);
  }
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

/** 把一份本地备份传到云端。没开云端就返回 null（表示「这件事根本没发生」） */
async function uploadOne(name: string): Promise<BackupUploadResult | null> {
  const { enabled, cfg } = await loadRemoteConfig();
  if (!enabled) return null;

  try {
    const outcome = await uploadToRemoteStorage(cfg, path.join(backupDir(), name), name);
    await appendUploadLog({ name, at: new Date().toISOString(), ok: true, error: null });
    return { ok: true, name, remotePath: outcome.remotePath, error: null };
  } catch (err) {
    const message = (err as Error).message || "上传失败";
    await appendUploadLog({ name, at: new Date().toISOString(), ok: false, error: message });
    logger.error({ name, provider: cfg.provider, err: message }, "remote upload failed");
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
    const provider = providerOf(str(map, KEY.rmProvider));

    return {
      enabled: decode<boolean>(map.get(KEY.enabled) ?? null, DEFAULT_BACKUP_SETTINGS.enabled) === true,
      cron,
      keepCount: Number(decode(map.get(KEY.keepCount) ?? null, DEFAULT_BACKUP_SETTINGS.keepCount)),
      lastAutoAt: decode<string | null>(map.get(KEY.lastAutoAt) ?? null, null),
      lastAutoError: decode<string | null>(map.get(KEY.lastAutoError) ?? null, null),
      nextRunAt: next ? next.toISOString() : null,
      lastUploadAt: decode<string | null>(map.get(KEY.lastUploadAt) ?? null, null),
      lastUploadError: decode<string | null>(map.get(KEY.lastUploadError) ?? null, null),
      remote: {
        enabled: decode<boolean>(map.get(KEY.rmEnabled) ?? null, false) === true,
        provider,
        url: str(map, KEY.rmUrl),
        username: str(map, KEY.rmUser),
        remotePath: str(map, KEY.rmRemote),
        passwordSet: str(map, KEY.rmPassword).length > 0,
        tokenSet: str(map, KEY.rmToken).length > 0,
      },
      imageDir: uploadDir(),
    };
  },

  async saveSettings(patch: BackupSettingsPatch, actor: { userId: string }): Promise<BackupSettings> {
    const current = await backupService.getSettings();

    const enabled = patch.enabled ?? current.enabled;
    const cron = (patch.cron ?? current.cron).trim();
    const keepCount = patch.keepCount ?? current.keepCount;

    const rm = patch.remote ?? {};
    const provider = rm.provider ?? current.remote.provider;
    const nextRemote = {
      enabled: rm.enabled ?? current.remote.enabled,
      provider,
      // 坚果云的地址是固定的，切过去没填就给默认值，省得用户自己查
      url: (rm.url ?? current.remote.url).trim().replace(/\/+$/, "") || defaultRemoteUrl(provider),
      username: (rm.username ?? current.remote.username).trim(),
      remotePath: normalizeRemotePathFor(provider, rm.remotePath ?? current.remote.remotePath),
    };

    const writes: Promise<void>[] = [
      writeSetting(KEY.enabled, enabled),
      writeSetting(KEY.cron, cron),
      writeSetting(KEY.keepCount, keepCount),
      writeSetting(KEY.rmEnabled, nextRemote.enabled),
      writeSetting(KEY.rmProvider, nextRemote.provider),
      writeSetting(KEY.rmUrl, nextRemote.url),
      writeSetting(KEY.rmUser, nextRemote.username),
      writeSetting(KEY.rmRemote, nextRemote.remotePath),
    ];

    // 密码 / 令牌留空 = 沿用已存的（前端永远拿不到明文，也就不可能回填）
    if (rm.password) writes.push(writeSetting(KEY.rmPassword, rm.password));
    if (rm.token) writes.push(writeSetting(KEY.rmToken, rm.token));

    await Promise.all(writes);

    await audit(
      actor.userId,
      "backup.settings",
      `备份设置改为：${enabled ? "开启" : "关闭"} · ${cron} · 保留 ${keepCount} 份 · ${REMOTE_PROVIDER_LABEL[nextRemote.provider]}${
        nextRemote.enabled ? `上传开启（${nextRemote.remotePath || "未填目录"}）` : "上传关闭"
      }`,
    );

    // 关掉定时备份时不动定时器：定时器每分钟读一次设置，关了就自己跳过
    return backupService.getSettings();
  },

  /** 手动备份：不参与轮转，攒多少留多少（要清理由人来点删除） */
  async createManual(actor: { userId: string }): Promise<BackupCreateResult> {
    if (restoring) throw new ConflictError("正在恢复数据，等它跑完再备份");

    const { file } = await createArchive("manual");
    const upload = await uploadOne(file.name);

    await audit(
      actor.userId,
      "backup.manual",
      `手动备份「${file.name}」（库 + ${file.imageCount ?? 0} 张图，共 ${formatBytes(file.sizeBytes)}）${
        upload ? (upload.ok ? "，已上传云端" : `，上传云端失败：${upload.error}`) : ""
      }`,
    );
    return { file: stampUpload(file, upload), removed: [], upload };
  },

  /** 定时备份：拍完按份数轮转，并记下这次的完成时间 */
  async runScheduled(): Promise<BackupCreateResult> {
    if (restoring) throw new ConflictError("正在恢复数据，跳过本次定时备份");

    const settings = await backupService.getSettings();
    try {
      const { file } = await createArchive("auto");
      const removed = await rotate(settings.keepCount);
      const upload = await uploadOne(file.name);

      await Promise.all([
        writeSetting(KEY.lastAutoAt, new Date().toISOString()),
        writeSetting(KEY.lastAutoError, null),
      ]);
      await audit(
        null,
        "backup.auto",
        `定时备份「${file.name}」（库 + ${file.imageCount ?? 0} 张图，共 ${formatBytes(file.sizeBytes)}）${
          removed.length > 0 ? `，轮转清掉 ${removed.length} 份旧备份` : ""
        }${upload ? (upload.ok ? "，已上传云端" : `，上传云端失败：${upload.error}`) : ""}`,
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

  /** 手动把某一份补传到云端（网络恢复之后重新传，不用再备一份） */
  async uploadByName(name: string, actor: { userId: string }): Promise<BackupUploadResult> {
    const files = await readFiles();
    if (!files.some((f) => f.name === name)) {
      throw new NotFoundError("找不到这个备份文件，可能已经被删掉了");
    }

    const result = await uploadOne(name);
    if (!result) {
      throw new ValidationError("云端上传还没开启，先在设置里打开并填好地址与目录");
    }

    await audit(
      actor.userId,
      "backup.upload",
      `手动上传备份「${name}」到云端${result.ok ? "：成功" : `失败：${result.error}`}`,
    );
    if (!result.ok) throw new ConflictError(`上传失败：${result.error}`);
    return result;
  },

  /** 测试连接：允许用界面上还没保存的那套参数直接试 */
  async testRemote(input: {
    provider?: RemoteProvider;
    url?: string;
    username?: string;
    password?: string;
    token?: string;
    remotePath?: string;
  }): Promise<RemoteTestResult> {
    const saved = await loadRemoteConfig();
    const provider = input.provider ?? saved.cfg.provider;
    const cfg: RemoteConfig = {
      provider,
      url: (input.url ?? saved.cfg.url).trim() || defaultRemoteUrl(provider),
      username: (input.username ?? saved.cfg.username).trim(),
      password: input.password ? input.password : saved.cfg.password,
      token: input.token ? input.token : saved.cfg.token,
      remotePath: normalizeRemotePathFor(provider, input.remotePath ?? saved.cfg.remotePath),
    };
    return testRemoteStorage(cfg);
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
   * 从上传的文件恢复。
   * 上传的内容先落成临时文件，剩下的流程与「本地备份直接恢复」完全一致。
   */
  async restore(buf: Buffer, originalName: string, actor: { userId: string }): Promise<BackupRestoreResult> {
    const dir = await ensureDir();
    const tmp = path.join(dir, `.incoming-${Date.now()}-${process.pid}.tmp`);
    try {
      await writeFile(tmp, buf);
      return await restoreFromPath(tmp, originalName, actor);
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  },

  /** 直接拿服务器上已有的某一份备份恢复（不用先下载再上传，省事也不占内存） */
  async restoreLocal(name: string, actor: { userId: string }): Promise<BackupRestoreResult> {
    const files = await readFiles();
    if (!files.some((f) => f.name === name)) {
      throw new NotFoundError("找不到这个备份文件，可能已经被删掉了");
    }
    return restoreFromPath(path.join(backupDir(), name), name, actor);
  },

  /**
   * 从磁盘上的一份临时文件恢复（上传接口边收边写盘，大包不经过内存）。
   * 临时文件的清理由调用方负责——这里只读，不动它。
   */
  async restoreFromFile(
    absPath: string,
    originalName: string,
    actor: { userId: string },
  ): Promise<BackupRestoreResult> {
    if (!(await exists(absPath))) throw new ValidationError("上传的备份文件不在了，请重新上传");
    return restoreFromPath(absPath, originalName, actor);
  },
};

/**
 * 恢复的实际动作（上传与本地两条入口共用）。
 *
 * 顺序不能变：先验包 → 再算迁移 → 再给当前数据拍保命照 → 最后才换库、换图。
 * 任何一步失败都不动现有数据。
 */
async function restoreFromPath(
  srcPath: string,
  originalName: string,
  actor: { userId: string },
): Promise<BackupRestoreResult> {
  if (restoring) throw new ConflictError("已经有一个恢复任务在跑了，等它完成");
  restoring = true;

  const dir = await ensureDir();
  const workRoot = path.join(dir, `.restore-${Date.now()}-${process.pid}`);

  try {
    const head = await readHead(srcPath, 512);

    // 1) 认格式：tar（库+图）或老版本的单 .db
    let format: BackupFormat;
    let dbSource = srcPath;
    let imagesSource: string | null = null;
    let imagesInBackup = 0;

    if (looksLikeTar(head)) {
      format = "tar";
      const extracted = await extractTar(srcPath, workRoot);
      dbSource = path.join(workRoot, DB_ENTRY);
      if (!(await exists(dbSource))) {
        throw new ValidationError(
          "这个备份包里没有找到 suteng.db，可能不是本系统生成的备份（或者包已经损坏）",
        );
      }
      const uploads = path.join(workRoot, "uploads");
      if (extracted.hasUploads && (await exists(uploads))) {
        imagesSource = uploads;
        imagesInBackup = (await readdir(uploads)).filter((n) => isImageFile(n)).length;
      }
    } else if (head.length >= 15 && head.toString("latin1", 0, 15) === "SQLite format 3") {
      // 老备份只有库：仍然允许恢复，但图片保持现状，结果里会明说
      format = "db";
    } else {
      throw new ValidationError(
        "这个文件既不是本系统的 .tar 备份，也不是 SQLite 数据库。请上传列表里下载下来的备份文件",
      );
    }

    // 2) 用独立连接打开它：能读出表、能数出行，才算是一份能用的备份
    const counts = await probeBackup(dbSource);

    // 3) 迁移差异要在替换前算好（算在旧库上没意义）
    const pendingMigrations = await pendingMigrationsOf(dbSource);

    // 4) 先给现在这份数据（含图片）拍张保命照，导错了还能退回来
    let safetyBackup: string | null = null;
    try {
      const { file } = await createArchive("pre-restore");
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
    await copyFile(dbSource, dbPath);
    for (const suffix of ["-wal", "-shm"]) {
      await rm(`${dbPath}${suffix}`, { force: true });
    }

    // 6) 换图：只补不删。库里引用的文件名是 uuid，同名文件内容必然一致，
    //    所以「已有就跳过」既安全又省时间。
    let imagesRestored = 0;
    if (imagesSource) {
      const merged = await mergeImages(imagesSource, uploadDir());
      imagesRestored = merged.copied;
    }

    // 7) 核对：库里引用但盘上没有的图有几张——不为 0 就说明这份备份不全
    const imagesMissing = await countMissingImages();

    // 8) 冒烟：能查就算通了；查不动说明表结构和当前代码对不上，让运维重启
    const needsRestart = pendingMigrations.length > 0 || !(await smokeTest());

    await audit(
      actor.userId,
      "backup.restore",
      `【管理员恢复数据】用「${originalName}」覆盖当前库；${format === "tar" ? `包内 ${imagesInBackup} 张图，补进 ${imagesRestored} 张` : "老格式备份，未含图片"}；恢复前快照 ${safetyBackup ?? "无"}${
        imagesMissing > 0 ? `；仍有 ${imagesMissing} 张商品图找不到文件` : ""
      }${needsRestart ? `；缺少迁移 ${pendingMigrations.length} 个，需重启服务补表结构` : ""}`,
    );

    return {
      from: originalName,
      safetyBackup,
      pendingMigrations,
      needsRestart,
      counts,
      format,
      imagesInBackup,
      imagesRestored,
      imagesMissing,
    };
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
    restoring = false;
  }
}

/* ------------------------------------------------------------------ 工具 */

async function readHead(file: string, bytes: number): Promise<Buffer> {
  const handle = await open(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** 把备份包里的图片合进图片目录：同名且大小一致就跳过，永远不删任何文件 */
async function mergeImages(
  srcDir: string,
  destDir: string,
): Promise<{ source: number; copied: number }> {
  await mkdir(destDir, { recursive: true });
  const names = await readdir(srcDir).catch(() => [] as string[]);
  let source = 0;
  let copied = 0;

  for (const name of names) {
    if (!isImageFile(name)) continue;
    const from = path.join(srcDir, name);
    const s = await stat(from).catch(() => null);
    if (!s?.isFile()) continue;
    source += 1;

    const to = path.join(destDir, name);
    const current = await stat(to).catch(() => null);
    if (current?.isFile() && current.size === s.size) continue;

    await copyFile(from, to);
    copied += 1;
  }

  return { source, copied };
}

/**
 * 库里引用了、但图片目录里找不到的商品图有几张。
 * 恢复完直接告诉管理员「还剩几张是破图」，比让他一页页翻商品列表强。
 */
async function countMissingImages(): Promise<number> {
  const dir = uploadDir();
  const rows = await prisma.product
    .findMany({ where: { imageUrl: { not: null } }, select: { imageUrl: true } })
    .catch(() => [] as { imageUrl: string | null }[]);

  const cache = new Map<string, boolean>();
  let missing = 0;

  for (const row of rows) {
    const url = row.imageUrl?.trim();
    if (!url) continue;
    // 只核对本系统上传的图（/api/files/xxx.jpg）；外链图不归我们管
    const m = /^\/api\/files\/([^/?#]+)$/.exec(url);
    if (!m) continue;
    const name = m[1]!;

    let ok = cache.get(name);
    if (ok === undefined) {
      ok = await exists(path.join(dir, name));
      cache.set(name, ok);
    }
    if (!ok) missing += 1;
  }

  return missing;
}

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
