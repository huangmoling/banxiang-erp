import { defineRoute } from "@/lib/api-handler";
import { backupNameSchema } from "@/modules/backup/backup.schema";
import { backupService } from "@/modules/backup/backup.service";

/**
 * 用服务器上已有的某一份备份直接恢复。
 *
 * 为什么单独开一个入口：家里那台机器整台报废时，人手里只有从云端下载的包，
 * 走上传接口；但更多时候是「刚才升级把账搞乱了，退回昨晚那份」——
 * 这一份本来就在磁盘上，再让人下载一次、再传回去，纯粹是折腾，还容易把包弄丢。
 */
export const POST = defineRoute<{ name: string }>(
  async ({ params, user }) => {
    const name = backupNameSchema.parse(params.name);
    return backupService.restoreLocal(name, { userId: user.id });
  },
  { roles: ["admin"] },
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
