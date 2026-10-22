/** 盘点单前后端共享类型（不含任何服务端依赖，客户端组件可直接引用） */

import type { DocStatus } from "@/modules/document/document.types";

export type { DocStatus };
export { DOC_STATUS_LABEL, DOC_STATUS_TONE, colorText } from "@/modules/document/document.types";

export type LocationType = "normal" | "defective" | "scrap";

export const LOCATION_TYPE_LABEL: Record<LocationType, string> = {
  normal: "主仓 · 可售",
  defective: "次品区 · 不可售",
  scrap: "报废区 · 不可售",
};

export const LOCATION_TYPE_TONE: Record<LocationType, string> = {
  normal: "bg-brand-soft text-brand",
  defective: "bg-[#fdf4e8] text-[#a15f12]",
  scrap: "bg-[#f2f4f7] text-ink-2",
};

export function toLocationType(value: string | null | undefined): LocationType {
  return value === "defective" ? "defective" : value === "scrap" ? "scrap" : "normal";
}

/**
 * 盘点单覆盖的仓位。一张盘点单只盘一个仓位——
 * 主仓、次品区、报废区的货根本不在一个屋角，混在一张单上没法数、也没法核。
 */
export type StocktakeLocation = {
  id: string;
  name: string;
  type: LocationType;
  isSellable: boolean;
};

/**
 * 定制件的「在库」状态、状态文案：统一从 document.types 取，这里只做转出。
 * P5.1 起处置单与红冲也要用同一套说法，留在各处会分裂成几份。
 */
import {
  INSTANCE_STATUS_LABEL,
  PRESENT_INSTANCE_STATUSES,
} from "@/modules/document/document.types";

export { INSTANCE_STATUS_LABEL, PRESENT_INSTANCE_STATUSES };

export function instanceStatusLabel(status: string): string {
  return INSTANCE_STATUS_LABEL[status] ?? status;
}

/** 盘点表里的一行（还没建单，是给表单填的底稿） */
export type StocktakeSheetRow = {
  skuId: string;
  productId: string;
  productName: string;
  unit: string;
  colorName: string | null;
  variantType: "normal" | "custom";
  /** 账面数：截止时点那一刻系统认为这个仓位有几件 */
  bookQty: number;
  /** 截止后变动：盘点开始到现在这个仓位又出入的净额 */
  afterQty: number;
  /** 定制款：现在还躺在这个仓位里的件（盘亏时按件勾选） */
  instances: {
    id: string;
    code: string;
    productionDate: string | null;
    /** 已被某张单占用：出库草稿已拣货，或另一张盘点草稿判为盘亏。占用中的件不能判盘亏 */
    reservedBy: string | null;
  }[];
};

export type StocktakeSheet = {
  location: StocktakeLocation | null;
  /** 截止时点（ISO，精确到分钟） */
  snapshotAt: string;
  rows: StocktakeSheetRow[];
  bookTotal: number;
  afterTotal: number;
};

/** 已建单的一行 */
export type StocktakeRowView = {
  id: string;
  lineNo: number;
  skuId: string;
  productId: string;
  productName: string;
  unit: string;
  colorName: string | null;
  variantType: "normal" | "custom";
  /** 账面数（建单那一刻看到的，永久存档） */
  bookQty: number;
  /** 实盘数 */
  countedQty: number;
  /** 差异 = 实盘 − 账面。正数盘盈、负数盘亏、0 账实相符 */
  diffQty: number;
  /** 截止后变动（审核前后都实时显示，解释「账面和现在对不上」） */
  afterQty: number;
  /** 盘亏的定制件编号 */
  instanceCodes: string[];
  remark: string | null;
};

export type StocktakeDocView = {
  id: string;
  docNo: string;
  status: DocStatus;
  /** 截止时点的日期部分，与单据业务日期一致 */
  bizDate: string;
  /** 截止时点（ISO） */
  snapshotAt: string | null;
  locationId: string | null;
  locationName: string | null;
  locationType: LocationType;
  isSellable: boolean;
  remark: string | null;
  itemCount: number;
  /** 实盘合计件数 */
  totalQty: number;
  /** 账面合计 */
  bookTotal: number;
  /** 盘盈合计 / 盘亏合计（都是正数，分开看） */
  gainQty: number;
  lossQty: number;
  /** 有差异的行数 */
  diffLines: number;
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
  /** 列表页一行摘要 */
  preview: string;
  items: StocktakeRowView[];
};

export type StocktakeListResult = {
  items: StocktakeDocView[];
  total: number;
  page: number;
  pageSize: number;
  counts: { draft: number; approved: number };
};

export type StocktakeMeta = {
  locations: StocktakeLocation[];
  /** 现在的 datetime-local 值 */
  now: string;
  /** 截止时点最多能往回填到哪一天（datetime-local） */
  earliest: string;
};
