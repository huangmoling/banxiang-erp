import { z } from "zod";

const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 2026-10-20")
  .optional();

export const exportQuerySchema = z.object({
  q: z.string().trim().max(50, "搜索词太长").optional(),
  bizType: z.enum(["all", "inbound", "outbound", "return_in", "scrap", "stocktake_adjust"]).optional(),
  status: z
    .enum(["all", "in_stock", "outbound", "returned", "defective", "scrapped", "sold_offline", "disposed", "missing", "voided"])
    .optional(),
  type: z.enum(["all", "inbound", "outbound", "return", "scrap", "stocktake"]).optional(),
  from: dateOnly,
  to: dateOnly,
});
