import { defineRoute } from "@/lib/api-handler";
import { inboundService } from "@/modules/inbound/inbound.service";

const WRITE_ROLES = ["admin", "manager", "keeper"];

/** 审核入库：草稿 → 已生效，同时生成库存流水（这一步之后库存数字才动） */
export const POST = defineRoute<{ id: string }>(
  async ({ params, user }) => {
    return inboundService.approve(params.id, { userId: user.id });
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
