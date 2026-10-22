import { defineRoute } from "@/lib/api-handler";
import { backupService } from "@/modules/backup/backup.service";
import { ensureBackupScheduler } from "@/modules/backup/backup.scheduler";

/**
 * 备份列表 + 手动备份。全部只给管理员：
 * 备份文件等于整套账，能下载就走漏了；能恢复就能一键清空，更不能开给普通账号。
 */
export const GET = defineRoute(async () => {
  // 顺手把定时器点着：容器刚起来、还没到 20 秒的第一次 tick 时，点开页面也照样生效
  ensureBackupScheduler();
  return backupService.list();
}, { roles: ["admin"] });

export const POST = defineRoute(async ({ user }) => {
  return backupService.createManual({ userId: user.id });
}, { roles: ["admin"] });

export const runtime = "nodejs";
/** 备份要读整个库文件，别让 Next 预渲染；也不缓存 */
export const dynamic = "force-dynamic";
