import "server-only";
import { prisma } from "@/lib/prisma";

/** 账号仓储层。注意：任何查询都不把 passwordHash 带出去 */
export const userRepository = {
  list() {
    return prisma.user.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    });
  },

  findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, displayName: true, role: true, isActive: true },
    });
  },

  findByUsername(username: string): Promise<{ id: string } | null> {
    return prisma.user.findUnique({ where: { username }, select: { id: true } });
  },

  create(data: { username: string; displayName: string; role: string; passwordHash: string }) {
    return prisma.user.create({
      data,
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  },

  update(
    id: string,
    data: { displayName?: string; role?: string; isActive?: boolean },
  ) {
    return prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  },

  updatePassword(id: string, passwordHash: string) {
    // 记下变更时间：管理员重置密码后，对方手里的旧令牌要立刻作废
    return prisma.user.update({
      where: { id },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
  },

  /** 改密码 / 停用后，把这个人的登录会话全部作废，避免旧设备还挂着 */
  revokeSessions(userId: string) {
    return prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  /** 还能干活的管理员数量：停用或降级前必须确认不会变成 0 —— 那套系统就没人管得了了 */
  countActiveAdmins(excludeId?: string) {
    return prisma.user.count({
      where: {
        role: "admin",
        isActive: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  },
};

export type UserRepository = typeof userRepository;
