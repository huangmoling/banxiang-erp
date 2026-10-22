/** 库存查询前后端共享类型（不含服务端依赖，客户端组件可直接引用） */

import type { DocStatus } from "@/modules/document/document.types";

export { INSTANCE_STATUS_LABEL, colorText, instanceStatusLabel } from "@/modules/document/document.types";

export type InventoryStats = {
  /** 可售在库（主仓）合计 */
  onHand: number;
  defective: number;
  scrap: number;
  /** 有货的款数（可售 + 次品 + 报废 任一不为 0） */
  stockedSku: number;
  lowStock: number;
  /** 在库的定制件件数（按件追踪，与「数量」口径并存） */
  customInStock: number;
};

export type InventoryRow = {
  skuId: string;
  productId: string;
  productName: string;
  colorName: string | null;
  unit: string;
  variantType: "normal" | "custom";
  /** 可售在主仓的结存 */
  onHand: number;
  defective: number;
  scrap: number;
  safetyStock: number;
  /** safetyStock > 0 且 onHand < safetyStock */
  isLow: boolean;
  /** 还压在仓库里的批次数 */
  batchCount: number;
  /** 在库的定制件件数（常规款恒为 0） */
  customCount: number;
  /** 最近一次流水的业务日期，YYYY-MM-DD；从没动过为 null */
  lastMovedOn: string | null;
};

export type InventorySummary = {
  stats: InventoryStats;
  rows: InventoryRow[];
};

export type InventoryBatch = {
  id: string;
  batchNo: string;
  skuId: string;
  productName: string;
  colorName: string | null;
  unit: string;
  variantType: "normal" | "custom";
  productionDate: string | null;
  quantity: number;
  /** 距今多少天；无生产日期为 null */
  ageDays: number | null;
};

export type InventoryInstance = {
  id: string;
  code: string;
  skuId: string;
  productName: string;
  colorName: string | null;
  unit: string;
  status: string;
  locationName: string | null;
  productionDate: string | null;
  /** 这批货从哪张入库单进来的 */
  inboundDocNo: string | null;
  /** 发给哪张出库单了 */
  outboundDocNo: string | null;
  /** 上游单据业务日期 */
  inboundDate: string | null;
  outboundDate: string | null;
  note: string | null;
};

export const BIZ_TYPE_LABEL: Record<string, string> = {
  inbound: "采购入库",
  outbound: "销售出库",
  return_in: "退货入库",
  scrap: "报废处置",
  stocktake_adjust: "盘点调整",
};

export function bizTypeLabel(type: string): string {
  return BIZ_TYPE_LABEL[type] ?? type;
}

export type InventoryMovement = {
  id: string;
  /** YYYY-MM-DD */
  occurredOn: string;
  bizType: string;
  bizTypeLabel: string;
  skuId: string;
  productName: string;
  colorName: string | null;
  unit: string;
  locationName: string;
  qtyDelta: number;
  /** 单据单号（盘点调整也有） */
  docNo: string | null;
  docType: string | null;
  docStatus: DocStatus | null;
  batchNo: string | null;
  instanceCode: string | null;
  note: string | null;
  /** 红冲补的反向流水 */
  reversal: boolean;
};

export type InventoryMovementPage = {
  items: InventoryMovement[];
  total: number;
  page: number;
  pageSize: number;
};

/** 每一行的口径提示：页面顶部直接把话说清，省得仓库里的人猜 */
export const INVENTORY_COLUMN_HINT = {
  onHand: "可售在主仓的件数。次品区、报废区不算，也不能发货",
  defective: "次品区的件数，不计入可售，单独消化",
  scrap: "报废区待集中处理的件数",
  safetyStock: "低于这个数字就在报表里提醒补货；填 0 表示不管",
} as const;
