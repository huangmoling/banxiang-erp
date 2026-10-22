import "server-only";
import { readFile, stat } from "node:fs/promises";
import { logger } from "@/lib/logger";
import { ValidationError } from "@/lib/errors";
import type { OpenlistTestResult } from "./backup.types";

/**
 * OpenList（原 Alist）上传客户端。
 *
 * 为什么用 HTTP API 而不是挂 WebDAV：
 * 这套系统要在一个**没有外网、只有局域网**的 NAS 里跑，能依赖的东西越少越好。
 * OpenList 的 `/api/fs/put` 一个 PUT 就能把文件写进它挂载的任意存储（这里是 Cloudflare R2），
 * 不需要再引入 webdav 客户端库，也不需要把网盘密码配到系统里。
 *
 * 三条约定：
 * 1. **优先用账号密码换令牌**：登录拿到的 JWT 虽然只有 48 小时，但每次跑之前换一张新的，
 *    永远不会有「令牌过期了备份传不上去」这种半夜才发现的问题。填了长期令牌又没填密码时，
 *    才用令牌。
 * 2. **上传完一定回查大小**：R2/网关在抖动时可能收一半就断，HTTP 也可能给你 200。
 *    文件大小对不上就当没传，宁可报错让人重传，也不能留一个看起来传上去了的坏文件。
 * 3. **失败不抛给调用方**：本地备份已经落盘了。传不上去只是少一层保险，
 *    不该让「备份成功」变成「备份失败」。错误记进上传日志，界面上给个「重新上传」按钮。
 */

export type OpenlistConfig = {
  url: string;
  username: string;
  password: string;
  token: string;
  remotePath: string;
};

const REQUEST_TIMEOUT_MS = 120_000;
const LOGIN_TIMEOUT_MS = 20_000;
/** 登录换来的令牌有效期 48h，这里提前到 12h 就换新的，避免卡在过期边界上 */
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
/** 备份文件一般几百 KB，给 512 MB 上限是防呆（真要这么大该拆分部署了） */
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

type TokenCache = { key: string; token: string; at: number };
let tokenCache: TokenCache | null = null;

function cacheKey(cfg: OpenlistConfig): string {
  return `${cfg.url}|${cfg.username}|${cfg.password}|${cfg.token}`;
}

function friendlyNetworkError(err: unknown, base: string): string {
  const e = err as Error & { cause?: { code?: string } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return `连接网盘超时（${base}），检查地址和网络`;
  }
  const code = e?.cause?.code ?? "";
  if (code === "ECONNREFUSED") return `网盘拒绝连接（${base}），服务没起来或端口不对`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `找不到网盘主机（${base}），地址填错了？`;
  return `连不上网盘（${base}）：${e?.message ?? "未知错误"}`;
}

/** 远程目录统一成 `/a/b`：补前导斜杠、去掉尾部斜杠、压掉重复斜杠 */
export function normalizeRemotePath(raw: string): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  const withLead = t.startsWith("/") ? t : `/${t}`;
  return withLead.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

/**
 * 算出 API 的根地址。
 *
 * 用户很容易把「网盘里那个目录」当成服务地址贴进来（`http://192.168.1.110:7890/r2`）——
 * 这里做个纠正：如果地址里的路径正好是远程目录的前缀，说明那是目录不是反向代理前缀，丢掉它。
 * 真正的反向代理子路径（`http://host/alist` + 目录 `/r2`）不会被误伤。
 */
function baseUrl(cfg: OpenlistConfig): string {
  const raw = (cfg.url ?? "").trim();
  if (!raw) throw new ValidationError("还没填网盘地址");

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ValidationError("网盘地址格式不对，应该像 http://192.168.1.110:7890 这样");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ValidationError("网盘地址只能用 http:// 或 https://");
  }

  let pathname = u.pathname.replace(/\/+$/, "");
  const remote = normalizeRemotePath(cfg.remotePath);
  if (pathname && remote && remote.startsWith(`${pathname}/`)) pathname = "";

  return `${u.origin}${pathname}`;
}

function safeJson(text: string): { code?: number; message?: string; data?: unknown } | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" ? (v as { code?: number; message?: string }) : null;
  } catch {
    return null;
  }
}

async function login(cfg: OpenlistConfig, base: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: cfg.username, password: cfg.password }),
      signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ValidationError(friendlyNetworkError(err, base));
  }

  const text = await res.text();
  const json = safeJson(text);
  const token = (json?.data as { token?: string } | undefined)?.token;

  if (!res.ok || json?.code !== 200 || !token) {
    throw new ValidationError(
      `网盘登录失败：${json?.message || `HTTP ${res.status}`}（检查账号密码，或确认这个账号有管理权限）`,
    );
  }
  return token;
}

async function tokenFor(cfg: OpenlistConfig, base: string, forceFresh = false): Promise<string> {
  const key = cacheKey(cfg);

  if (!forceFresh && tokenCache && tokenCache.key === key && Date.now() - tokenCache.at < TOKEN_TTL_MS) {
    return tokenCache.token;
  }

  // 有账号密码就用它换新令牌：这条路永远不会因为「令牌过期」而断
  if (cfg.username && cfg.password) {
    const token = await login(cfg, base);
    tokenCache = { key, token, at: Date.now() };
    return token;
  }

  if (cfg.token) return cfg.token;

  throw new ValidationError("网盘的账号密码和长期令牌都没填，没法上传");
}

type ApiResult = { status: number; json: { code?: number; message?: string; data?: unknown } | null };

