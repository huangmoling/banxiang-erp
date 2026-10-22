import "server-only";
import { formatDateOnly, startOfMonth } from "@/lib/date";
import { reportRepository } from "./report.repository";
import type {
  ReportBatchAge,
  ReportDispositionRow,
  ReportDocRow,
  ReportLowStockRow,
  ReportMonthPoint,
  ReportOverview,
  ReportSkuRow,
  ReportStat,
} from "./report.types";
import { docTypeLabel } from "./report.types";

const DAY_MS = 24 * 60 * 60 * 1000;
const TREND_MONTHS = 12;

const DISPOSITION_LABEL: Record<string, string> = {
  scrap: "转报废",
  offline_sale: "线下出售",
  self_dispose: "自行处理",
};

function monthStartOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1, 0, 0, 0, 0);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * 上月同期区间。
 * 拿「本月 1 号到今天」去比「上月整月」是耍流氓——月初看报表永远显示暴跌。
 * 所以上月只取到同一个日号，月底不足时夹到上月最后一天。
 */
function lastMonthSamePeriod(now: Date): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  const lastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  const day = Math.min(now.getDate(), lastDay);
  const to = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    day,
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
  );
  return { from, to };
}

/** 一个区间内的作业量汇总，本月与上月同期共用同一套算法，避免两边口径不一致 */
type WindowStat = {
  inbound: number;
  outbound: number;
  returned: number;
  disposed: number;
  disposedFromDefective: number;
  defectiveIn: number;
  defectiveOut: number;
};

async function computeWindow(
  from: Date,
  to: Date,
  defectiveLocationIds: Set<string>,
): Promise<WindowStat> {
  const [movements, disposals] = await Promise.all([
    reportRepository.movementsBetween(from, to),
    reportRepository.disposalItemsBetween(from, to),
  ]);

  const stat: WindowStat = {
    inbound: 0,
    outbound: 0,
    returned: 0,
    disposed: 0,
    disposedFromDefective: 0,
    defectiveIn: 0,
    defectiveOut: 0,
  };

  for (const mv of movements) {
    // 作业量按「方向」统计：红冲补的是反向流水，不该把历史发生量抵消掉
    if (mv.bizType === "inbound" && mv.qtyDelta > 0) stat.inbound += mv.qtyDelta;
    else if (mv.bizType === "outbound" && mv.qtyDelta < 0) stat.outbound += -mv.qtyDelta;
    else if (mv.bizType === "return_in" && mv.qtyDelta > 0) stat.returned += mv.qtyDelta;

    if (defectiveLocationIds.has(mv.locationId)) {
      if (mv.qtyDelta > 0) stat.defectiveIn += mv.qtyDelta;
      else stat.defectiveOut += -mv.qtyDelta;
    }
  }

  for (const item of disposals) {
    stat.disposed += item.qty;
    if (item.document?.location?.type === "defective") stat.disposedFromDefective += item.qty;
  }

  return stat;
}

function toSkuRow(item: {
  qty: number;
  sku: {
    id: string;
    colorName: string | null;
    variantType: string;
    product: { name: string; unit: string };
  };
}): ReportSkuRow {
  return {
    skuId: item.sku.id,
    productName: item.sku.product.name,
    colorName: item.sku.colorName,
    unit: item.sku.product.unit,
    variantType: item.sku.variantType === "custom" ? "custom" : "normal",
    qty: item.qty,
  };
}

function deltaOf(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return current - previous;
}

function batchAgeBucket(productionDate: Date | null, now: Date): { key: string; level: ReportBatchAge["level"]; label: string } {
  if (!productionDate) return { key: "unknown", level: "unknown", label: "无生产日期" };

  const days = Math.floor((now.getTime() - productionDate.getTime()) / DAY_MS);
  if (days <= 30) return { key: "d0_30", level: "ok", label: "30 天内" };
  if (days <= 60) return { key: "d31_60", level: "watch", label: "31–60 天" };
  if (days <= 90) return { key: "d61_90", level: "warn", label: "61–90 天" };
  return { key: "d90p", level: "danger", label: "90 天以上" };
}

