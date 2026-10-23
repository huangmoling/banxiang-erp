import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/jwt";
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_PATH } from "@/lib/cookie-names";

/**
 * 页面路由守卫（不拦 API，API 自己鉴权）。
 * 逻辑：
 *   1. 没有访问令牌或已失效 → 有刷新令牌就走刷新换取，没有就去登录页
 *   2. 都正常 → 放行
 * 这样访问令牌可以是短时效（8 小时），用户体验上依然是「登录一次长期有效」。
 *
 * ⚠ 这里必须用 `req.nextUrl.clone()` 构造跳转地址，**不能**手写 `location: /path`：
 * middleware 跑在 edge 运行时，Next 会对返回的 Location 再做一次 `new URL()` 解析
 * （`web/adapter.js`），相对地址会直接 500（Invalid URL）。
 * 好在 Next 自己会把同源跳转发成相对 Location，浏览器按当前访问地址解析，不会漏出内网地址。
 *
 * ⚠ 反过来说，**路由处理器里（route.ts）不要用 `req.nextUrl.origin` 拼绝对地址**，
 * 那里 Next 不做相对化，容器 `HOSTNAME=0.0.0.0` 会让它变成 `http://0.0.0.0:3000`。
 * 路由处理器用 `@/lib/redirect` 的 `redirectTo()`。
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

  // 带上查询串：从「出库?status=pending」被踢出去，刷新完还能回到同一页
  const back = `${pathname}${search}`;

  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    const url = req.nextUrl.clone();
    url.pathname = REFRESH_PATH;
    url.search = "";
    url.searchParams.set("next", back);
    return NextResponse.redirect(url);
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", back);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // 页面路由才走中间件；API、静态资源、上传文件一律放行
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|uploads).*)"],
};
