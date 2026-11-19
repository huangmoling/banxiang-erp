/** 退货单前后端共享类型（不含任何服务端依赖，客户端组件可直接引用） */

import type { DocStatus } from "@/modules/document/document.types";

export type { DocStatus };
export { DOC_STATUS_LABEL, DOC_STATUS_TONE, colorText } from "@/modules/document/document.types";

/**
 * 退货去向。三个口子，没有第四个：
 * - good      良品回架：还能卖，放回主仓，可售库存增加
 * - defective 次品区：有瑕疵，不计入可售，后续线下处理
 * - scrap     报废：直接报损
 *
 * **定制款只允许 defective / scrap**——定制规格退回来基本卖不掉，
 * 让它可以回良品架就等于给库存注水。这条是后端硬校验，不是前端藏选项。
 */
export type ReturnDestination = "good" | "defective" | "scrap";

export const DESTINATIONS: ReturnDestination[] = ["good", "defective", "scrap"];

export const DESTINATION_LABEL: Record<ReturnDestination, string> = {
  good: "良品回架",
  defective: "次品区",
  scrap: "报废",
};

export const DESTINATION_HINT: Record<ReturnDestination, string> = {
  good: "还能卖 → 放回主仓，可售库存 +",
  defective: "有瑕疵 → 进次品区，不计入可售",
  scrap: "直接报损 → 进报废区",
};

export const DESTINATION_TONE: Record<ReturnDestination, string> = {
  good: "bg-ok-soft text-ok",
  defective: "bg-warn-soft text-warn",
  scrap: "bg-sunken text-ink-2",
};

export function toDestination(value: string | null): ReturnDestination {
  return value === "defective" ? "defective" : value === "scrap" ? "scrap" : "good";
}

export function destinationLabel(value: string | null): string {
  return DESTINATION_LABEL[toDestination(value)];
}

/** 定制款能选哪些去向（后端与前端共用同一份，避免两边规则漂移） */
export const CUSTOM_ALLOWED_DESTINATIONS: ReturnDestination[] = ["defective", "scrap"];

export type ReturnItemView = {
  id: string;
  lineNo: number;
  skuId: string;
  productId: string;
  productName: string;
  unit: string;
  colorName: string | null;
  variantType: "normal" | "custom";
  /** 本次退货数量 */
  qty: number;
  destination: ReturnDestination;
  /** 退的是原出库单哪一行 */
  originItemId: string | null;
  originLineNo: number | null;
  /** 原出库行当时发了多少 */
  originQty: number | null;
  /** 原出库行在这一单之前已经退过多少（本单还没算进去） */
  originReturnedQty: number | null;
  /** 原出库扣减的批次（良品回架时按它回批次） */
  batchNo: string | null;
  /** 退回来的定制件编号 */
  instanceCodes: string[];
  remark: string | null;
};

export type ReturnDocView = {
  id: string;
  docNo: string;
  status: DocStatus;
  /** YYYY-MM-DD */
  bizDate: string;
  originDocumentId: string | null;
  originDocNo: string | null;
  /** 原出库单的发货日期，详情页对照用 */
  originBizDate: string | null;
  externalNo: string | null;
  receiverName: string | null;
  /** 买家寄回的物流单号 */
  trackingNo: string | null;
  remark: string | null;
  itemCount: number;
  totalQty: number;
  /** 按去向汇总，详情页一眼看清「多少回架、多少进次品」 */
  destinationQty: Record<ReturnDestination, number>;
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  /** 红冲信息：只有被红冲的单据才有值 */
  voidedAt: string | null;
  voidReason: string | null;
  voidedByName: string | null;
  createdAt: string;
  preview: string;
  items: ReturnItemView[];
};

export type ReturnListResult = {
  items: ReturnDocView[];
  total: number;
  page: number;
  pageSize: number;
  counts: { draft: number; approved: number };
};

export type ReturnMeta = {
  today: string;
  /** 良品回架的目标仓位：主仓 */
  goodLocation: { id: string; name: string } | null;
  defectiveLocation: { id: string; name: string } | null;
  scrapLocation: { id: string; name: string } | null;
};

/** 可退的原出库单（搜索候选） */
export type ReturnableOrigin = {
  id: string;
  docNo: string;
  bizDate: string;
  externalNo: string | null;
  receiverName: string | null;
  /** 第一行的收货地址（一单多地址时用来看这张单都发去了哪，可能只显示第一个） */
  receiverInfo: string | null;
  trackingNo: string | null;
  totalQty: number;
  /** 已经退过多少 */
  returnedQty: number;
  /** 还能退多少 */
  returnableQty: number;
  preview: string;
};

/** 原出库单里的一行，退货时按行填数量 */
export type OriginItemView = {
  id: string;
  lineNo: number;
  skuId: string;
  productName: string;
  unit: string;
  colorName: string | null;
  variantType: "normal" | "custom";
  /** 这一行发了多少 */
  qty: number;
  /** 已经退过多少（含别的退货单） */
  returnedQty: number;
  /** 还能退多少 */
  returnableQty: number;
  /** 出库时扣的批次，良品回架按它回库 */
  batchNo: string | null;
  /**
   * 这一行的收货信息。一单多地址以后，同一张单里可能有 20 行同款包，
   * 只能靠地址认出退的是哪个买家——所以退货选行时必须把它显示出来。
   */
  receiverInfo: string | null;
  /** 这一行的淘宝订单号（行上没有则回退单据） */
  externalNo: string | null;
  /** 定制款：这一行发出去的单件，勾选要退回的 */
  instances: {
    id: string;
    code: string;
    productionDate: string | null;
    /** outbound = 还在客户手上，可退；其它 = 已退过 */
    status: string;
    returnable: boolean;
    /** 已被哪张退货草稿占用 */
    reservedBy: string | null;
    /** 已经退到哪张退货单 */
    returnedByDocNo: string | null;
  }[];
};

export type OriginDetail = {
  id: string;
  docNo: string;
  bizDate: string;
  externalNo: string | null;
  receiverName: string | null;
  trackingNo: string | null;
  totalQty: number;
  returnedQty: number;
  returnableQty: number;
  items: OriginItemView[];
};
