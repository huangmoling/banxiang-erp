import "server-only";
import path from "node:path";
import { env } from "./env";

/**
 * 商品图片目录的绝对路径。
 *
 * 上传、读取、备份三处必须用同一个算法：只要有一处算法不一样，
 * 备份就会对着一片空目录打包，恢复回来商品图全成了破图。
 * `UPLOAD_DIR` 是**容器内**路径，相对路径按 cwd 解析（与上传接口保持一致）。
 */
export function uploadDir(): string {
  return path.isAbsolute(env.UPLOAD_DIR)
    ? env.UPLOAD_DIR
    : path.join(process.cwd(), env.UPLOAD_DIR);
}

/** 与上传接口的白名单一致：只认这三类 */
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export function isImageFile(name: string): boolean {
  return IMAGE_EXT.has(path.extname(name).toLowerCase());
}
