/** 报废 / 处置单前后端共享类型（不含服务端依赖，客户端组件可直接引用） */

import type { DocStatus } from "@/modules/document/document.types";

export type { DocStatus };
export { DOC_STATUS_LABEL, DOC_STATUS_TONE, colorText } from "@/modules/document/document.types";

/**
 * 一件货离开仓库的方式，只有三种。
 * 次品区积压的东西必须能走出去，否则那个区最后会堆成垃圾场，谁也说不清里面有什么。
 */
export type Disposition = "scrap" | "offline_sale" | "self_dispose";

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  scrap: "转报废",
  offline_sale: "线下出售",
  self_dispose: "自行处理",
};

export const DISPOSITION_TONE: Record<Disposition, string> = {
  scrap: "bg-[#fdf1f1] text-[#b4433a]",
  offline_sale: "bg-[#eef4ee] text-[#3f7a4a]",
  self_dispose: "bg-[#f2f4f7] text-muted",
};

/** 选的时候就得说清后果，别让人点完才后悔 */
export const DISPOSITION_HINT: Record<Disposition, string> = {
  scrap: "货还在仓库里，先挪进报废区，等集中处理。计入本月损耗",
  offline_sale: "东西已经卖掉，直接从账上离开（系统不记价格）",
  self_dispose: "送人、拆解或丢弃，要写清怎么处理的",
};

export function toDisposition(value: string | null): Disposition {
  return value === "offline_sale" || value === "self_dispose" ? value : "scrap";
}

export type ScrapItemView = {
  id: string;
  lineNo: number;
  skuId: string;
  productId: string;
  productName: string;
  unit: string;
  colorName: string | null;
  /** custom = 定制款：必须落到具体件号 */
  variantType: "normal" | "custom";
  qty: number;
  disposition: Disposition;
  /** 处置选中的定制件编号 */
  instanceCodes: string[];
  remark: string | null;
};

export type ScrapDocView = {
  id: string;
  docNo: string;
  status: DocStatus;
  /** YYYY-MM-DD */
  bizDate: string;
  sourceLocationId: string | null;
  sourceLocationName: string | null;
  /** 源仓位是不是次品区：界面上用来说明「这批是次品」 */
  fromDefective: boolean;
  remark: string | null;
  itemCount: number;
  totalQty: number;
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedByName: string | null;
  createdAt: string;
  /** 列表页一行摘要：「青灵椅 方彩 ×2 报废 · 米白 ×1 线下出售」 */
  preview: string;
  items: ScrapItemView[];
};

export type ScrapListResult = {
  items: ScrapDocView[];
  total: number;
  page: number;
  pageSize: number;
  counts: { draft: number; approved: number };
};

export type ScrapMeta = {
  /** 可选的源仓位：主仓与次品区；报废区本身不能再当源 */
  locations: { id: string; name: string; type: string; isSellable: boolean }[];
  /** 次品区 id，建单时默认选它 */
  defectiveId: string | null;
  today: string;
};

/** 源仓位里现有的货：处置单的候选行 */
export type ScrapStockRow = {
  skuId: string;
  productId: string;
  productName: string;
  unit: string;
  colorName: string | null;
  variantType: "normal" | "custom";
  /** 这个仓位里现有多少 */
  qty: number;
  batches: { batchNo: string; productionDate: string | null; qty: number }[];
  instances: {
    id: string;
    code: string;
    productionDate: string | null;
    /** 已被别的草稿占用（出库草稿 / 盘点草稿 / 另一张处置草稿） */
    reservedBy: string | null;
  }[];
};

export type ScrapStockResult = {
  locationId: string;
  locationName: string;
  locationType: string;
  isSellable: boolean;
  rows: ScrapStockRow[];
  total: number;
};
