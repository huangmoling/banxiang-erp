import "server-only";
import type { NextResponse } from "next/server";
import { env } from "./env";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "./cookie-names";

/**
 * 令牌只放在 httpOnly Cookie 里：
 * 不进 localStorage（XSS 可读）、不进 URL（会被日志和 Referer 带走）。
 *
 * secure 固定为 false 是刻意的：本项目部署在仓库局域网，走 http://192.168.x.x，
 * 一旦设为 true，浏览器会拒绝保存 Cookie，登录会直接失效。
 * 将来若接入 HTTPS（例如开扫码功能时），把 secure 改成 env.isProd 即可。
 */
const BASE = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: false,
  path: "/",
};

export function setAuthCookies(
  res: NextResponse,
  tokens: { accessToken: string; refreshToken: string; accessMaxAge: number; refreshMaxAge: number },
): void {
  res.cookies.set(ACCESS_COOKIE, tokens.accessToken, { ...BASE, maxAge: tokens.accessMaxAge });
  res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, { ...BASE, maxAge: tokens.refreshMaxAge });
}

export function clearAuthCookies(res: NextResponse): void {
  res.cookies.set(ACCESS_COOKIE, "", { ...BASE, maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, "", { ...BASE, maxAge: 0 });
}

export const ACCESS_TTL = env.ACCESS_TOKEN_TTL;
