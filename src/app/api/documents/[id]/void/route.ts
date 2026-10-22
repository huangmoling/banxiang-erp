import { z } from "zod";
import { defineRoute } from "@/lib/api-handler";
import { voidService } from "@/modules/document/void.service";

/**
 * 统一红冲入口：/api/documents/{id}/void
 * 入库 / 出库 / 退货 / 报废处置四种单据共用一条路由，
 * 因为红冲的动作本质相同（补反向流水），差异在服务层按 type 分派。
 * 权限比建单更紧：只有管理员和店长能冲已经生效的账。
 */
const VOID_ROLES = ["admin", "manager"];

const voidSchema = z.object({
  reason: z
    .string({ message: "请填写红冲原因" })
    .trim()
    .min(2, "红冲原因至少 2 个字，以后翻账要能看懂")
    .max(200, "红冲原因 200 字以内就好"),
});

export const POST = defineRoute<{ id: string }>(
  async ({ params, req, user }) => {
    const body = await req.json().catch(() => ({}));
    const input = voidSchema.parse(body);
    return voidService.voidDocument(params.id, { userId: user.id }, input.reason);
  },
  { roles: VOID_ROLES },
);

export const runtime = "nodejs";
