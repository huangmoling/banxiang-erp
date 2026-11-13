import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { defineRoute } from "@/lib/api-handler";
import { env } from "@/lib/env";
import { uploadDir } from "@/lib/upload-dir";
import { AppError, ValidationError } from "@/lib/errors";

const ALLOWED = new Map<string, string>([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

/** 商品图片上传：只接受 jpg/png/webp，按内容类型定扩展名（不信任文件名） */
export const POST = defineRoute(async ({ req, log }) => {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "请用表单方式上传图片", 415);
  }

  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    throw new ValidationError("没有收到图片文件");
  }

  const ext = ALLOWED.get(file.type);
  if (!ext) {
    throw new ValidationError("只支持 JPG / PNG / WebP 格式的图片");
  }

  const maxBytes = env.UPLOAD_MAX_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new AppError("PAYLOAD_TOO_LARGE", `图片不能超过 ${env.UPLOAD_MAX_MB} MB`, 413);
  }
  if (file.size === 0) {
    throw new ValidationError("图片内容为空");
  }

  const name = `${randomUUID()}${ext}`;
  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));

  log.info({ name, size: file.size, type: file.type }, "image uploaded");

  return { url: `/api/files/${name}`, size: file.size };
});

export const runtime = "nodejs";
