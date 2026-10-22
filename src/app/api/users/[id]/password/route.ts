import { defineRoute } from "@/lib/api-handler";
import { resetPasswordSchema } from "@/modules/user/user.schema";
import { userService } from "@/modules/user/user.service";

/** 管理员重置密码：重置后该账号的登录全部失效 */
export const POST = defineRoute<{ id: string }>(
  async ({ req, params, user }) => {
    const body = await req.json().catch(() => ({}));
    const input = resetPasswordSchema.parse(body);
    await userService.resetPassword(params.id, input.newPassword, user.id);
    return { ok: true };
  },
  { roles: ["admin"] },
);

export const runtime = "nodejs";
