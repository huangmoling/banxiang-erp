import { inventoryService } from "@/modules/inventory/inventory.service";
import { InventoryClient } from "./inventory-client";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  // 首屏由服务端算好，切 tab 之后才走接口，避免打开就是一片转圈
  const initial = await inventoryService.summary();
  return <InventoryClient initial={initial} />;
}
