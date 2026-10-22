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

const DISPOSITIONS = ["scrap", "offline_sale", "self_dispose"] as const;

export const scrapItemSchema = z
  .object({
    skuId: z.string({ message: "请选择颜色" }).trim().min(1, "请选择颜色"),
    qty: z.coerce
      .number({ message: "数量请填数字" })
      .int("数量必须是整数，不能填小数")
      .min(1, "数量至少为 1")
      .max(99999, "单行数量过大，请拆成多张单"),
    disposition: z.enum(DISPOSITIONS, { message: "请选择处理方式" }),
    /** 定制款：处理掉的是哪几件（件号 id）。常规款传空数组 */
    instanceIds: z.array(z.string().trim().min(1)).max(50, "一行最多 50 件").optional().default([]),
    /** 行说明：自行处理要写清怎么处理的，报废建议写原因 */
    remark: z.string().trim().max(100, "行说明最多 100 个字").optional().nullable(),
  })
  .superRefine((val, ctx) => {
    const ids = val.instanceIds ?? [];
    if (ids.length > 0 && ids.length !== val.qty) {
      ctx.addIssue({
        code: "custom",
        path: ["qty"],
        message: "勾了几件就处理几件，数量要和勾选的件数一致",
      });
    }
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["instanceIds"],
        message: "同一件被勾了两次，请检查",
      });
    }
    // 自行处理最容易变成糊涂账：一年后没人记得那两把椅子去哪了
    if (val.disposition === "self_dispose" && !val.remark?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["remark"],
        message: "「自行处理」要写一句怎么处理的（送人 / 拆解 / 丢弃），不然以后查不出来",
      });
    }
  });

export type ScrapItemInput = z.infer<typeof scrapItemSchema>;

export const createScrapSchema = z
  .object({
    /** 货从哪个仓位出去：主仓（直接报废）或次品区（三条出路） */
    sourceLocationId: z
      .string({ message: "请选择源仓位" })
      .trim()
      .min(1, "请选择源仓位"),
    bizDate: pastOrTodayDate("业务日期").optional(),
    remark: z.string().trim().max(500, "备注最多 500 个字").optional().nullable(),
    items: z.array(scrapItemSchema).min(1, "至少录入一行").max(100, "一张单最多 100 行，请拆单"),
    /** true = 保存并立即生效；false = 只存草稿 */
    approveNow: z.boolean().optional().default(true),
  })
  .superRefine((val, ctx) => {
    // 同一个颜色出现在两行，说明录入的人自己也没想清怎么处理，合并掉更清楚
    const seen = new Map<string, number>();
    val.items.forEach((item, index) => {
      const first = seen.get(item.skuId);
      if (first !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "skuId"],
          message: `同一颜色出现了两次（第 ${first + 1} 行也有），请合并成一行`,
        });
      } else {
        seen.set(item.skuId, index);
      }
    });
  });

export type CreateScrapInput = z.infer<typeof createScrapSchema>;

export const listScrapQuerySchema = z.object({
  q: z.string().trim().max(60).optional().default(""),
  status: z.enum(["all", "draft", "approved", "voided"]).optional().default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListScrapQuery = z.infer<typeof listScrapQuerySchema>;

/** 源仓位的现有货：建单时用来列候选行 */
export const scrapStockQuerySchema = z.object({
  locationId: z.string({ message: "请选择源仓位" }).trim().min(1, "请选择源仓位"),
});

export type ScrapStockQuery = z.infer<typeof scrapStockQuerySchema>;
