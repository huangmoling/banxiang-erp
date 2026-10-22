import { defineRoute } from "@/lib/api-handler";
import { inventoryQuerySchema } from "@/modules/inventory/inventory.schema";
import { inventoryService } from "@/modules/inventory/inventory.service";

/** 库存汇总：一个颜色一行，可售 / 次品区 / 报废区分开算 */
export const GET = defineRoute(async ({ req }) => {
  const query = inventoryQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  return inventoryService.summary({ q: query.q, lowOnly: query.lowOnly === "1" });
});

export const runtime = "nodejs";
