import { defineRoute } from "@/lib/api-handler";
import { inventoryMovementQuerySchema } from "@/modules/inventory/inventory.schema";
import { inventoryService } from "@/modules/inventory/inventory.service";

/** 库存流水：所有进出仓的原始记录，红冲的反向流水也列在这里（正负两笔并排） */
export const GET = defineRoute(async ({ req }) => {
  const query = inventoryMovementQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  return inventoryService.movements(query);
});

export const runtime = "nodejs";
