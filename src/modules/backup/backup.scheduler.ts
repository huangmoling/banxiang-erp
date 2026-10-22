import "server-only";
import { logger } from "@/lib/logger";
import { prevCronRun } from "@/lib/cron";
import { backupDir, backupService } from "./backup.service";

/**
 * 定时备份调度。
 *
 * 没有引 cron 库，也没有另起进程：就一个每分钟醒一次的 setInterval，
 * 醒来读一次设置，问一句「上一个该跑的分钟，跑过了没」。
 *
 * 为什么不是「先记住下次几点，到点就减」：
 * 那种写法一旦服务在那一刻没运行（重启、升级、断电），这一趟就永远错过了。
 * 反过来算「上一个应该跑的分钟」就没有这个洞——
 * 3 点没跑，8 点开机，tick 一算“上一个 3 点还没跑过”，当场补一份。
 * 所以这里用 cron 表达式也不会因为重启漏掉一次。
 *
 * 三个必须想清楚的点：
 * 1. **只在 nodejs 运行时启动**（不能放 instrumentation，会被 edge 编译，node:fs 直接构建失败）。
 * 2. **用 globalThis 挂定时器**：dev 模式热更新会重复执行模块，不挂全局就会攒出一堆定时器，
 *    同一个时间点跑出十几份备份。
 * 3. **同一分钟不重复跑**：lastAutoAt 记的是「跑完的时刻」，只要它不早于「上一个该跑的分钟」，
 *    就说明这一趟已经做过了。这也是 cron 改成每分钟时的防重入。
 */

type Timer = ReturnType<typeof setInterval>;

const TICK_MS = 60_000;

let running = false;

/** 这一趟该不该跑：拿「上一个应该触发的分钟」跟「上次实际跑完的时间」比 */
function isDue(cron: string, lastAutoAt: string | null, now: Date): boolean {
  const slot = prevCronRun(cron, now);
  if (!slot) return false;

  if (!lastAutoAt) return true;

  const last = new Date(lastAutoAt);
  if (Number.isNaN(last.getTime())) return true;

  // 上次跑完的时刻已经跨过（或正好是）这个时间点 → 这一趟做过了
  return last.getTime() < slot.getTime();
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const settings = await backupService.getSettings();
    if (!settings.enabled) return;

    const now = new Date();
    if (!isDue(settings.cron, settings.lastAutoAt, now)) return;

    const result = await backupService.runScheduled();
    logger.info(
      {
        file: result.file.name,
        removed: result.removed.length,
        uploaded: result.upload?.ok ?? null,
      },
      "scheduled backup finished",
    );

    if (result.upload && !result.upload.ok) {
      logger.warn({ err: result.upload.error }, "scheduled backup uploaded failed");
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, "scheduled backup failed");
  } finally {
    running = false;
  }
}

/**
 * 启动定时器（幂等）。从 (app)/layout.tsx 和 /api/backups 两处调，
 * 保证「容器启动就跑」和「打开备份页也一定会跑」都成立。
 */
export function ensureBackupScheduler(): void {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as unknown as { __sutengBackupTimer?: Timer };
  if (g.__sutengBackupTimer) return;

  const timer = setInterval(() => {
    void tick();
  }, TICK_MS);

  // 别让定时器把进程吊着（容器里无所谓，本地 dev 里 Ctrl+C 要能停）
  timer.unref?.();
  g.__sutengBackupTimer = timer;

  // 启动后 20 秒先看一次：容器重启正好错过了那个时间点，这一下就补上了
  setTimeout(() => void tick(), 20_000).unref?.();

  logger.info({ dir: backupDir() }, "backup scheduler started");
}
