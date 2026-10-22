import { defineRoute } from "@/lib/api-handler";
import { updateOutboundInfoSchema } from "@/modules/outbound/outbound.schema";
import { outboundService } from "@/modules/outbound/outbound.service";

/** 能开单 / 撤销自己整理的单。内勤也在里面，但服务层会限制他只能动自己开的单 */
const WRITE_ROLES = ["admin", "manager", "keeper", "clerk"];

export const GET = defineRoute<{ id: string }>(async ({ params }) => {
  return outboundService.detail(params.id);
});

export const DELETE = defineRoute<{ id: string }>(
  async ({ params, user }) => {
    await outboundService.remove(params.id, { userId: user.id, role: user.role });
    return { ok: true };
  },
  { roles: WRITE_ROLES },
);

/**
 * 只改「不动货」的四项：收货信息、物流单号、淘宝订单号、备注。
 * 明细和数量不在这里改——那些一动就影响库存，只能删单重开。
 */
export const PATCH = defineRoute<{ id: string }>(
  async ({ params, req, user }) => {
    const body = updateOutboundInfoSchema.parse(await req.json());
    return outboundService.updateInfo(params.id, body, { userId: user.id, role: user.role });
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
