import "server-only";
import { PrismaClient } from "@prisma/client";
import { env } from "./env";

/**
 * Prisma 单例。
 * 开发环境热更新会重复执行模块，必须挂在 globalThis 上，否则连接数会持续增长。
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isDev ? ["warn", "error"] : ["error"],
    datasources: { db: { url: env.DATABASE_URL } },
  });

if (!env.isProd) {
  globalForPrisma.prisma = prisma;
}
