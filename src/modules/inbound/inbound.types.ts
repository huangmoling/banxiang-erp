/** 入库单前后端共享类型（不含任何服务端依赖，客户端组件可直接引用） */

import type { DocStatus } from "@/modules/document/document.types";

// 单据状态是入库/出库/退货共用的，定义在 document.types，这里原样透出以保持旧引用可用
export type { DocStatus };
export { DOC_STATUS_LABEL, DOC_STATUS_TONE } from "@/modules/document/document.types";

export type InboundItemView = {
  id: string;
  lineNo: number;
  skuId: string;
  productId: string;
  productName: string;
  unit: string;
  colorName: string | null;
  /** custom = 定制款：按件追踪，审核时会为每一件生成唯一编号 */
  variantType: "normal" | "custom";
  qty: number;
  /** YYYY-MM-DD */
  productionDate: string | null;
  batchNo: string | null;
  remark: string | null;
  /** 定制件的唯一编号（只有审核后才会有） */
  instanceCodes: string[];
};

export type InboundDocView = {
  id: string;
  docNo: string;
  status: DocStatus;
  /** YYYY-MM-DD */
  bizDate: string;
  locationId: string | null;
  locationName: string | null;
  remark: string | null;
  itemCount: number;
  totalQty: number;
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  /** 红冲信息：只有被红冲的单据才有值 */
  voidedAt: string | null;
  voidReason: string | null;
  voidedByName: string | null;
  createdAt: string;
  /** 列表页用的内容摘要，如「北欧布艺单人椅·米白 ×2、… 等 3 项」 */
  preview: string;
  items: InboundItemView[];
};

export type InboundListResult = {
  items: InboundDocView[];
  total: number;
  page: number;
  pageSize: number;
  counts: { draft: number; approved: number };
};

export type InboundMeta = {
  locations: { id: string; name: string }[];
  today: string;
};

export function colorText(colorName: string | null): string {
  return colorName?.trim() ? colorName : "无颜色";
}
