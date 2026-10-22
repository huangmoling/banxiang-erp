import "server-only";
import { prisma } from "@/lib/prisma";

export type UserRecord = {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: string;
  isActive: boolean;
  passwordChangedAt: Date | null;
};

export const authRepository = {
  findByUsername(username: string): Promise<UserRecord | null> {
    return prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayName: true,
        passwordHash: true,
        role: true,
        isActive: true,
        passwordChangedAt: true,
      },
    });
  },

  findById(id: string): Promise<UserRecord | null> {
    return prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        displayName: true,
        passwordHash: true,
        role: true,
        isActive: true,
        passwordChangedAt: true,
      },
    });
  },

  touchLogin(id: string) {
    return prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  },

  updatePassword(id: string, passwordHash: string) {
    // 顺手记下变更时间：会话校验拿它作废旧访问令牌
    return prisma.user.update({
      where: { id },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
  },

  createRefreshToken(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  }) {
    return prisma.refreshToken.create({ data });
  },

  findRefreshToken(tokenHash: string) {
    return prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true },
    });
  },

  revokeRefreshToken(id: string) {
    return prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  },

  revokeAllForUser(userId: string) {
    return prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  /** 清理过期令牌，避免表无限增长（可由定时任务或登录时顺带调用） */
  deleteExpired(now: Date) {
    return prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] },
    });
  },
};