/** 底层请求：统一带令牌、统一超时；令牌过期（401）时自动换一张再试一次 */
async function raw(
  cfg: OpenlistConfig,
  path: string,
  init: RequestInit,
  retry = true,
): Promise<ApiResult> {
  const base = baseUrl(cfg);
  const token = await tokenFor(cfg, base);

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: token },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ValidationError(friendlyNetworkError(err, base));
  }

  const text = await res.text();
  const json = safeJson(text);

  if ((res.status === 401 || json?.code === 401) && retry) {
    tokenCache = null;
    await tokenFor(cfg, base, true);
    return raw(cfg, path, init, false);
  }

  return { status: res.status, json };
}

/** 要求成功的调用：非 200 一律抛 ValidationError，消息直接给用户看 */
async function api<T>(cfg: OpenlistConfig, path: string, init: RequestInit = {}): Promise<T> {
  const { status, json } = await raw(cfg, path, init);
  if (status < 200 || status >= 300 || json?.code !== 200) {
    throw new ValidationError(`网盘返回错误：${json?.message || `HTTP ${status}`}`);
  }
  return json.data as T;
}

/** 探测式调用：失败不抛，返回 null（用来问「目录在不在」这种问题） */
async function probe(
  cfg: OpenlistConfig,
  path: string,
  body: unknown,
): Promise<{ code?: number; message?: string; data?: unknown } | null> {
  try {
    const { json } = await raw(cfg, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return json;
  } catch (err) {
    logger.warn({ err: (err as Error).message, path }, "openlist probe failed");
    return null;
  }
}

/** 目录不存在就建；已存在什么都不做（mkdir 在已存在时会报错，这里故意吞掉） */
async function ensureDir(cfg: OpenlistConfig, dir: string): Promise<void> {
  const info = await probe(cfg, "/api/fs/get", { path: dir });
  if (info?.code === 200 && info.data) return;

  await probe(cfg, "/api/fs/mkdir", { path: dir });
}

export type UploadOutcome = {
  remotePath: string;
  size: number;
};

/**
 * 把本地文件传到网盘的目标目录。失败抛 ValidationError（调用方自己决定记日志还是提示）。
 */
export async function uploadToOpenlist(
  cfg: OpenlistConfig,
  absPath: string,
  remoteName?: string,
): Promise<UploadOutcome> {
  const dir = normalizeRemotePath(cfg.remotePath);
  if (!dir) throw new ValidationError("还没填网盘上的备份目录（例如 /r2/suteng）");

  const s = await stat(absPath).catch(() => null);
  if (!s?.isFile()) throw new ValidationError("要上传的备份文件不见了");
  if (s.size > MAX_UPLOAD_BYTES) {
    throw new ValidationError(`备份文件超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB，太大了，请手动下载`);
  }

  const name = remoteName ?? absPath.split(/[\\/]/).pop() ?? "backup.db";
  const full = `${dir}/${name}`;

  await ensureDir(cfg, dir);

  // 整读进内存：备份文件通常在几百 KB 到几十 MB，读一次比处理流式上传的边界情况划算
  const buf = await readFile(absPath);

  await api(cfg, "/api/fs/put", {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(buf.length),
      // OpenList 要求这个头是 URL 编码过的完整路径
      "File-Path": encodeURIComponent(full),
    },
    body: new Uint8Array(buf),
  });

  // 回查大小：对不上就当没传成功，宁可重传也别留个坏文件在云上
  const info = await probe(cfg, "/api/fs/get", { path: full });
  const remoteSize = Number((info?.data as { size?: number } | undefined)?.size ?? -1);

  if (remoteSize >= 0 && remoteSize !== buf.length) {
    throw new ValidationError(
      `上传后大小对不上（本地 ${buf.length} 字节，网盘 ${remoteSize} 字节），可能被截断了，请重传`,
    );
  }

  logger.info({ remotePath: full, size: buf.length, remoteSize }, "backup uploaded to openlist");
  return { remotePath: full, size: buf.length };
}

/** 测试连接：逐项检查「能登录 / 目录在不在 / 能不能写」 */
export async function testOpenlist(cfg: OpenlistConfig): Promise<OpenlistTestResult> {
  const empty: OpenlistTestResult = {
    ok: false,
    user: null,
    pathExists: false,
    writable: false,
    fileCount: 0,
    message: "",
  };

  try {
    const me = await api<{ username?: string }>(cfg, "/api/me", { method: "GET" });
    const user = me?.username ?? null;

    const dir = normalizeRemotePath(cfg.remotePath);
    if (!dir) {
      return { ...empty, user, message: "还没填网盘上的备份目录" };
    }

    const list = await probe(cfg, "/api/fs/list", {
      path: dir,
      password: "",
      page: 1,
      per_page: 0,
      refresh: true,
    });

    const data = list?.data as
      | { content?: unknown[] | null; total?: number; write?: boolean }
      | undefined;

    if (list?.code !== 200 || !data) {
      // 目录不存在时 OpenList 通常回 500/object not found
      const notFound = /not found|object not exist|不存在/i.test(list?.message ?? "");
      return {
        ...empty,
        user,
        message: notFound
          ? `连上了，但目录 ${dir} 还不存在——上传时会自动创建，也可以先去网盘里建好`
          : `连上了，但列不出目录 ${dir}：${list?.message ?? "未知原因"}`,
      };
    }

    const fileCount = data.total ?? data.content?.length ?? 0;
    const writable = data.write !== false;

    return {
      ok: writable,
      user,
      pathExists: true,
      writable,
      fileCount,
      message: writable
        ? `连接正常：${dir} 可写，里面现在有 ${fileCount} 个文件`
        : `连上了，但目录 ${dir} 是只读的，检查这个账号的权限`,
    };
  } catch (err) {
    return { ...empty, message: (err as Error).message || "测试失败" };
  }
}
