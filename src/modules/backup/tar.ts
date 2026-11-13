import "server-only";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";

/**
 * 极小实现的 tar（ustar）打包 / 解包。
 *
 * 为什么自己写而不是引 `tar` / `archiver`：
 * NAS 的构建容器连 registry.npmjs.org 的 DNS 都解析不了，运行阶段更不允许联网装包
 * （见 Dockerfile 顶部注释）。这个功能必须在「零新增依赖」的前提下成立——
 * tar 格式足够简单（512 字节头 + 内容 + 补齐），自己写反而可控、可审计。
 *
 * 三条必须守住的：
 * 1. **解包必须防路径穿越**：包里出现 `/etc/passwd` 或 `../../x` 一律跳过，
 *    备份文件是管理员上传的，但不能假设它一定是本系统生成的。
 * 2. **流式读写**：图片可能有几百 MB，整包读进内存迟早 OOM。
 * 3. **不压缩**：图片本身已压缩，SQLite 也不大；不压缩换来「出错时 7-Zip 能直接打开看」。
 */

const BLOCK = 512;
/** 读写块大小：1 MB 一次，既不为小文件浪费系统调用，也不会一次占太多内存 */
const MAX_CHUNK = 1024 * 1024;

export type TarSource =
  | { name: string; absPath: string; mtime?: Date }
  | { name: string; data: Buffer; mtime?: Date };

/* ------------------------------------------------------------ 写 */

function octal(value: number, len: number): string {
  const s = Math.max(0, Math.floor(value)).toString(8);
  // 字段长度 len，末位留 NUL；超长就截断（tar 的老规矩）
  return s.length >= len ? s.slice(0, len - 1) : s.padStart(len - 1, "0");
}

function checksumField(sum: number): string {
  return `${sum.toString(8).padStart(6, "0")}\0 `;
}

function buildHeader(name: string, size: number, mtimeMs: number, typeflag = "0"): Buffer {
  const buf = Buffer.alloc(BLOCK, 0);

  let prefix = "";
  let base = name;
  if (Buffer.byteLength(name, "utf8") > 100) {
    const idx = name.lastIndexOf("/");
    if (idx > 0) {
      prefix = name.slice(0, idx);
      base = name.slice(idx + 1);
    }
    if (Buffer.byteLength(prefix, "utf8") > 155 || Buffer.byteLength(base, "utf8") > 100) {
      throw new Error(`文件名太长，装不进 tar：${name}`);
    }
  }

  buf.write(base, 0, 100, "utf8");
  buf.write(octal(0o644, 8), 100, 8, "latin1");
  buf.write(octal(0, 8), 108, 8, "latin1");
  buf.write(octal(0, 8), 116, 8, "latin1");
  buf.write(octal(size, 12), 124, 12, "latin1");
  buf.write(octal(Math.floor(mtimeMs / 1000), 12), 136, 12, "latin1");
  // 校验和字段先按 8 个空格参与计算，算完再回填
  buf.write("        ", 148, 8, "latin1");
  buf.write(typeflag, 156, 1, "latin1");
  buf.write("ustar\0", 257, 6, "latin1");
  buf.write("00", 263, 2, "latin1");
  buf.write(prefix, 345, 155, "utf8");

  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += buf[i]!;
  buf.write(checksumField(sum), 148, 8, "latin1");
  return buf;
}

function padding(size: number): number {
  const rest = size % BLOCK;
  return rest === 0 ? 0 : BLOCK - rest;
}

async function writeChunk(out: WriteStream, chunk: Buffer): Promise<void> {
  if (!out.write(chunk)) await once(out, "drain");
}

async function copyFileToStream(out: WriteStream, absPath: string, size: number): Promise<void> {
  const input = createReadStream(absPath, { highWaterMark: MAX_CHUNK });
  let copied = 0;
  for await (const chunk of input) {
    const buf = chunk as Buffer;
    copied += buf.length;
    await writeChunk(out, buf);
  }
  // 一边读一边被改（比如刚好有人在上传新图）会让包里的 size 和内容对不上
  if (copied !== size) {
    throw new Error(`读「${path.basename(absPath)}」时长度变了（${copied} ≠ ${size}），本次备份中止`);
  }
}

