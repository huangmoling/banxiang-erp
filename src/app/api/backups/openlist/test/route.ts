import { defineRoute } from "@/lib/api-handler";
import { openlistTestSchema } from "@/modules/backup/backup.schema";
import { backupService } from "@/modules/backup/backup.service";

/**
 * 测试网盘连接。允许传界面上还没保存的参数——
 * 免得人先保存一套错的配置、再点测试、再改回来。
 */
export const POST = defineRoute(
  async ({ req }) => {
    const body = openlistTestSchema.parse(await req.json().catch(() => ({})));
    return backupService.testOpenlist(body);
  },
  { roles: ["admin"] },
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