export const reportService = {
  async overview(): Promise<ReportOverview> {
    const now = new Date();
    const monthFrom = startOfMonth(now);
    const prev = lastMonthSamePeriod(now);
    const trendFrom = addMonths(monthFrom, -(TREND_MONTHS - 1));

    const [locations, skus, sellable, defectiveBySku, batches, docCounts] = await Promise.all([
      reportRepository.locations(),
      reportRepository.skus(),
      reportRepository.sellableBySku(),
      reportRepository.byLocationTypeSumBySku("defective"),
      reportRepository.batchesWithStock(),
      reportRepository.docCounts(),
    ]);

    const defectiveLocationIds = new Set(
      locations.filter((l) => l.type === "defective").map((l) => l.id),
    );

    const [thisMonth, lastMonth, trendMovements, trendDisposals] = await Promise.all([
      computeWindow(monthFrom, now, defectiveLocationIds),
      computeWindow(prev.from, prev.to, defectiveLocationIds),
      reportRepository.movementsBetween(trendFrom, now),
      reportRepository.disposalItemsBetween(trendFrom, now),
    ]);

    // ---------------- 近 12 个月趋势 ----------------
    const points = new Map<string, ReportMonthPoint>();
    for (let i = 0; i < TREND_MONTHS; i += 1) {
      const d = addMonths(trendFrom, i);
      points.set(monthKey(d), {
        month: monthKey(d),
        label: `${d.getMonth() + 1}月`,
        inbound: 0,
        outbound: 0,
        returned: 0,
        disposed: 0,
      });
    }

    for (const mv of trendMovements) {
      const p = points.get(monthKey(mv.occurredAt));
      if (!p) continue;
      if (mv.bizType === "inbound" && mv.qtyDelta > 0) p.inbound += mv.qtyDelta;
      else if (mv.bizType === "outbound" && mv.qtyDelta < 0) p.outbound += -mv.qtyDelta;
      else if (mv.bizType === "return_in" && mv.qtyDelta > 0) p.returned += mv.qtyDelta;
    }
    for (const item of trendDisposals) {
      const p = points.get(monthKey(item.document.bizDate));
      if (p) p.disposed += item.qty;
    }

    // ---------------- 损耗拆解 ----------------
    const disposalThisMonth = await reportRepository.disposalItemsBetween(monthFrom, now);

    const lossBySkuMap = new Map<string, ReportSkuRow>();
    const disposalByKind = new Map<string, number>();
    for (const item of disposalThisMonth) {
      const row = toSkuRow(item);
      const existed = lossBySkuMap.get(row.skuId);
      if (existed) existed.qty += row.qty;
      else lossBySkuMap.set(row.skuId, row);

      const key = item.disposition ?? "scrap";
      disposalByKind.set(key, (disposalByKind.get(key) ?? 0) + item.qty);
    }

    const totalDisposed = [...disposalByKind.values()].reduce((a, b) => a + b, 0);
    const lossByDisposition: ReportDispositionRow[] = ["scrap", "offline_sale", "self_dispose"].map(
      (key) => {
        const qty = disposalByKind.get(key) ?? 0;
        return {
          key: key as ReportDispositionRow["key"],
          label: DISPOSITION_LABEL[key] ?? key,
          qty,
          percent: totalDisposed === 0 ? 0 : Math.round((qty / totalDisposed) * 100),
        };
      },
    );

    // ---------------- 次品区 ----------------
    const defectiveOnHand = [...defectiveBySku.values()].reduce((a, b) => a + b, 0);
    // 期初 = 当前 − 本月净流入；再拿它当消化率的分母基数
    const defectiveStart =
      defectiveOnHand - (thisMonth.defectiveIn - thisMonth.defectiveOut);
    const disposalBase = Math.max(0, defectiveStart) + thisMonth.defectiveIn;
    const rate = disposalBase > 0 ? Math.round((thisMonth.disposedFromDefective / disposalBase) * 100) : null;

    const skuById = new Map(skus.map((s) => [s.id, s]));
    const defectiveRows: ReportSkuRow[] = [...defectiveBySku.entries()]
      .map(([skuId, qty]) => {
        const sku = skuById.get(skuId);
        return {
          skuId,
          productName: sku?.product.name ?? "已删除的商品",
          colorName: sku?.colorName ?? null,
          unit: sku?.product.unit ?? "件",
          variantType: sku?.variantType === "custom" ? ("custom" as const) : ("normal" as const),
          qty,
        };
      })
      .sort((a, b) => b.qty - a.qty);

    // ---------------- 批次账龄 ----------------
    const bucketOrder: ReportBatchAge[] = [
      { key: "d0_30", label: "30 天内", qty: 0, batches: 0, level: "ok" },
      { key: "d31_60", label: "31–60 天", qty: 0, batches: 0, level: "watch" },
      { key: "d61_90", label: "61–90 天", qty: 0, batches: 0, level: "warn" },
      { key: "d90p", label: "90 天以上", qty: 0, batches: 0, level: "danger" },
      { key: "unknown", label: "无生产日期", qty: 0, batches: 0, level: "unknown" },
    ];
    const bucketMap = new Map(bucketOrder.map((b) => [b.key, b]));
    for (const batch of batches) {
      const info = batchAgeBucket(batch.productionDate, now);
      const target = bucketMap.get(info.key);
      if (!target) continue;
      target.qty += batch.quantity;
      target.batches += 1;
    }

    // ---------------- 低库存 ----------------
    const lowStock: ReportLowStockRow[] = skus
      .filter((s) => s.safetyStock > 0)
      .map((s) => {
        const onHand = sellable.get(s.id) ?? 0;
        return {
          skuId: s.id,
          productName: s.product.name,
          colorName: s.colorName,
          unit: s.product.unit,
          onHand,
          safetyStock: s.safetyStock,
          gap: s.safetyStock - onHand,
        };
      })
      .filter((r) => r.gap > 0)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 20);

    // ---------------- 单据作业量 ----------------
    const docMap = new Map<string, ReportDocRow>();
    const typeOrder = ["inbound", "outbound", "return", "stocktake", "scrap"];
    for (const type of typeOrder) {
      docMap.set(type, { type, label: docTypeLabel(type), approved: 0, draft: 0, voided: 0 });
    }
    for (const row of docCounts) {
      const existed =
        docMap.get(row.type) ??
        { type: row.type, label: docTypeLabel(row.type), approved: 0, draft: 0, voided: 0 };
      const count = row._count._all;
      if (row.status === "approved") existed.approved += count;
      else if (row.status === "voided") existed.voided += count;
      else existed.draft += count;
      docMap.set(row.type, existed);
    }

    const stats: ReportOverview["stats"] = {
      inbound: {
        key: "inbound",
        label: "本月入库",
        value: thisMonth.inbound,
        delta: deltaOf(thisMonth.inbound, lastMonth.inbound),
        hint: "审核生效的入库流水合计，含定制件",
      },
      outbound: {
        key: "outbound",
        label: "本月出库",
        value: thisMonth.outbound,
        delta: deltaOf(thisMonth.outbound, lastMonth.outbound),
        hint: "发货件数，不含线下处置",
      },
      returned: {
        key: "returned",
        label: "本月退货",
        value: thisMonth.returned,
        delta: deltaOf(thisMonth.returned, lastMonth.returned),
        hint: "退回件数，含进次品区的那部分",
      },
      disposed: {
        key: "disposed",
        label: "本月损耗",
        value: thisMonth.disposed,
        delta: deltaOf(thisMonth.disposed, lastMonth.disposed),
        hint: "报废处置单处理的件数，红冲的单不计",
      },
    };

    return {
      range: {
        from: formatDateOnly(monthFrom),
        to: formatDateOnly(now),
        label: `${monthFrom.getFullYear()} 年 ${monthFrom.getMonth() + 1} 月`,
      },
      stats,
      months: [...points.values()],
      lossBySku: [...lossBySkuMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 12),
      lossByDisposition,
      defective: {
        onHand: defectiveOnHand,
        inbound: thisMonth.defectiveIn,
        outbound: thisMonth.defectiveOut,
        disposed: thisMonth.disposedFromDefective,
        rate,
        bySku: defectiveRows.slice(0, 12),
      },
      batchAging: bucketOrder,
      lowStock,
      docs: [...docMap.values()],
    };
  },
};
