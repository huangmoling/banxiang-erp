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

export const outboundItemSchema = z
  .object({
    skuId: z.string().trim().min(1, "请选择颜色"),
    qty: z.coerce
      .number({ message: "数量请填数字" })
      .int("数量必须是整数，不能填小数")
      .min(1, "数量至少为 1")
      .max(99999, "单行数量过大，请拆成多张单"),
    /** 指定批次；留空 = 由系统按生产日期先后自动扣 */
    batchNo: z.string().trim().max(40, "批次号过长").optional().nullable(),
    /** 定制款：出库的是哪几件（编号 id）。常规款传空数组 */
    instanceIds: z.array(z.string().trim().min(1)).max(50, "一行最多 50 件").optional().default([]),
    remark: z.string().trim().max(100, "行备注最多 100 个字").optional().nullable(),
  })
  .superRefine((val, ctx) => {
    const ids = val.instanceIds ?? [];
    if (ids.length > 0 && ids.length !== val.qty) {
      ctx.addIssue({
        code: "custom",
        path: ["qty"],
        message: "勾了几件就出几件，数量要和勾选的件数一致",
      });
    }
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["instanceIds"],
        message: "同一件被勾了两次，请检查",
      });
    }
  });

export type OutboundItemInput = z.infer<typeof outboundItemSchema>;

export const createOutboundSchema = z
  .object({
    bizDate: pastOrTodayDate("业务日期").optional(),
    locationId: z.string().trim().optional().nullable(),
    /** 淘宝订单号：退货时要靠它反查原单 */
    externalNo: z.string().trim().max(60, "订单号过长").optional().nullable(),
    receiverName: z.string().trim().max(40, "收件人最多 40 个字").optional().nullable(),
    trackingNo: z.string().trim().max(60, "物流单号过长").optional().nullable(),
    remark: z.string().trim().max(500, "备注最多 500 个字").optional().nullable(),
    items: z.array(outboundItemSchema).min(1, "至少录入一行").max(100, "一张单最多 100 行，请拆单"),
    /** true = 保存并立即审核生效；false = 只存草稿 */
    approveNow: z.boolean().optional().default(true),
  })
  .superRefine((val, ctx) => {
    // 同一个颜色同一个批次出现两次，其实是一行，合并掉更清楚
    const seen = new Set<string>();
    val.items.forEach((item, index) => {
      const key = `${item.skuId}__${item.batchNo ?? ""}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "skuId"],
          message: "同一颜色同一批次重复了，请合并成一行",
        });
      }
      seen.add(key);
    });
  });

export type CreateOutboundInput = z.infer<typeof createOutboundSchema>;

export const listOutboundQuerySchema = z.object({
  q: z.string().trim().max(60).optional().default(""),
  status: z.enum(["all", "draft", "approved", "voided"]).optional().default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListOutboundQuery = z.infer<typeof listOutboundQuerySchema>;

/** 可用量查询：一次问多个 SKU，避免选中一个查一次 */
export const availabilityQuerySchema = z.object({
  skuIds: z
    .string()
    .trim()
    .min(1, "缺少 skuIds")
    .transform((v) => [...new Set(v.split(",").map((s) => s.trim()).filter(Boolean))])
    .refine((ids) => ids.length <= 50, "一次最多查询 50 个颜色"),
});

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
