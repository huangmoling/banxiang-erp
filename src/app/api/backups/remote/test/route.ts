import { defineRoute } from "@/lib/api-handler";
import { remoteTestSchema } from "@/modules/backup/backup.schema";
import { backupService } from "@/modules/backup/backup.service";

/**
 * 测试云端连接（OpenList / 坚果云）。
 * 允许传界面上还没保存的参数——免得人先保存一套错的配置、再点测试、再改回来。
 */
export const POST = defineRoute(
  async ({ req }) => {
    const body = remoteTestSchema.parse(await req.json().catch(() => ({})));
    return backupService.testRemote(body);
  },
  { roles: ["admin"] },
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
