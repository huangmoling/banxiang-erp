import { defineRoute } from "@/lib/api-handler";
import { stocktakeService } from "@/modules/stocktake/stocktake.service";

const WRITE_ROLES = ["admin", "manager", "keeper"];

export const GET = defineRoute<{ id: string }>(async ({ params }) => {
  return stocktakeService.detail(params.id);
});

export const DELETE = defineRoute<{ id: string }>(
  async ({ params, user }) => {
    await stocktakeService.remove(params.id, { userId: user.id });
    return { ok: true };
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
