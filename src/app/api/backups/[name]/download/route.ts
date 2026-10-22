import { readFile } from "node:fs/promises";
import { defineRoute } from "@/lib/api-handler";
import { backupNameSchema } from "@/modules/backup/backup.schema";
import { backupService } from "@/modules/backup/backup.service";

/**
 * 下载备份文件。
 * 这是把数据带离服务器的唯一通道——服务器整台坏掉时，手里这份 .db 就是全部指望。
 * 文件名走 RFC 5987，中文环境下载工具也不会把名字搞乱。
 */
export const GET = defineRoute<{ name: string }>(
  async ({ params }) => {
    const name = backupNameSchema.parse(params.name);
    const { abs } = await backupService.resolveForDownload(name);
    const buf = await readFile(abs);

    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(buf.byteLength),
        "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "no-store",
      },
    });
  },
  { roles: ["admin"] },
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
