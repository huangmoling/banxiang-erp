import { defineRoute } from "@/lib/api-handler";
import { shipOutboundSchema } from "@/modules/outbound/outbound.schema";
import { outboundService } from "@/modules/outbound/outbound.service";

/**
 * 能确认发货的角色：内勤（clerk）不在这里——他只能提交，不能自己发。
 * 服务层还会再拦一道，前端藏按钮不算数。
 */
const WRITE_ROLES = ["admin", "manager", "keeper"];

/**
 * 按行确认发货：body 传这次发出去的 itemIds。
 * 一单几十个买家地址，缺货是常态——发掉哪几个就传哪几个，剩下的继续挂着。
 */
export const POST = defineRoute<{ id: string }>(
  async ({ params, req, user }) => {
    const body = shipOutboundSchema.parse(await req.json());
    return outboundService.ship(params.id, body.itemIds, { userId: user.id, role: user.role });
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
