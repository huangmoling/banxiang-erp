/** 报表前后端共享类型（不含服务端依赖，客户端组件可直接引用） */

export type ReportMonthPoint = {
  /** 2026-10 */
  month: string;
  /** 10月 */
  label: string;
  inbound: number;
  outbound: number;
  returned: number;
  /** 当月有效处置单处理的件数（红冲掉的不算） */
  disposed: number;
};

export type ReportStat = {
  key: string;
  label: string;
  value: number;
  /** 同比上月的差；上月为 0 时为 null，避免出现「+∞%」这种没法看的数字 */
  delta: number | null;
  hint: string;
};

/** 某一类商品在一段时间里的件数汇总 */
export type ReportSkuRow = {
  skuId: string;
  productName: string;
  colorName: string | null;
  unit: string;
  variantType: "normal" | "custom";
  qty: number;
};

export type ReportDispositionRow = {
  key: "scrap" | "offline_sale" | "self_dispose";
  label: string;
  qty: number;
  /** 占本月处置总量的比例，0-100 的整数 */
  percent: number;
};

export type ReportBatchAge = {
  key: string;
  label: string;
  /** 落在这一档的件数 */
  qty: number;
  /** 涉及的批次数 */
  batches: number;
  /** 页面用来给这一档上色 */
  level: "ok" | "watch" | "warn" | "danger" | "unknown";
};

export type ReportLowStockRow = {
  skuId: string;
  productName: string;
  colorName: string | null;
  unit: string;
  onHand: number;
  safetyStock: number;
  /** 还差多少件才回到安全线 */
  gap: number;
};

export type ReportDocRow = {
  type: string;
  label: string;
  approved: number;
  draft: number;
  voided: number;
};

export type ReportOverview = {
  /** 统计区间：本月自然月 */
  range: { from: string; to: string; label: string };
  /** 四个核心数字，按业务含义具名，避免数组取值时对错位置 */
  stats: {
    inbound: ReportStat;
    outbound: ReportStat;
    returned: ReportStat;
    disposed: ReportStat;
  };
  months: ReportMonthPoint[];
  /** 本月损耗按商品拆分，最多的在前 */
  lossBySku: ReportSkuRow[];
  lossByDisposition: ReportDispositionRow[];
  defective: {
    /** 次品区当前件数 */
    onHand: number;
    /** 本月新进次品区的件数（退货 + 盘点等一切流入） */
    inbound: number;
    /** 本月从次品区走出去的件数 */
    outbound: number;
    /** 本月处置件数（三种方式合计） */
    disposed: number;
    /** 消化率：本月处置 / (期初 + 本月流入)。期初按 0 兜底 */
    rate: number | null;
    /** 次品区存量按商品拆分 */
    bySku: ReportSkuRow[];
  };
  batchAging: ReportBatchAge[];
  lowStock: ReportLowStockRow[];
  docs: ReportDocRow[];
};

export { DOC_TYPE_LABEL, docTypeLabel } from "@/modules/document/document.types";

/** 批次账龄分档：越靠前越可能变成死库存 */
export const BATCH_AGE_LEVEL_TONE: Record<ReportBatchAge["level"], string> = {
  ok: "bg-ok-soft text-ok",
  watch: "bg-brand-soft text-brand",
  warn: "bg-warn-soft text-[#8a5a15]",
  danger: "bg-[#fdf1f1] text-[#b4433a]",
  unknown: "bg-[#f2f4f7] text-muted",
};
