import { defineRoute } from "@/lib/api-handler";
import { scrapService } from "@/modules/scrap/scrap.service";

const WRITE_ROLES = ["admin", "manager", "keeper"];

/** 审核处置单：草稿 → 已生效，库存这一步才真正动 */
export const POST = defineRoute<{ id: string }>(
  async ({ params, user }) => {
    return scrapService.approve(params.id, { userId: user.id });
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
