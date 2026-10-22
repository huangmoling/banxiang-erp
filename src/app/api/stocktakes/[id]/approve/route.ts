import { defineRoute } from "@/lib/api-handler";
import { stocktakeService } from "@/modules/stocktake/stocktake.service";

const WRITE_ROLES = ["admin", "manager", "keeper"];

/** 审核盘点：草稿 → 已生效，差异在这一步才写进库存 */
export const POST = defineRoute<{ id: string }>(
  async ({ params, user }) => {
    return stocktakeService.approve(params.id, { userId: user.id });
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
