import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { defineRoute } from "@/lib/api-handler";
import { AppError, ValidationError } from "@/lib/errors";
import { backupService } from "@/modules/backup/backup.service";

/**
 * 导入备份（把上传的包覆盖当前数据）。
 *
 * 这是全系统唯一一个「一键回滚」的入口，所以：
 * - 只给管理员；
 * - 只认 tar（库+图）或老的 SQLite 文件，且必须能读出本系统的表，否则直接拒绝；
 * - 覆盖之前先自动拍一张 pre-restore 快照（含图片），导错了还能退回来。
 *
 * 上传走**原始流**（application/octet-stream）：带图片的备份包可能上百 MB，
 * 用 FormData 会把整个包读进内存再交给业务层，机器小了直接 OOM。
 * 老前端发 multipart 也仍然兼容。
 */

const MAX_BYTES = 512 * 1024 * 1024;

export const POST = defineRoute(async ({ req, user }) => {
  const contentType = req.headers.get("content-type") ?? "";
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    throw new AppError("PAYLOAD_TOO_LARGE", "备份包不能超过 512 MB，请分卷或先清理图片", 413);
  }

  // 1) 新前端：整个文件就是请求体，边收边写盘，内存里只过一个块
  if (contentType.includes("application/octet-stream") && req.body) {
    const originalName = decodeName(req.headers.get("x-backup-name")) ?? "uploaded.tar";
    const dir = path.join(tmpdir(), "suteng-restore");
    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `incoming-${Date.now()}-${process.pid}.bin`);

    try {
      await pipeline(
        Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(tmp),
      );
      return await backupService.restoreFromFile(tmp, originalName, { userId: user.id });
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  // 2) 老前端：multipart/form-data
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("没有收到备份文件");
    if (file.size === 0) throw new ValidationError("文件是空的");
    if (file.size > MAX_BYTES) {
      throw new AppError("PAYLOAD_TOO_LARGE", "备份包不能超过 512 MB", 413);
    }
    const buf = Buffer.from(await file.arrayBuffer());
    return backupService.restore(buf, file.name || "uploaded.tar", { userId: user.id });
  }

  throw new AppError("UNSUPPORTED_MEDIA_TYPE", "请用文件上传方式提交备份包", 415);
}, { roles: ["admin"] });

/** 文件名可能带非 ASCII，浏览器会做百分号编码；解不开就用默认名 */
function decodeName(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
