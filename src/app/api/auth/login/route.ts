import { NextResponse } from "next/server";
import { defineRoute } from "@/lib/api-handler";
import { setAuthCookies } from "@/lib/auth-cookies";
import { authService } from "@/modules/auth/auth.service";
import { loginSchema } from "@/modules/auth/auth.schema";

/**
 * 取来源 IP，只用于粗粒度限流。
 *
 * ⚠ route handler 拿不到 socket 地址，这里的值**一定可以被伪造**（直连时随便写 XFF）。
 * 所以它只是第二道网，真正的兜底在 authService 的「账号维度」计数里。
 * 反代（nginx / 宝塔）会把真实来源追加到 XFF 末尾，取最后一段比取第一段靠谱：
 * 第一段是客户端自己填的，多半是假的。
 */
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export const POST = defineRoute(
  async ({ req }) => {
    const body = loginSchema.parse(await req.json());

    const result = await authService.login(body, {
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    const res = NextResponse.json({ data: { user: result.user } });
    setAuthCookies(res, result);
    return res;
  },
  { auth: false },
);
