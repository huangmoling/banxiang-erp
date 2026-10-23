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

  /**
   * 这一行的收货信息（姓名 / 电话 / 地址整段，系统不拆）。
   * 已经是「最终生效值」：行上没填就是单据上那个整单地址。
   * 一个地址 = 一个包裹，这是打印分组与找货的唯一依据。
   */
  receiverInfo: string | null;
  /** true = 这行自己没填地址，沿用了单据的整单地址（改的时候要知道改的是哪一层） */
  receiverInherited: boolean;
  /** 这一行的淘宝订单号（行上没填则回退单据） */
  externalNo: string | null;
  /** 这一行的物流单号（一个包裹一个） */
  trackingNo: string | null;
  /** 这一行发出去的时间；空 = 还没发 */
  shippedAt: string | null;
  shippedByName: string | null;
  /** 派生：shippedAt 是否有值。前端判断「这行能不能改、能不能删」一律看它 */
  shipped: boolean;
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
  /** 已发出的行数（= 包裹数）。一张单可以部分发出 */
  shippedCount: number;
  /** 还没发的行数（= 还欠几个包裹） */
  pendingCount: number;
  /** 有行已发出：这种单不许删，删了流水会跟着消失、货却已经走了 */
  hasShipped: boolean;
  /** 全部行都发完了（此时 status 一定是 approved） */
  allShipped: boolean;
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
  counts: {
    draft: number;
    approved: number;
    pending: number;
    /** 待发货里还没发出去的包裹数（= 未发行的明细行数） */
    pendingPackages: number;
  };
};

/** 仪表台待办：还欠几个包裹、压了几张单 */
export type PendingShipSummary = {
  /** 待发货的单据张数（一张单可能装几十个包裹，所以张数不等于工作量） */
  total: number;
  /** 待发的包裹数 = 未发出的明细行数。仓管真正要跑多少趟看这个 */
  packages: number;
  /** 其中今天提交的包裹数 */
  today: number;
  /** 其中隔天及更早提交的包裹数（要标红） */
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
