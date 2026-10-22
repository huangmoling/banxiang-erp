import { defineRoute } from "@/lib/api-handler";
import { backupSettingsSchema } from "@/modules/backup/backup.schema";
import { backupService } from "@/modules/backup/backup.service";

/**
 * 保存备份设置：开关、cron 表达式、保留几份、网盘上传配置。
 * 改完立刻生效，不用重启——调度器每分钟读一次设置。
 */
export const PATCH = defineRoute(
  async ({ req, user }) => {
    const body = backupSettingsSchema.parse(await req.json());
    return backupService.saveSettings(body, { userId: user.id });
  },
  { roles: ["admin"] },
);

export const runtime = "nodejs";
