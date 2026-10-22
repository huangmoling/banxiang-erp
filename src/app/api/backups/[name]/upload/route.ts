import { defineRoute } from "@/lib/api-handler";
import { backupNameSchema } from "@/modules/backup/backup.schema";
import { backupService } from "@/modules/backup/backup.service";

/** 把某一份备份补传到网盘（网络恢复后重传，不用再备一份） */
export const POST = defineRoute<{ name: string }>(
  async ({ params, user }) => {
    const name = backupNameSchema.parse(params.name);
    return backupService.uploadByName(name, { userId: user.id });
  },
  { roles: ["admin"] },
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
