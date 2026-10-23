import { NextRequest } from "next/server";
import { setAuthCookies, clearAuthCookies } from "@/lib/auth-cookies";
import { REFRESH_COOKIE } from "@/lib/cookie-names";
import { redirectTo } from "@/lib/redirect";
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
 * 这个端点不经过统一包装器，因为它返回的是 307 而不是 JSON。
 *
 * ⚠ 这里**只能**用相对路径跳转（redirectTo），不能用 `new URL(next, req.nextUrl.origin)`。
 * 容器内 `HOSTNAME=0.0.0.0`，Next 会把 origin 算成 `http://0.0.0.0:3000`，
 * 导致「每天第一次打开」跳到 0.0.0.0:3000（换域名+反向代理同样错）。详见 @/lib/redirect。
 */
export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;

  try {
    const result = await authService.rotate(refreshToken);
    const res = redirectTo(next);
    setAuthCookies(res, result);
    return res;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "session refresh failed");
    const res = redirectTo(`/login?next=${encodeURIComponent(next)}`);
    clearAuthCookies(res);
    return res;
  }
}
