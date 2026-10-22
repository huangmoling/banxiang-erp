import { NextResponse } from "next/server";
import { defineRoute } from "@/lib/api-handler";
import { clearAuthCookies } from "@/lib/auth-cookies";
import { REFRESH_COOKIE } from "@/lib/cookie-names";
import { authService } from "@/modules/auth/auth.service";

export const POST = defineRoute(
  async ({ req }) => {
    const token = req.cookies.get(REFRESH_COOKIE)?.value;
    await authService.logout(token);
    const res = NextResponse.json({ data: { ok: true } });
    clearAuthCookies(res);
    return res;
  },
  { auth: false },
);
