import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "./prisma";
import { env } from "./env";
import { ACCESS_COOKIE } from "./cookie-names";
import { verifyAccessToken } from "./jwt";
import { UnauthorizedError } from "./errors";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: string;
};

/**
 * 当前会话用户（服务端渲染与 API 共用）。
 * 读取 httpOnly Cookie → 校验签名 → 回查用户是否仍然有效。
 * 用 cache() 保证同一次请求内只查一次库。
 */
export const getSession = cache(async (): Promise<AuthUser | null> => {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifyAccessToken(token, env.JWT_SECRET);
  if (!claims) return null;

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      isActive: true,
      passwordChangedAt: true,
    },
  });

  if (!user || !user.isActive) return null;

  // 改过密码（或管理员重置过）之后，之前发出去的访问令牌一律作废。
  // 只撤销 refresh token 是不够的——那张还没过期的 access 令牌照样能开门。
  // 比对用毫秒戳而不是 iat：JWT 的 iat 只到秒，改密码与旧令牌的请求可能在同一秒内。
  if ((claims.pwd ?? null) !== (user.passwordChangedAt?.getTime() ?? null)) {
    return null;
  }

  // 角色 / 姓名每次都从库里取，改完立刻生效，不用等令牌过期
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
});

export async function requireSession(): Promise<AuthUser> {
  const user = await getSession();
  if (!user) throw new UnauthorizedError();
  return user;
}