/** 把若干文件打成一个 tar。返回实际写入的文件数与字节数。 */
export async function writeTar(
  tarPath: string,
  sources: TarSource[],
): Promise<{ files: number; bytes: number }> {
  await mkdir(path.dirname(tarPath), { recursive: true });

  const out = createWriteStream(tarPath, { flags: "w" });
  let files = 0;
  let bytes = 0;

  try {
    for (const src of sources) {
      const mtime = src.mtime ?? new Date();

      if ("data" in src) {
        await writeChunk(out, buildHeader(src.name, src.data.length, mtime.getTime()));
        if (src.data.length > 0) await writeChunk(out, src.data);
        const pad = padding(src.data.length);
        if (pad > 0) await writeChunk(out, Buffer.alloc(pad));
        bytes += BLOCK + src.data.length + pad;
        files += 1;
        continue;
      }

      const s = await stat(src.absPath).catch(() => null);
      if (!s?.isFile()) continue; // 打包过程中被删了就跳过，别为一张图毁掉整次备份

      await writeChunk(out, buildHeader(src.name, s.size, (src.mtime ?? s.mtime).getTime()));
      if (s.size > 0) await copyFileToStream(out, src.absPath, s.size);
      const pad = padding(s.size);
      if (pad > 0) await writeChunk(out, Buffer.alloc(pad));
      bytes += BLOCK + s.size + pad;
      files += 1;
    }

    // 结束标记：两个全零块
    await writeChunk(out, Buffer.alloc(BLOCK * 2));
    bytes += BLOCK * 2;
  } finally {
    await new Promise<void>((resolve) => out.end(() => resolve()));
  }

  return { files, bytes };
}

/* ------------------------------------------------------------ 读 */

/** 按需取字节的读取器：把流对切成「任意长度」，调用方不用关心块边界 */
class ByteReader {
  private chunks: Buffer[] = [];
  private buffered = 0;
  private done = false;
  private readonly it: AsyncIterator<Buffer>;

  constructor(input: AsyncIterable<Buffer>) {
    this.it = input[Symbol.asyncIterator]();
  }

  private async fill(need: number): Promise<void> {
    while (this.buffered < need && !this.done) {
      const next = await this.it.next();
      if (next.done) {
        this.done = true;
        break;
      }
      const chunk = next.value;
      this.chunks.push(chunk);
      this.buffered += chunk.length;
    }
  }

  /** 精确读 n 字节；流的余额不足说明文件被截断，返回 null */
  async read(n: number): Promise<Buffer | null> {
    if (n <= 0) return Buffer.alloc(0);
    await this.fill(n);
    if (this.buffered < n) return null;

    const all = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks, this.buffered);
    if (all.length === n) {
      this.chunks = [];
      this.buffered = 0;
      return all;
    }
    this.chunks = [all.subarray(n)];
    this.buffered = all.length - n;
    // 拷贝一份交出去：剩下的引用还留在 this.chunks 里，不能让它被别人改
    return Buffer.from(all.subarray(0, n));
  }

  async skip(n: number): Promise<boolean> {
    let left = n;
    while (left > 0) {
      const take = Math.min(left, MAX_CHUNK);
      const chunk = await this.read(take);
      if (!chunk) return false;
      left -= chunk.length;
    }
    return true;
  }
}

function isZeroBlock(buf: Buffer): boolean {
  for (let i = 0; i < buf.length; i += 1) if (buf[i] !== 0) return false;
  return true;
}

function cstr(buf: Buffer, offset: number, len: number): string {
  const end = Math.min(buf.length, offset + len);
  const slice = buf.subarray(offset, end);
  const nul = slice.indexOf(0);
  return (nul >= 0 ? slice.subarray(0, nul) : slice).toString("utf8");
}

/** tar 的数字字段是八进制；大文件会用 base-256（首字节最高位置 1） */
function numeric(buf: Buffer, offset: number, len: number): number {
  if (buf[offset]! & 0x80) {
    let n = 0;
    for (let i = offset + 1; i < offset + len; i += 1) n = n * 256 + buf[i]!;
    return n;
  }
  const text = cstr(buf, offset, len).trim();
  if (!text) return 0;
  const v = parseInt(text, 8);
  return Number.isFinite(v) ? v : 0;
}

