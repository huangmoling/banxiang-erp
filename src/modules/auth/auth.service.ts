import "server-only";
import { env } from "@/lib/env";
import { UnauthorizedError, TooManyRequestsError, ValidationError, ForbiddenError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { signAccessToken } from "@/lib/jwt";
import { hashPassword, verifyPassword, generateRefreshToken, hashRefreshToken } from "@/lib/password";
import { authRepository } from "./auth.repository";
import type { AuthUser } from "@/lib/session";

/**
 * 登录失败限流：单进程内存计数。
 * 本项目是仓库单机部署（一个 Node 进程），内存计数足够；
 * 若将来改为多实例，需要换成共享存储（Redis）。
 *
 * ⚠ 必须**双维度**，只按「账号+IP」记是不够的：
 * route handler 拿不到 socket 地址，IP 只能从 `X-Forwarded-For` 读，
 * 而直连部署时这个头攻击者随便填——每换一个假 IP 就是一组新计数，
 * 限流形同虚设（2026-11-20 实测：伪造 XFF 连打 7 次，一次都没被拦）。
 * 所以真正兜底的是**账号维度**：不管从哪个 IP 来，同一个用户名连续失败都会锁。
 */
const WINDOW_MS = 15 * 60_000;
const USER_MAX = 10;
const IP_MAX = 30;
const LOCK_BASE_MS = 60_000;
const LOCK_MAX_MS = 15 * 60_000;
/** 超过这个条数就顺手清一遍过期项，避免 Map 无限长 */
const SWEEP_THRESHOLD = 2000;

type Attempt = { count: number; firstAt: number; lockedUntil: number; lockCount: number };
const attempts = new Map<string, Attempt>();

function userKey(username: string): string {
  return `u:${username.toLowerCase()}`;
}

function ipKey(ip: string): string {
  return `i:${ip}`;
}

function sweep(now: number): void {
  if (attempts.size <= SWEEP_THRESHOLD) return;
  for (const [k, a] of attempts) {
    if (a.lockedUntil <= now && now - a.firstAt > WINDOW_MS) attempts.delete(k);
  }
}

function check(key: string): void {
  const a = attempts.get(key);
  if (!a) return;
  if (a.lockedUntil > Date.now()) {
    const sec = Math.ceil((a.lockedUntil - Date.now()) / 1000);
    throw new TooManyRequestsError(`密码错误次数过多，请 ${sec} 秒后再试`);
  }
}

/**
 * 记一次失败。达到阈值就锁定，锁定时长按「第几次被锁」翻倍，
 * 上限 15 分钟——正常手滑输错不会难受，暴力穷举会被越拖越久。
 */
function recordFailure(key: string, max: number): void {
  const now = Date.now();
  const a = attempts.get(key) ?? { count: 0, firstAt: now, lockedUntil: 0, lockCount: 0 };

  // 窗口外的旧计数直接作废，重新开始
  if (now - a.firstAt > WINDOW_MS && a.lockedUntil <= now) {
    a.count = 0;
    a.firstAt = now;
  }

  a.count += 1;
  if (a.count >= max) {
    const backoff = Math.min(LOCK_BASE_MS * 2 ** a.lockCount, LOCK_MAX_MS);
    a.lockedUntil = now + backoff;
    a.lockCount += 1;
    a.count = 0;
    a.firstAt = now;
  }
  attempts.set(key, a);
  sweep(now);
}

function clearFailure(key: string): void {
  attempts.delete(key);
}

/** 改密码时「当前密码」的失败计数（按用户 ID） */
type PwdAttempt = { count: number; lockedUntil: number };
const pwdAttempts = new Map<string, PwdAttempt>();

function pwdGuard(userId: string): PwdAttempt {
  return pwdAttempts.get(userId) ?? { count: 0, lockedUntil: 0 };
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
    const uKey = userKey(input.username);
    const iKey = ipKey(meta.ip);
    check(uKey);
    check(iKey);

    const user = await authRepository.findByUsername(input.username);

    // 用户名不存在与密码错误给同一句话，避免被用来枚举账号
    if (!user || !user.isActive) {
      recordFailure(uKey, USER_MAX);
      recordFailure(iKey, IP_MAX);
      // 只记用户名和来源，不记密码。被爆破时能从这里看出是谁在打哪个账号
      logger.warn({ username: input.username, ip: meta.ip, reason: "no-user" }, "login failed");
      throw new UnauthorizedError("用户名或密码不正确");
    }

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      recordFailure(uKey, USER_MAX);
      recordFailure(iKey, IP_MAX);
      logger.warn({ username: input.username, ip: meta.ip, reason: "bad-password" }, "login failed");
      throw new UnauthorizedError("用户名或密码不正确");
    }

    // 成功只清账号维度；IP 维度留着——攻击者拿到一个正确账号也不能借此洗白来源计数
    clearFailure(uKey);

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
    // 「当前密码」也是一道密码关口：不计数就能被在线穷举，登进来的人照样能试穿旧口令
    const guard = pwdGuard(userId);
    if (guard.lockedUntil > Date.now()) {
      const sec = Math.ceil((guard.lockedUntil - Date.now()) / 1000);
      throw new TooManyRequestsError(`当前密码错误次数过多，请 ${sec} 秒后再试`);
    }

    const user = await authRepository.findById(userId);
    if (!user) throw new UnauthorizedError();

    const ok = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!ok) {
      guard.count += 1;
      if (guard.count >= 5) {
        guard.lockedUntil = Date.now() + 10 * 60_000;
        guard.count = 0;
      }
      pwdAttempts.set(userId, guard);
      throw new ValidationError("当前密码不正确", [{ field: "currentPassword", message: "当前密码不正确" }]);
    }
    pwdAttempts.delete(userId);

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
