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

/**
 * 文件头嗅探。
 *
 * 只信 `file.type` 是不够的：那是浏览器/脚本自己声明的，
 * 把一段 HTML 或 SVG 标成 `image/png` 照样能进来。虽然落盘后是按扩展名
 * 回 `image/png` 的，但缺了 nosniff 的旧浏览器会去猜内容，等于开了一条存储型 XSS。
 * 这里按魔数核一遍，对不上一律拒绝。
 */
function matchesMagic(ext: string, buf: Buffer): boolean {
  if (buf.length < 12) return false;
  switch (ext) {
    case ".jpg":
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case ".png":
      return (
        buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
        buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
      );
    case ".webp":
      return buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
    default:
      return false;
  }
}

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
  const buf = Buffer.from(await file.arrayBuffer());
  if (!matchesMagic(ext, buf)) {
    throw new ValidationError("这个文件的内容不是有效的图片，请换一张再试");
  }

  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), buf);

  log.info({ name, size: file.size, type: file.type }, "image uploaded");

  return { url: `/api/files/${name}`, size: file.size };
});

export const runtime = "nodejs";