/** PAX 扩展头：`<长度> key=value\n` 连写，只关心 path */
function parsePax(buf: Buffer): { path?: string } {
  const out: { path?: string } = {};
  const text = buf.toString("utf8");
  let i = 0;
  while (i < text.length) {
    const sp = text.indexOf(" ", i);
    if (sp < 0) break;
    const len = Number(text.slice(i, sp));
    if (!Number.isFinite(len) || len <= 0) break;
    const record = text.slice(sp + 1, i + len - 1);
    const eq = record.indexOf("=");
    if (eq > 0) {
      const key = record.slice(0, eq);
      const val = record.slice(eq + 1);
      if (key === "path") out.path = val;
    }
    i += len;
  }
  return out;
}

/** 去掉绝对路径、`..`、`./`，只留相对路径；不合法返回 null */
function safeRelative(raw: string): string | null {
  const normalized = raw.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
  const parts = normalized.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0) return null;
  if (parts.some((p) => p === "..")) return null;
  return parts.join("/");
}

export type ExtractResult = {
  /** 解出来的文件（相对 destDir，正斜杠） */
  files: string[];
  bytes: number;
  /** 包里有没有 uploads/ 目录 —— 没有就是老版本只有数据库的备份 */
  hasUploads: boolean;
};

/** 把 tar 解到 destDir。越权路径静默跳过，不让里面的东西写到目录外。 */
export async function extractTar(tarPath: string, destDir: string): Promise<ExtractResult> {
  await mkdir(destDir, { recursive: true });

  const reader = new ByteReader(createReadStream(tarPath, { highWaterMark: MAX_CHUNK }));
  const files: string[] = [];
  let bytes = 0;
  let longName: string | null = null;
  let hasUploads = false;

  for (;;) {
    const block = await reader.read(BLOCK);
    if (!block) break;
    if (isZeroBlock(block)) break; // 结束块

    const typeflag = block.toString("latin1", 156, 157);
    const size = numeric(block, 124, 12);
    const paddedSize = Math.ceil(size / BLOCK) * BLOCK;

    let name = cstr(block, 0, 100);
    const prefix = cstr(block, 345, 155);
    if (prefix) name = `${prefix}/${name}`;

    // GNU 长文件名 / PAX 扩展头：内容才是真名字，本身不是文件
    if (typeflag === "L") {
      const data = await reader.read(paddedSize);
      if (data) longName = cstr(data, 0, Math.min(size, data.length));
      continue;
    }
    if (typeflag === "x" || typeflag === "g" || typeflag === "K") {
      const data = await reader.read(paddedSize);
      if (typeflag === "x" && data) {
        const pax = parsePax(data);
        if (pax.path) longName = pax.path;
      }
      continue;
    }
    if (longName) {
      name = longName;
      longName = null;
    }

    if (typeflag === "5") {
      await reader.skip(paddedSize);
      continue;
    }
    if (typeflag !== "0" && typeflag !== "\0" && typeflag !== "7") {
      await reader.skip(paddedSize); // 链接、设备节点之类的不解
      continue;
    }

    const rel = safeRelative(name);
    if (!rel) {
      await reader.skip(paddedSize);
      continue;
    }

    const target = path.join(destDir, rel);
    if (!isInside(destDir, target)) {
      await reader.skip(paddedSize);
      continue;
    }

    await mkdir(path.dirname(target), { recursive: true });
    await writeEntry(reader, target, size);
    if (rel.startsWith("uploads/")) hasUploads = true;
    files.push(rel);
    bytes += size;
  }

  return { files, bytes, hasUploads };
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function writeEntry(reader: ByteReader, target: string, size: number): Promise<void> {
  const out = createWriteStream(target, { flags: "w" });
  try {
    let left = size;
    while (left > 0) {
      const take = Math.min(left, MAX_CHUNK);
      const chunk = await reader.read(take);
      if (!chunk) throw new Error("备份包被截断了（tar 内容不足），换一份备份再试");
      await writeChunk(out, chunk);
      left -= chunk.length;
    }
    const pad = padding(size);
    if (pad > 0) await reader.skip(pad);
  } finally {
    await new Promise<void>((resolve) => out.end(() => resolve()));
  }
}

/** 判断一个文件头是不是 tar：offset 257 处有 "ustar" */
export function looksLikeTar(head: Buffer): boolean {
  return head.length >= 262 && head.toString("latin1", 257, 262) === "ustar";
}
