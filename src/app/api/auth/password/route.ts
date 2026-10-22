import { defineRoute } from "@/lib/api-handler";
import { changePasswordSchema } from "@/modules/auth/auth.schema";
import { authService } from "@/modules/auth/auth.service";

export const PATCH = defineRoute(async ({ req, user }) => {
  const body = changePasswordSchema.parse(await req.json());
  await authService.changePassword(user.id, {
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
  });
  return { ok: true };
});
