import { z } from "zod";

const q = z.string().trim().max(50, "搜索词太长").optional();
const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 2026-10-20")
  .optional();

export const inventoryQuerySchema = z.object({
  q,
  lowOnly: z.enum(["0", "1"]).optional(),
});

export const inventoryBatchQuerySchema = z.object({ q });

export const inventoryInstanceQuerySchema = z.object({
  q,
  status: z
    .enum(["all", "in_stock", "outbound", "returned", "defective", "scrapped", "sold_offline", "disposed", "missing", "voided"])
    .optional(),
});

export const inventoryMovementQuerySchema = z.object({
  q,
  bizType: z.enum(["all", "inbound", "outbound", "return_in", "scrap", "stocktake_adjust"]).optional(),
  from: dateOnly,
  to: dateOnly,
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(10).max(100).optional(),
});

export type InventoryMovementQuery = z.infer<typeof inventoryMovementQuerySchema>;
