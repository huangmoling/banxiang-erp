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
    /**
     * 这一行的收货信息：一行 = 一个买家 = 一个包裹。
     * 留空表示沿用单据上的整单地址（老单据、单买家场景都靠这个回退）。
     */
    receiverInfo: z
      .string()
      .trim()
      .max(300, "收货信息最多 300 个字，超了请精简一下地址")
      .optional()
      .nullable(),
    externalNo: z.string().trim().max(60, "订单号过长").optional().nullable(),
    trackingNo: z.string().trim().max(60, "物流单号过长").optional().nullable(),
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
    /** 淘宝订单号：退货时要靠它反查原单。内勤整理工单时经常还没拿到，所以选填 */
    externalNo: z.string().trim().max(60, "订单号过长").optional().nullable(),
    /**
     * 收货信息：姓名 / 电话 / 地址整段粘在一起，允许换行。
     * 系统不拆分、不校验格式——内勤从淘宝后台复制过来直接贴，比逼他分成三个框更快。
     * 代价是按电话/地区做统计不可能，要那类功能就得回头做结构化，那是另一件事。
     */
    receiverName: z
      .string()
      .trim()
      .max(300, "收货信息最多 300 个字，超了请精简一下地址")
      .optional()
      .nullable(),
    trackingNo: z.string().trim().max(60, "物流单号过长").optional().nullable(),
    remark: z.string().trim().max(500, "备注最多 500 个字").optional().nullable(),
    /** 一张单就是一天的量：200 行 ≈ 200 个包裹，再多就拆单 */
    items: z.array(outboundItemSchema).min(1, "至少录入一行").max(200, "一张单最多 200 行，请拆单"),
    /** true = 保存并立即审核生效；false = 只存草稿 */
    approveNow: z.boolean().optional().default(true),
    /** true = 存成「待发货工单」交给仓管（内勤用的就是这个） */
    submitAfterSave: z.boolean().optional().default(false),
  });
// 注意：这里**不做「同 SKU 同批次」去重**。一单多地址以后，三个买家都买
// 「米白沙发·同批次」就是三行相同 SKU，这是正常情况，去重会把人正常录单挡在门外。
// 防重复录入靠提交前的确认弹窗把整单摆出来看一眼，比在服务端猜意图管用。

export type CreateOutboundInput = z.infer<typeof createOutboundSchema>;

export const listOutboundQuerySchema = z.object({
  q: z.string().trim().max(60).optional().default(""),
  // pending = 内勤交了、还没发的工单；draft = 自己开了一半的普通草稿
  status: z.enum(["all", "draft", "approved", "voided", "pending"]).optional().default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListOutboundQuery = z.infer<typeof listOutboundQuerySchema>;

/**
 * 改收货信息：只允许动这四项，够用了。
 * 商品明细和数量不在这里改——那些一动就影响库存，只能删单重开。
 */
export const updateOutboundInfoSchema = z
  .object({
    externalNo: z.string().trim().max(60, "订单号过长").optional().nullable(),
    receiverName: z
      .string()
      .trim()
      .max(300, "收货信息最多 300 个字，超了请精简一下地址")
      .optional()
      .nullable(),
    trackingNo: z.string().trim().max(60, "物流单号过长").optional().nullable(),
    remark: z.string().trim().max(500, "备注最多 500 个字").optional().nullable(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "没有要修改的内容",
  });

export type UpdateOutboundInfoInput = z.infer<typeof updateOutboundInfoSchema>;

/**
 * 按行确认发货。
 * 一单几十个地址，缺货是常态：发出哪几行就传哪几行，剩下的挂着等。
 * 传空数组会被拒——「什么都没发」不该产生一条发货记录。
 */
export const shipOutboundSchema = z.object({
  itemIds: z
    .array(z.string().trim().min(1))
    .min(1, "至少选一个要发出的包裹")
    .max(200, "一次最多确认 200 行"),
});

export type ShipOutboundInput = z.infer<typeof shipOutboundSchema>;

/** 改某一行的收货信息（只许改还没发出的行） */
export const updateOutboundItemSchema = z
  .object({
    receiverInfo: z
      .string()
      .trim()
      .max(300, "收货信息最多 300 个字，超了请精简一下地址")
      .optional()
      .nullable(),
    externalNo: z.string().trim().max(60, "订单号过长").optional().nullable(),
    trackingNo: z.string().trim().max(60, "物流单号过长").optional().nullable(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "没有要修改的内容",
  });

export type UpdateOutboundItemInput = z.infer<typeof updateOutboundItemSchema>;

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
