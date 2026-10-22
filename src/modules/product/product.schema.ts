import { z } from "zod";

export const UNIT_VALUES = ["件", "把", "张", "套"] as const;
export type Unit = (typeof UNIT_VALUES)[number];

export const unitSchema = z.enum(UNIT_VALUES, { message: "单位只能是 件 / 把 / 张 / 套" });

/** 颜色行：一色一个 SKU。"定制"这一行同时也是定制款（按件追踪、退货不可回良品） */
export const colorRowSchema = z.object({
  id: z.string().optional(),
  colorName: z
    .string()
    .trim()
    .max(30, "颜色名最多 30 个字")
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  variantType: z.enum(["normal", "custom"]).default("normal"),
  safetyStock: z.coerce.number().int().min(0, "安全库存不能为负").max(999999).default(0),
});

export type ColorRowInput = z.infer<typeof colorRowSchema>;

function checkDuplicateColors(colors: ColorRowInput[]): { path: (string | number)[]; message: string } | null {
  const seen = new Set<string>();
  for (let i = 0; i < colors.length; i++) {
    const row = colors[i]!;
    const key = `${row.colorName ?? ""}__${row.variantType}`;
    if (seen.has(key)) {
      return {
        path: ["colors", i, "colorName"],
        message: row.colorName
          ? `颜色「${row.colorName}」在同样的规格下重复了，请合并成一行`
          : "已有「无颜色」的行，请勿重复添加",
      };
    }
    seen.add(key);
  }
  return null;
}

const baseProductSchema = z.object({
    name: z.string().trim().min(1, "请填写产品名称").max(60, "产品名称最多 60 个字"),
    category: z
      .string()
      .trim()
      .max(20, "分类最多 20 个字")
      .optional()
      .nullable()
      .transform((v) => (v && v.length > 0 ? v : null)),
    unit: unitSchema.default("件"),
    imageUrl: z
      .string()
      .trim()
      .max(300)
      .optional()
      .nullable()
      .transform((v) => (v && v.length > 0 ? v : null)),
    description: z
      .string()
      .trim()
      .max(500, "备注最多 500 个字")
      .optional()
      .nullable()
      .transform((v) => (v && v.length > 0 ? v : null)),
    colors: z.array(colorRowSchema).min(1, "至少要有一个颜色行").max(30, "颜色行过多"),
    /** 前端在「同名产品存在」的提示上点「仍要新建」时传 true */
    forceCreate: z.boolean().optional().default(false),
});

export const createProductSchema = baseProductSchema.superRefine((val, ctx) => {
  const dup = checkDuplicateColors(val.colors);
  if (dup) ctx.addIssue({ code: "custom", path: dup.path, message: dup.message });
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

/**
 * 更新：字段全部可选。
 * 这里刻意不复用 baseProductSchema —— 它带 default 与 transform，
 * 部分更新时会把「没传」误当成「传了空值」，把单位重置成「件」、把分类清空。
 * 空值语义（"" → null）交给服务层处理。
 */
export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1, "请填写产品名称").max(60, "产品名称最多 60 个字").optional(),
    category: z.string().trim().max(20, "分类最多 20 个字").nullish(),
    unit: unitSchema.optional(),
    imageUrl: z.string().trim().max(300).nullish(),
    description: z.string().trim().max(500, "备注最多 500 个字").nullish(),
    colors: z.array(colorRowSchema).min(1, "至少要保留一个颜色行").max(30).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.colors) return;
    const dup = checkDuplicateColors(val.colors);
    if (dup) ctx.addIssue({ code: "custom", path: dup.path, message: dup.message });
  });

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const listProductsQuerySchema = z.object({
  q: z.string().trim().max(60).optional().default(""),
  status: z.enum(["all", "pending", "complete"]).optional().default("all"),
  category: z.string().trim().max(20).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const searchProductsQuerySchema = z.object({
  q: z.string().trim().max(60).optional().default(""),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
