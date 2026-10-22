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

/**
 * 退货明细。注意这里**不收 skuId**：SKU 一律从原出库行推导，
 * 否则前端传错一个颜色，货就退到别的颜色上了。
 */
export const returnItemSchema = z
  .object({
    originItemId: z
      .string({ message: "请选原出库单里的哪一行" })
      .trim()
      .min(1, "请选原出库单里的哪一行"),
    qty: z.coerce
      .number({ message: "退货数量请填数字" })
      .int("退货数量必须是整数，不能填小数")
      .min(1, "退货数量至少为 1")
      .max(99999, "单行退货数量过大，请核对"),
    destination: z.enum(["good", "defective", "scrap"], {
      message: "请选择退货去向：良品回架 / 次品区 / 报废",
    }),
    /** 定制款：退回来的是哪几件（件 id）。常规款传空数组 */
    instanceIds: z.array(z.string().trim().min(1)).max(50, "一行最多 50 件").optional().default([]),
    remark: z.string().trim().max(100, "行备注最多 100 个字").optional().nullable(),
  })
  .superRefine((val, ctx) => {
    const ids = val.instanceIds ?? [];
    if (ids.length > 0 && ids.length !== val.qty) {
      ctx.addIssue({
        code: "custom",
        path: ["qty"],
        message: "勾了几件就退几件，数量要和勾选的件数一致",
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

export type ReturnItemInput = z.infer<typeof returnItemSchema>;

export const createReturnSchema = z
  .object({
    /** 退货必须挂靠原出库单，不允许凭空退货 */
    originDocumentId: z
      .string({ message: "退货必须先选一张原出库单" })
      .trim()
      .min(1, "退货必须先选一张原出库单"),
    bizDate: pastOrTodayDate("退货日期").optional(),
    /** 淘宝订单号一般从原单带过来，允许手改（买家可能另开单退） */
    externalNo: z.string().trim().max(60, "订单号过长").optional().nullable(),
    receiverName: z.string().trim().max(40, "退回人最多 40 个字").optional().nullable(),
    /** 买家寄回的物流单号 */
    trackingNo: z.string().trim().max(60, "物流单号过长").optional().nullable(),
    remark: z.string().trim().max(500, "备注最多 500 个字").optional().nullable(),
    items: z.array(returnItemSchema).min(1, "至少录入一行").max(100, "一张单最多 100 行，请拆单"),
    approveNow: z.boolean().optional().default(true),
  })
  .superRefine((val, ctx) => {
    // 同一个原出库行出现两次 → 合并成一行，否则「已发 3 退 2 + 退 2」会各自过校验
    const seen = new Set<string>();
    val.items.forEach((item, index) => {
      if (seen.has(item.originItemId)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "originItemId"],
          message: "同一行原出库明细重复了，请合并成一行",
        });
      }
      seen.add(item.originItemId);
    });
  });

export type CreateReturnInput = z.infer<typeof createReturnSchema>;

export const listReturnQuerySchema = z.object({
  q: z.string().trim().max(60).optional().default(""),
  status: z.enum(["all", "draft", "approved", "voided"]).optional().default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListReturnQuery = z.infer<typeof listReturnQuerySchema>;

/** 搜原出库单：按单号 / 淘宝订单号 / 物流单号 / 收件人 / 产品名 */
export const searchOriginQuerySchema = z.object({
  q: z.string().trim().max(60).optional().default(""),
  limit: z.coerce.number().int().min(1).max(30).default(8),
});

export type SearchOriginQuery = z.infer<typeof searchOriginQuerySchema>;
