import { NextResponse } from "next/server";
import { defineRoute } from "@/lib/api-handler";
import { setAuthCookies } from "@/lib/auth-cookies";
import { authService } from "@/modules/auth/auth.service";
import { loginSchema } from "@/modules/auth/auth.schema";

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "local";
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
