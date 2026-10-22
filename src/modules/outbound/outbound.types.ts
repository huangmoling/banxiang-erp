/** 出库单前后端共享类型（不含任何服务端依赖，客户端组件可直接引用） */

import type { DocStatus } from "@/modules/document/document.types";

export type { DocStatus };
export { DOC_STATUS_LABEL, DOC_STATUS_TONE } from "@/modules/document/document.types";

export type OutboundItemView = {
  id: string;
  lineNo: number;
  skuId: string;
  productId: string;
  productName: string;
  unit: string;
  colorName: string | null;
  /** custom = 定制款：按件出库，必须指定具体哪一件 */
  variantType: "normal" | "custom";
  qty: number;
  /** 出库扣减的批次（常规款自动按生产日期先后分配；定制款为空） */
  batchNo: string | null;
  /** 出库选走的定制件编号 */
  instanceCodes: string[];
  remark: string | null;
};

export type OutboundDocView = {
  id: string;
  docNo: string;
  status: DocStatus;
  /** YYYY-MM-DD */
  bizDate: string;
  locationId: string | null;
  locationName: string | null;
  /** 淘宝订单号 */
  externalNo: string | null;
  /** 收货信息：姓名 / 电话 / 地址整段，靠换行分段，系统不拆 */
  receiverName: string | null;
  /** 物流单号 */
  trackingNo: string | null;
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
  /** 内勤提交发货工单的时间；空 = 普通草稿 */
  submittedAt: string | null;
  submittedByName: string | null;
  /** 是不是「待发货」：已提交且还没审核 */
  pendingShip: boolean;
  /** 提交到今天隔了几天（0 = 今天提交）。没提交的为 null */
  waitedDays: number | null;
  preview: string;
  items: OutboundItemView[];
};

export type OutboundListResult = {
  items: OutboundDocView[];
  total: number;
  page: number;
  pageSize: number;
  counts: { draft: number; approved: number; pending: number };
};

/** 仪表台待办：今天要发多少、有几张压在手里 */
export type PendingShipSummary = {
  /** 待发货总张数 */
  total: number;
  /** 其中今天提交的 */
  today: number;
  /** 其中隔天及更早提交的（要标红） */
  overdue: number;
  /** 最早那张的提交时间，给人一个「压了多久」的直观感受 */
  oldestAt: string | null;
};

export type OutboundMeta = {
  locations: { id: string; name: string }[];
  today: string;
};

/** 某个 SKU 当前可出的东西：常规款看批次余量，定制款看具体在库件 */
export type SkuAvailability = {
  skuId: string;
  /** 可售总在库（含未归批的部分） */
  stock: number;
  batches: {
    batchNo: string;
    productionDate: string | null;
    qty: number;
  }[];
  instances: {
    id: string;
    code: string;
    productionDate: string | null;
    /** 来源入库单号，便于仓管对实物 */
    inboundDocNo: string | null;
    /** 已被哪张草稿占用（空 = 可出）。被占用时不能选，但不会从列表里消失 */
    reservedBy: string | null;
  }[];
};

export type AvailabilityResult = Record<string, SkuAvailability>;

/** 出库单不需要用户理解批次，默认「自动」即可 */
export const AUTO_BATCH = "";

/** 颜色文案统一在单据公共层，出入库与退货共用一份 */
export { colorText } from "@/modules/document/document.types";
