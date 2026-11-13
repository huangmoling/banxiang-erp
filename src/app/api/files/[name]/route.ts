import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { uploadDir } from "@/lib/upload-dir";
import { getSession } from "@/lib/session";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * 读取上传的图片。
 * 必须登录才能看（内部系统，不对外暴露仓库照片）。
 * 文件名严格限制为 uuid + 白名单扩展名，从根上避免路径穿越。
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
): Promise<Response> {
  const user = await getSession();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { name } = await ctx.params;
  if (!/^[a-zA-Z0-9-]{8,64}\.(jpg|png|webp)$/.test(name)) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const ext = path.extname(name).toLowerCase();
  try {
    const buf = await readFile(path.join(uploadDir(), name));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "cache-control": "private, max-age=86400",
      },
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}

export const runtime = "nodejs";
