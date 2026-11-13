import "server-only";
import * as fs from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";
import { ValidationError } from "@/lib/errors";
import type { RemoteTestResult } from "./backup.types";

/**
 * WebDAV 上传（坚果云 / 群晖 / Nextcloud 都能用）。
 *
 * 坚果云为什么走 WebDAV 而不是它的开放 API：
 * WebDAV 是它官方长期支持的协议，用户只要在网页版「安全选项 → 添加应用密码」生成一串密码，
 * 就能直接用，不需要申请 client_id、不用走 OAuth 回调。
 * 地址固定为 https://dav.jianguoyun.com/dav ，账号是注册邮箱，密码是**应用密码**（不是登录密码）。
 *
 * 三个坑：
 * 1. **目录不会自动建**：WebDAV 的 PUT 不会帮你建父目录，必须逐级 MKCOL。
 *    已存在时 MKCOL 返回 405，这不是错误。
 * 2. **上传完要回查大小**：网关抖动时可能只收一半也返回 2xx，大小对不上就当没传。
 * 3. **不要整包读进内存**：图片一起备份后包会到几十上百 MB，
 *    用 `openAsBlob` 让 fetch 直接从磁盘读，内存占用与包大小无关。
 */

export type WebdavConfig = {
  /** 服务地址，坚果云固定 https://dav.jianguoyun.com/dav */
  url: string;
  /** 坚果云：注册邮箱 */
  username: string;
  /** 坚果云：应用密码 */
  password: string;
  /** 网盘里的目录，例如 /suteng */
  remotePath: string;
};

export const JIANGUOYUN_DEFAULT_URL = "https://dav.jianguoyun.com/dav";

const UPLOAD_TIMEOUT_MS = 300_000;
const TEST_TIMEOUT_MS = 25_000;

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>`;

/** 远程目录统一成 `/a/b`：补前导斜杠、去掉尾部斜杠、压掉重复斜杠 */
export function normalizeWebdavPath(raw: string): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  const withLead = t.startsWith("/") ? t : `/${t}`;
  return withLead.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

function baseUrl(cfg: WebdavConfig): string {
  const raw = (cfg.url ?? "").trim() || JIANGUOYUN_DEFAULT_URL;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ValidationError("WebDAV 地址格式不对，坚果云固定是 https://dav.jianguoyun.com/dav");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ValidationError("WebDAV 地址只能用 http:// 或 https://");
  }
  const p = u.pathname.replace(/\/+$/, "");
  return `${u.origin}${p}`;
}

function authHeader(cfg: WebdavConfig): string {
  if (!cfg.username || !cfg.password) {
    throw new ValidationError("WebDAV 的账号和密码都要填（坚果云用邮箱 + 应用密码）");
  }
  return `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`, "utf8").toString("base64")}`;
}

function encodePath(rel: string): string {
  return rel
    .split("/")
    .filter((s) => s !== "")
    .map((s) => encodeURIComponent(s))
    .join("/");
}

function urlOf(cfg: WebdavConfig, rel: string): string {
  const base = baseUrl(cfg);
  const tail = encodePath(rel);
  return tail ? `${base}/${tail}` : base;
}

async function request(
  cfg: WebdavConfig,
  method: string,
  rel: string,
  init: RequestInit = {},
  timeoutMs = UPLOAD_TIMEOUT_MS,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", authHeader(cfg));
  try {
    return await fetch(urlOf(cfg, rel), {
      ...init,
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new ValidationError(`连接 WebDAV 超时（${baseUrl(cfg)}），检查网络`);
    }
    const code = e?.cause?.code ?? "";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      throw new ValidationError(`找不到 WebDAV 主机（${baseUrl(cfg)}），地址填错了？`);
    }
    if (code === "ECONNREFUSED") {
      throw new ValidationError(`WebDAV 拒绝连接（${baseUrl(cfg)}），服务没起来或端口不对`);
    }
    throw new ValidationError(`连不上 WebDAV（${baseUrl(cfg)}）：${e?.message ?? "未知错误"}`);
  }
}

/** 状态码翻译成人能看懂的话。坚果云的错误码很干，不翻译等于没提示 */
function explain(status: number): string {
  switch (status) {
    case 401:
      return "账号或密码不对。坚果云要填【应用密码】（网页版 → 设置 → 安全选项 → 添加应用密码），不是登录密码";
    case 403:
      return "坚果云拒绝了这次请求：应用密码可能已失效，或账号没有开启 WebDAV 权限";
    case 404:
      return "路径不存在（目录还没建出来）";
    case 405:
      return "服务端不接受这个操作";
    case 409:
      return "上级目录不存在";
    case 507:
      return "坚果云空间不足，清理一下再传";
    default:
      return `HTTP ${status}`;
  }
}

/** 逐级建目录。已存在（405/301）当作成功——这是 WebDAV 的正常返回 */
async function ensureCollections(cfg: WebdavConfig, dir: string): Promise<void> {
  const clean = normalizeWebdavPath(dir);
  if (!clean) return;

  const segments = clean.split("/").filter(Boolean);
  let current = "";
  for (const seg of segments) {
    current += `/${seg}`;
    const res = await request(cfg, "MKCOL", current, {}, TEST_TIMEOUT_MS);
    if (res.ok || res.status === 405 || res.status === 301) continue;
    if (res.status === 401 || res.status === 403) {
      throw new ValidationError(`建目录 ${current} 失败：${explain(res.status)}`);
    }
    // 409 一般是上级还没建好；上一轮已经建过了，继续往下走让它自然报错
    if (res.status === 409) continue;
    throw new ValidationError(`建目录 ${current} 失败：${explain(res.status)}`);
  }
}

