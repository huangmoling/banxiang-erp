import { defineRoute } from "@/lib/api-handler";
import { inventoryInstanceQuerySchema } from "@/modules/inventory/inventory.schema";
import { inventoryService } from "@/modules/inventory/inventory.service";

/** 定制件台账：一物一码，从入库单到出库单全程可查 */
export const GET = defineRoute(async ({ req }) => {
  const query = inventoryInstanceQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  return inventoryService.instances({ q: query.q, status: query.status });
});

export const runtime = "nodejs";
