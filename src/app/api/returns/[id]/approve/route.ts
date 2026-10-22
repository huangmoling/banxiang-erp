import { defineRoute } from "@/lib/api-handler";
import { returnService } from "@/modules/returns/return.service";

const WRITE_ROLES = ["admin", "manager", "keeper"];

/** 审核退货：草稿 → 已生效，良品回架才真正加回可售库存 */
export const POST = defineRoute<{ id: string }>(
  async ({ params, user }) => {
    return returnService.approve(params.id, { userId: user.id });
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
