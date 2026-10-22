import { defineRoute } from "@/lib/api-handler";
import { createUserSchema } from "@/modules/user/user.schema";
import { userService } from "@/modules/user/user.service";

/** 账号列表 / 新增账号。只有管理员能进来 */
export const GET = defineRoute(async () => userService.list(), { roles: ["admin"] });

export const POST = defineRoute(
  async ({ req, user }) => {
    const body = await req.json().catch(() => ({}));
    const input = createUserSchema.parse(body);
    return userService.create(input, user.id);
  },
  { roles: ["admin"] },
);

export const runtime = "nodejs";
