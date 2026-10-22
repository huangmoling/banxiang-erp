import { defineRoute } from "@/lib/api-handler";
import { AppError, ValidationError } from "@/lib/errors";
import { backupService } from "@/modules/backup/backup.service";

/**
 * 导入备份（把上传的 .db 覆盖当前数据）。
 *
 * 这是全系统唯一一个「一键回滚」的入口，所以：
 * - 只给管理员；
 * - 只认 SQLite 文件头 + 必须能读出本系统的表，否则直接拒绝；
 * - 覆盖之前先自动拍一张 pre-restore 快照，导错了还能退回来。
 */
export const POST = defineRoute(async ({ req, user }) => {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "请用表单方式上传备份文件", 415);
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("没有收到备份文件");
  if (file.size === 0) throw new ValidationError("文件是空的");

  // 100 MB 已经远超这家店的账：真超过了多半是传错了东西
  const MAX = 100 * 1024 * 1024;
  if (file.size > MAX) throw new AppError("PAYLOAD_TOO_LARGE", "备份文件不能超过 100 MB", 413);

  const buf = Buffer.from(await file.arrayBuffer());
  return backupService.restore(buf, file.name || "uploaded.db", { userId: user.id });
}, { roles: ["admin"] });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