type NodeFsWithBlob = typeof fs & { openAsBlob?: (p: string) => Promise<Blob> };

/** 文件 → 可流式发送的 Blob。老 Node 没有 openAsBlob 时退回整读 */
async function bodyOf(absPath: string): Promise<Blob | Uint8Array> {
  const withBlob = fs as NodeFsWithBlob;
  if (typeof withBlob.openAsBlob === "function") {
    return withBlob.openAsBlob(absPath);
  }
  const buf = await fs.promises.readFile(absPath);
  return new Uint8Array(buf);
}

async function remoteSize(cfg: WebdavConfig, rel: string): Promise<number | null> {
  const res = await request(cfg, "PROPFIND", rel, {
    headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
    body: PROPFIND_BODY,
  });
  if (!res.ok) return null;
  const text = await res.text();
  const m = /<[dD]:?getcontentlength>\s*(\d+)\s*</i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export type WebdavUploadOutcome = { remotePath: string; size: number };

/** 上传一个文件到目标目录，成功后回查大小 */
export async function uploadToWebdav(
  cfg: WebdavConfig,
  absPath: string,
  remoteName?: string,
): Promise<WebdavUploadOutcome> {
  const dir = normalizeWebdavPath(cfg.remotePath);
  if (!dir) throw new ValidationError("还没填坚果云上的备份目录（例如 /suteng）");

  const s = await fs.promises.stat(absPath).catch(() => null);
  if (!s?.isFile()) throw new ValidationError("要上传的备份文件不见了");

  const name = remoteName ?? path.basename(absPath);
  const rel = `${dir}/${name}`;
  const body = await bodyOf(absPath);

  await ensureCollections(cfg, dir);

  const res = await request(cfg, "PUT", rel, {
    headers: { "Content-Type": "application/octet-stream" },
    body: body as BodyInit,
  });
  if (!res.ok) {
    throw new ValidationError(`上传到坚果云失败：${explain(res.status)}`);
  }

  // 回查大小：对不上就当没传成功，宁可重传也别留个坏包在云上
  const size = s.size;
  const got = await remoteSize(cfg, rel);
  if (got !== null && got !== size) {
    throw new ValidationError(
      `上传后大小对不上（本地 ${size} 字节，云端 ${got} 字节），可能被截断了，请重传`,
    );
  }

  logger.info({ remotePath: rel, size, remoteSize: got }, "backup uploaded to webdav");
  return { remotePath: `webdav:${rel}`, size };
}

/** 测试连接：认证 → 目录 → 写权限，逐项验证 */
export async function testWebdav(cfg: WebdavConfig): Promise<RemoteTestResult> {
  const empty: RemoteTestResult = {
    ok: false,
    user: null,
    pathExists: false,
    writable: false,
    fileCount: 0,
    message: "",
  };

  const dir = normalizeWebdavPath(cfg.remotePath);
  if (!dir) return { ...empty, message: "还没填坚果云上的备份目录（例如 /suteng）" };

  try {
    // 1) 认证 + 服务可达
    const root = await request(cfg, "PROPFIND", "/", {
      headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      body: PROPFIND_BODY,
    }, TEST_TIMEOUT_MS);
    if (root.status === 401 || root.status === 403) {
      return { ...empty, message: `连上了，但认证没过：${explain(root.status)}` };
    }
    if (!root.ok && root.status !== 404) {
      return { ...empty, message: `连上了，但服务返回异常：${explain(root.status)}` };
    }

    // 2) 目录在不在（不在就建）
    const probe = await request(cfg, "PROPFIND", dir, {
      headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      body: PROPFIND_BODY,
    }, TEST_TIMEOUT_MS);
    const pathExists = probe.status === 207;
    if (!pathExists) {
      await ensureCollections(cfg, dir);
    }

    // 3) 真写一次再删掉——只读权限是这里唯一能验出来的
    const testName = `.suteng-write-test-${Date.now()}`;
    const put = await request(cfg, "PUT", `${dir}/${testName}`, { body: "ok" }, TEST_TIMEOUT_MS);
    const writable = put.ok;
    if (put.ok) await request(cfg, "DELETE", `${dir}/${testName}`, {}, TEST_TIMEOUT_MS);

    // 4) 数一下目录里现在有几个文件
    let fileCount = 0;
    const list = await request(cfg, "PROPFIND", dir, {
      headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
      body: PROPFIND_BODY,
    }, TEST_TIMEOUT_MS);
    if (list.ok) {
      const text = await list.text();
      const total = (text.match(/<[dD]:response[\s>]/g) ?? []).length;
      fileCount = Math.max(0, total - 1); // 去掉目录自身
    }

    return {
      ok: writable,
      user: cfg.username || null,
      pathExists: pathExists || writable,
      writable,
      fileCount,
      message: writable
        ? `连接正常：${dir} 可写，里面现在有 ${fileCount} 个文件`
        : put.status === 401 || put.status === 403
          ? `目录能进，但不能写：${explain(put.status)}`
          : `目录在，但写入测试失败：${explain(put.status)}`,
    };
  } catch (err) {
    return { ...empty, message: (err as Error).message || "测试失败" };
  }
}
