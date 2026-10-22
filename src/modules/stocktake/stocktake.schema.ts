import { z } from "zod";
import { parseLocalDateTime } from "@/lib/date";

/** 盘点最多能往回填几天。再往前就不是「刚盘的」，而是改历史账了 */
const MAX_BACKDATE_DAYS = 7;

const snapshotAtSchema = z
  .string({ message: "请填写盘点截止时点" })
  .trim()
  .min(1, "请填写盘点截止时点")
  .refine((v) => parseLocalDateTime(v) !== null, "截止时点格式不对，应形如 2026-10-20 20:15")
  .refine((v) => {
    const d = parseLocalDateTime(v);
    return d !== null && d.getTime() <= Date.now();
  }, "截止时点不能晚于现在——还没到的时刻数不出实物")
  .refine((v) => {
    const d = parseLocalDateTime(v);
    return d !== null && d.getTime() >= Date.now() - MAX_BACKDATE_DAYS * 86_400_000;
  }, `截止时点最多只能往回填 ${MAX_BACKDATE_DAYS} 天，更早的盘点请在备注里说明`);

/**
 * 盘点一行。注意 bookQty 不收：账面数一律由后端按截止时点自己算，
 * 前端传什么都不作数——账面数被客户端改一下，这次盘点就成了笑话。
 */
export const stocktakeItemSchema = z
  .object({
    skuId: z.string({ message: "请选择商品颜色" }).trim().min(1, "请选择商品颜色"),
    countedQty: z.coerce
      .number({ message: "实盘数请填数字" })
      .int("实盘数必须是整数，半件货没法入账")
      .min(0, "实盘数不能是负数")
      .max(99999, "实盘数过大，请核对"),
    /** 定制款盘亏：具体少了哪几件（件 id）。常规款传空数组 */
    instanceIds: z.array(z.string().trim().min(1)).max(50, "一行最多 50 件").optional().default([]),
    remark: z.string().trim().max(100, "行备注最多 100 个字").optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (new Set(val.instanceIds ?? []).size !== (val.instanceIds ?? []).length) {
      ctx.addIssue({ code: "custom", path: ["instanceIds"], message: "同一件被勾了两次，请检查" });
    }
  });

export type StocktakeItemInput = z.infer<typeof stocktakeItemSchema>;

export const createStocktakeSchema = z
  .object({
    /** 一张盘点单只盘一个仓位 */
    locationId: z.string({ message: "请选择要盘的仓位" }).trim().min(1, "请选择要盘的仓位"),
    /** 截止时点：账面数按这个时刻切，之后照常发货不影响盘点 */
    snapshotAt: snapshotAtSchema,
    remark: z.string().trim().max(500, "备注最多 500 个字").optional().nullable(),
    items: z
      .array(stocktakeItemSchema)
      .min(1, "至少要盘一行，空盘点单没有意义")
      .max(300, "一张单最多 300 行，请按仓位拆开盘"),
    approveNow: z.boolean().optional().default(false),
  })
  .superRefine((val, ctx) => {
    const seen = new Set<string>();
    val.items.forEach((item, index) => {
      if (seen.has(item.skuId)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "skuId"],
          message: "同一个颜色在单子里重复出现，请合并成一行",
        });
      }
      seen.add(item.skuId);
    });
  });

export type CreateStocktakeInput = z.infer<typeof createStocktakeSchema>;

export const listStocktakeQuerySchema = z.object({
  q: z.string().trim().max(60).optional().default(""),
  status: z.enum(["all", "draft", "approved", "voided"]).optional().default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListStocktakeQuery = z.infer<typeof listStocktakeQuerySchema>;

/** 生成盘点表：给哪个仓位、截止到哪个时点 */
export const sheetQuerySchema = z.object({
  locationId: z.string({ message: "请选择要盘的仓位" }).trim().min(1, "请选择要盘的仓位"),
  snapshotAt: snapshotAtSchema.optional(),
});

export type SheetQuery = z.infer<typeof sheetQuerySchema>;
