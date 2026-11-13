import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { defineRoute } from "@/lib/api-handler";
import { backupNameSchema } from "@/modules/backup/backup.schema";
import { backupService } from "@/modules/backup/backup.service";

/**
 * 下载备份文件。
 * 这是把数据带离服务器的唯一通道——服务器整台坏掉时，手里这份包就是全部指望。
 *
 * 从 v1.5 起备份包含商品图片，可能有几十上百 MB：改成流式返回，
 * 别再整个 readFile 进内存。文件名走 RFC 5987，中文环境下载工具也不会把名字搞乱。
 */
export const GET = defineRoute<{ name: string }>(
  async ({ params }) => {
    const name = backupNameSchema.parse(params.name);
    const { abs, size } = await backupService.resolveForDownload(name);

    const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>;

    return new Response(stream, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(size),
        "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "no-store",
      },
    });
  },
  { roles: ["admin"] },
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
