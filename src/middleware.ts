import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/jwt";
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_PATH } from "@/lib/cookie-names";

/**
 * 页面路由守卫（不拦 API，API 自己鉴权）。
 * 逻辑：
 *   1. 没有访问令牌或已失效 → 有刷新令牌就走刷新换取，没有就去登录页
 *   2. 都正常 → 放行
 * 这样访问令牌可以是短时效（8 小时），用户体验上依然是「登录一次长期有效」。
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname === "/login" || pathname === "/") {
    return NextResponse.next();
  }

  const accessToken = req.cookies.get(ACCESS_COOKIE)?.value;
  if (accessToken) {
    const claims = await verifyAccessToken(accessToken, process.env.JWT_SECRET ?? "");
    if (claims) return NextResponse.next();
  }

  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    const url = req.nextUrl.clone();
    url.pathname = REFRESH_PATH;
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // 页面路由才走中间件；API、静态资源、上传文件一律放行
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|uploads).*)"],
};
