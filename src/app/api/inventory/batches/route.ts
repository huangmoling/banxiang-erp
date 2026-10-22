import { defineRoute } from "@/lib/api-handler";
import { inventoryBatchQuerySchema } from "@/modules/inventory/inventory.schema";
import { inventoryService } from "@/modules/inventory/inventory.service";

/** 批次明细：只列还有余量的批次，按生产日期先后排 */
export const GET = defineRoute(async ({ req }) => {
  const query = inventoryBatchQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  return inventoryService.batches({ q: query.q });
});

export const runtime = "nodejs";
