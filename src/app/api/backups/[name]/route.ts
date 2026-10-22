import { defineRoute } from "@/lib/api-handler";
import { backupNameSchema } from "@/modules/backup/backup.schema";
import { backupService } from "@/modules/backup/backup.service";

/** 删除一个备份文件（管理员手动清理，轮转不会碰手动备份） */
export const DELETE = defineRoute<{ name: string }>(
  async ({ params, user }) => {
    const name = backupNameSchema.parse(params.name);
    await backupService.remove(name, { userId: user.id });
    return { ok: true };
  },
  { roles: ["admin"] },
);

export const runtime = "nodejs";
