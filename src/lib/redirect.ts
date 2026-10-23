import { NextResponse } from "next/server";

/**
 * 站内跳转一律用「相对路径 Location」，禁止拼绝对地址。
 *
 * 为什么（2026-10-23 修的那个隔夜跳 0.0.0.0:3000 的坑）：
 * 容器里 `Dockerfile` 设了 `ENV HOSTNAME=0.0.0.0`（绑卡必须），而 Next 独立服务器
 * 把这个 HOSTNAME 当成了「应用自己的访问地址」：
 *   next-server.js → initUrl = `${protocol}://${fetchHostname}:${port}${req.url}`
 * 于是路由处理器里 `req.nextUrl.origin` 恒等于 `http://0.0.0.0:3000`，**不看 Host 头**。
 * 用它拼 `new URL("/dashboard", origin)` 就会把浏览器送到一个打不开的地址；
 * 换成域名 + 反向代理后一样错，因为 Host 头从头到尾没被读过。
 *
 * 相对 Location 由浏览器按「当前访问用的地址」自己解析，于是：
 * 局域网 IP、公网域名、端口映射（3080→3000）、http / https 全都不用管，
 * 也不需要额外配一行「站点公网地址」的变量（配了就会忘记改、改错）。
 */
export function redirectTo(pathAndQuery: string, status: 303 | 307 = 307): NextResponse {
  // 只允许站内路径：挡住 //evil.com、http://evil.com 这类开放重定向
  const safe =
    pathAndQuery.startsWith("/") && !pathAndQuery.startsWith("//") && !pathAndQuery.startsWith("/\\")
      ? pathAndQuery
      : "/dashboard";

  return new NextResponse(null, { status, headers: { location: safe } });
}

/** 拼「路径 + 查询串」，用于把用户送回来时那一页 */
export function withQuery(pathname: string, search: string): string {
  return search ? `${pathname}${search}` : pathname;
}
