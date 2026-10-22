import { NextResponse } from "next/server";
import { defineRoute } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ensureBackupScheduler } from "@/modules/backup/backup.scheduler";

/**
 * 健康检查：
 * - /api/health  存活（进程能响应即可）
 * - /api/health?ready=1  就绪（数据库可查）
 *
 * 顺手在这里把备份调度器点着，原因值得写清楚：
 * 调度器原来只挂在页面布局里，「容器重启后没人打开系统」的那些时段它是不存在的——
 * 半夜断电、早上没人登录，定时备份就等于停摆。
 * 而 docker-compose 的 healthcheck 每 30 秒就会打一次这里，无论有没有人用系统。
 * 所以这里是全站最靠得住的「进程起来了一定会被调用」的位置。
 * ensureBackupScheduler 是幂等的（globalThis 上挂着单例），打一万次也只注册一个定时器。
 */
export const GET = defineRoute(
  async ({ req }) => {
    ensureBackupScheduler();

    const ready = req.nextUrl.searchParams.get("ready") === "1";

    if (ready) {
      await prisma.$queryRaw`SELECT 1`;
      return NextResponse.json({ status: "ready", db: "ok", time: new Date().toISOString() });
    }

    return NextResponse.json({ status: "ok", time: new Date().toISOString() });
  },
  { auth: false },
);
