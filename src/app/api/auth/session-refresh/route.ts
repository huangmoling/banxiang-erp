import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies, clearAuthCookies } from "@/lib/auth-cookies";
import { REFRESH_COOKIE } from "@/lib/cookie-names";
import { authService } from "@/modules/auth/auth.service";
import { logger } from "@/lib/logger";

/** 只允许站内相对路径，挡住开放重定向 */
function safeNext(next: string | null): string {
  if (!next) return "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  return next;
}

/**
 * 由 middleware 触发：访问令牌过期时，用刷新令牌换一对新的，然后回到原页面。
 * 这个端点不经过统一包装器，因为它返回的是 302 而不是 JSON。
 */
export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;

  try {
    const result = await authService.rotate(refreshToken);
    const res = NextResponse.redirect(new URL(next, req.nextUrl.origin));
    setAuthCookies(res, result);
    return res;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "session refresh failed");
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("next", next);
    const res = NextResponse.redirect(url);
    clearAuthCookies(res);
    return res;
  }
}
