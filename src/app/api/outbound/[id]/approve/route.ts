import { defineRoute } from "@/lib/api-handler";
import { outboundService } from "@/modules/outbound/outbound.service";

/** 能确认发货的角色：内勤（clerk）不在这里——他只能提交，不能自己发 */
const WRITE_ROLES = ["admin", "manager", "keeper"];

/** 审核出库：草稿 → 已生效，同时生成负数流水（这一步之后库存才减） */
export const POST = defineRoute<{ id: string }>(
  async ({ params, user }) => {
    return outboundService.approve(params.id, { userId: user.id, role: user.role });
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
