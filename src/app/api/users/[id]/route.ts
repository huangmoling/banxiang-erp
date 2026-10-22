import { defineRoute } from "@/lib/api-handler";
import { updateUserSchema } from "@/modules/user/user.schema";
import { userService } from "@/modules/user/user.service";

/** 改姓名 / 角色 / 启停 */
export const PATCH = defineRoute<{ id: string }>(
  async ({ req, params, user }) => {
    const body = await req.json().catch(() => ({}));
    const input = updateUserSchema.parse(body);
    return userService.update(params.id, input, user.id);
  },
  { roles: ["admin"] },
);

export const runtime = "nodejs";
