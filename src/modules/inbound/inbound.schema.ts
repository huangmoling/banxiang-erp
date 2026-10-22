import { z } from "zod";
import { parseDateOnly, startOfToday } from "@/lib/date";

/** 只接受 YYYY-MM-DD，并且必须是真实存在、不在未来的自然日 */
const pastOrTodayDate = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label}格式应为 YYYY-MM-DD`)
    .refine((v) => parseDateOnly(v) !== null, `${label}不是一个有效日期`)
    .refine((v) => {
      const d = parseDateOnly(v);
      return d !== null && d.getTime() <= startOfToday().getTime();
    }, `${label}不能晚于今天`);

export const inboundItemSchema = z.object({
  skuId: z.string().trim().min(1, "请选择颜色"),
  qty: z.coerce
    .number({ message: "数量请填数字" })
    .int("数量必须是整数，不能填小数")
    .min(1, "数量至少为 1")
    .max(99999, "单行数量过大，请拆成多张单"),
  productionDate: pastOrTodayDate("生产日期").optional().nullable(),
  remark: z.string().trim().max(100, "行备注最多 100 个字").optional().nullable(),
});

export type InboundItemInput = z.infer<typeof inboundItemSchema>;

export const createInboundSchema = z
  .object({
    bizDate: pastOrTodayDate("业务日期").optional(),
    locationId: z.string().trim().optional().nullable(),
    remark: z.string().trim().max(500, "备注最多 500 个字").optional().nullable(),
    items: z.array(inboundItemSchema).min(1, "至少录入一行").max(100, "一张单最多 100 行，请拆单"),
    /** true = 保存并立即审核生效；false = 只存草稿 */
    approveNow: z.boolean().optional().default(true),
  })
  .superRefine((val, ctx) => {
    // 同一 SKU + 同一生产日期重复出现时，其实是一批货，应合并成一行
    const seen = new Set<string>();
    val.items.forEach((item, index) => {
      const key = `${item.skuId}__${item.productionDate ?? ""}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "skuId"],
          message: "同一颜色的同一生产日期重复了，请合并成一行",
        });
      }
      seen.add(key);
    });
  });

export type CreateInboundInput = z.infer<typeof createInboundSchema>;

export const listInboundQuerySchema = z.object({
  q: z.string().trim().max(60).optional().default(""),
  status: z.enum(["all", "draft", "approved", "voided"]).optional().default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListInboundQuery = z.infer<typeof listInboundQuerySchema>;
