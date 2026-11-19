/** 前后端共享的商品视图类型（不含任何服务端依赖） */

export type ProductSkuView = {
  id: string;
  colorName: string | null;
  variantType: "normal" | "custom";
  skuCode: string;
  barcode: string | null;
  safetyStock: number;
  stock: number;
};

export type ProductView = {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  imageUrl: string | null;
  description: string | null;
  profileStatus: "complete" | "pending";
  usageCount: number;
  updatedAt: string;
  colors: ProductSkuView[];
  totalStock: number;
  colorCount: number;
};

export type ProductListResult = {
  items: ProductView[];
  total: number;
  page: number;
  pageSize: number;
  pendingCount: number;
};

/**
 * 数量单位：按商品自定义，界面只给包包店常用的这五个。
 * 老档案里可能还躺着家具时期的「把 / 张」，那两个不在选项里但能原样保存，
 * 见 `product.schema.ts` 的 LEGACY_UNIT_VALUES。
 */
export const UNIT_OPTIONS = ["个", "只", "件", "款", "套"] as const;

export function colorLabel(sku: Pick<ProductSkuView, "colorName">): string {
  return sku.colorName?.trim() ? sku.colorName : "无颜色";
}
