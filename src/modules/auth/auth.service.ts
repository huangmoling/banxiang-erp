import "server-only";
import { env } from "@/lib/env";
import { UnauthorizedError, TooManyRequestsError, ValidationError, ForbiddenError } from "@/lib/errors";
import { signAccessToken } from "@/lib/jwt";
import { hashPassword, verifyPassword, generateRefreshToken, hashRefreshToken } from "@/lib/password";
import { authRepository } from "./auth.repository";
import type { AuthUser } from "@/lib/session";

/**
 * 登录失败限流：单进程内存计数。
 * 本项目是仓库单机部署（一个 Node 进程），内存计数足够；
 * 若将来改为多实例，需要换成共享存储（Redis）。
 */
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60_000;

type Attempt = { count: number; firstAt: number; lockedUntil: number };
const attempts = new Map<string, Attempt>();

function attemptKey(username: string, ip: string): string {
  return `${username.toLowerCase()}@${ip}`;
}

function checkLock(key: string): void {
  const a = attempts.get(key);
  if (!a) return;
  if (a.lockedUntil > Date.now()) {
    const sec = Math.ceil((a.lockedUntil - Date.now()) / 1000);
    throw new TooManyRequestsError(`密码错误次数过多，请 ${sec} 秒后再试`);
  }
  if (Date.now() - a.firstAt > LOCK_MS * 5) attempts.delete(key);
}

function recordFailure(key: string): void {
  const now = Date.now();
  const a = attempts.get(key) ?? { count: 0, firstAt: now, lockedUntil: 0 };
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) {
    a.lockedUntil = now + LOCK_MS;
    a.count = 0;
    a.firstAt = now;
  }
  attempts.set(key, a);
}

function clearFailure(key: string): void {
  attempts.delete(key);
}

export type LoginResult = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  accessMaxAge: number;
  refreshMaxAge: number;
};

export const authService = {
  async login(
    input: { username: string; password: string; remember?: boolean },
    meta: { ip: string; userAgent?: string | null },
  ): Promise<LoginResult> {
    const key = attemptKey(input.username, meta.ip);
    checkLock(key);

    const user = await authRepository.findByUsername(input.username);

    // 用户名不存在与密码错误给同一句话，避免被用来枚举账号
    if (!user || !user.isActive) {
      recordFailure(key);
      throw new UnauthorizedError("用户名或密码不正确");
    }

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      recordFailure(key);
      throw new UnauthorizedError("用户名或密码不正确");
    }

    clearFailure(key);

    const accessMaxAge = env.ACCESS_TOKEN_TTL;
    const refreshMaxAge = input.remember === false ? 60 * 60 * 24 : env.REFRESH_TOKEN_TTL;

    const accessToken = await signAccessToken(
      {
        sub: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        pwd: user.passwordChangedAt?.getTime() ?? null,
      },
      env.JWT_SECRET,
      accessMaxAge,
    );

    const refreshToken = generateRefreshToken();
    await authRepository.createRefreshToken({
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + refreshMaxAge * 1000),
      userAgent: meta.userAgent ?? null,
      ip: meta.ip,
    });
    await authRepository.touchLogin(user.id);

    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
      accessToken,
      refreshToken,
      accessMaxAge,
      refreshMaxAge,
    };
  },

  /**
   * 刷新令牌轮转：旧的立刻作废，换一对新的。
   * 这样即使刷新令牌泄露，也只能用一次。
   */
  async rotate(refreshToken: string | undefined): Promise<LoginResult> {
    if (!refreshToken) throw new UnauthorizedError("登录已过期，请重新登录");

    const tokenHash = hashRefreshToken(refreshToken);
    const record = await authRepository.findRefreshToken(tokenHash);

    if (!record || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError("登录已过期，请重新登录");
    }

    const user = await authRepository.findById(record.userId);
    if (!user || !user.isActive) throw new UnauthorizedError("账号已停用");

    await authRepository.revokeRefreshToken(record.id);

    const accessMaxAge = env.ACCESS_TOKEN_TTL;
    const refreshMaxAge = env.REFRESH_TOKEN_TTL;

    const accessToken = await signAccessToken(
      {
        sub: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        pwd: user.passwordChangedAt?.getTime() ?? null,
      },
      env.JWT_SECRET,
      accessMaxAge,
    );

    const nextRefresh = generateRefreshToken();
    await authRepository.createRefreshToken({
      userId: user.id,
      tokenHash: hashRefreshToken(nextRefresh),
      expiresAt: new Date(Date.now() + refreshMaxAge * 1000),
    });

    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
      accessToken,
      refreshToken: nextRefresh,
      accessMaxAge,
      refreshMaxAge,
    };
  },

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const record = await authRepository.findRefreshToken(hashRefreshToken(refreshToken));
    if (record && !record.revokedAt) {
      await authRepository.revokeRefreshToken(record.id);
    }
  },

  async changePassword(userId: string, input: { currentPassword: string; newPassword: string }): Promise<void> {
    const user = await authRepository.findById(userId);
    if (!user) throw new UnauthorizedError();

    const ok = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!ok) throw new ValidationError("当前密码不正确", [{ field: "currentPassword", message: "当前密码不正确" }]);

    if (input.currentPassword === input.newPassword) {
      throw new ValidationError("新密码不能与当前密码相同", [
        { field: "newPassword", message: "新密码不能与当前密码相同" },
      ]);
    }

    await authRepository.updatePassword(userId, await hashPassword(input.newPassword));
    // 改密码后让其他设备上的会话立刻失效
    await authRepository.revokeAllForUser(userId);
  },

  assertCanManageUsers(role: string): void {
    if (role !== "admin" && role !== "manager") {
      throw new ForbiddenError("只有管理员或店长可以管理账号");
    }
  },
};
