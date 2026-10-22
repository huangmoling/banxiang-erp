import "server-only";
import { formatDateOnly, parseDateOnly } from "@/lib/date";
import { docTypeLabel } from "@/modules/document/document.types";
import { inventoryRepository } from "./inventory.repository";
import type {
  InventoryBatch,
  InventoryInstance,
  InventoryMovementPage,
  InventoryRow,
  InventorySummary,
} from "./inventory.types";
import { bizTypeLabel } from "./inventory.types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 把仓位 id 分成三类，后面所有统计都靠这三组区分「可售 / 次品 / 报废」 */
async function locationGroups() {
  const locations = await inventoryRepository.locations();
  return {
    sellable: new Set(locations.filter((l) => l.isSellable).map((l) => l.id)),
    defective: new Set(locations.filter((l) => l.type === "defective").map((l) => l.id)),
    scrap: new Set(locations.filter((l) => l.type === "scrap").map((l) => l.id)),
  };
}

export const inventoryService = {
  /**
   * 按款汇总。
   * 一个颜色一行，库存各算各的——「米白 3 把 + 胡桃木 0 把」绝不能被并成「4 把」，
   * 否则发货时才发现某一种颜色根本没货。
   */
  async summary(params: { q?: string; lowOnly?: boolean } = {}): Promise<InventorySummary> {
    const [groups, skus, sums, batchCounts, customCounts, lastMoved] = await Promise.all([
      locationGroups(),
      inventoryRepository.skus(),
      inventoryRepository.sumByLocationIds(),
      inventoryRepository.batchCountBySku(),
      inventoryRepository.customCountBySku(),
      inventoryRepository.lastMovedBySku(),
    ]);

    const bySku = new Map<string, { onHand: number; defective: number; scrap: number }>();
    for (const row of sums) {
      const target = bySku.get(row.skuId) ?? { onHand: 0, defective: 0, scrap: 0 };
      if (groups.sellable.has(row.locationId)) target.onHand += row.qty;
      else if (groups.defective.has(row.locationId)) target.defective += row.qty;
      else if (groups.scrap.has(row.locationId)) target.scrap += row.qty;
      bySku.set(row.skuId, target);
    }

    const q = params.q?.trim().toLowerCase();
    const rows: InventoryRow[] = skus
      .map((sku) => {
        const stock = bySku.get(sku.id) ?? { onHand: 0, defective: 0, scrap: 0 };
        const last = lastMoved.get(sku.id);
        return {
          skuId: sku.id,
          productId: sku.product.id,
          productName: sku.product.name,
          colorName: sku.colorName,
          unit: sku.product.unit,
          variantType: sku.variantType === "custom" ? ("custom" as const) : ("normal" as const),
          onHand: stock.onHand,
          defective: stock.defective,
          scrap: stock.scrap,
          safetyStock: sku.safetyStock,
          isLow: sku.safetyStock > 0 && stock.onHand < sku.safetyStock,
          batchCount: batchCounts.get(sku.id) ?? 0,
          customCount: customCounts.get(sku.id) ?? 0,
          lastMovedOn: last ? formatDateOnly(last) : null,
        };
      })
      .filter((row) => {
        if (params.lowOnly && !row.isLow) return false;
        if (!q) return true;
        const haystack = `${row.productName} ${row.colorName ?? ""}`.toLowerCase();
        return haystack.includes(q);
      })
      // 有货的排前面：查库存的人九成是在找「这个还有没有」
      .sort((a, b) => {
        const stockDiff = b.onHand + b.defective + b.scrap - (a.onHand + a.defective + a.scrap);
        if (stockDiff !== 0) return stockDiff;
        return a.productName.localeCompare(b.productName, "zh-Hans-CN");
      });

    const stats = {
      onHand: rows.reduce((sum, r) => sum + r.onHand, 0),
      defective: rows.reduce((sum, r) => sum + r.defective, 0),
      scrap: rows.reduce((sum, r) => sum + r.scrap, 0),
      stockedSku: rows.filter((r) => r.onHand + r.defective + r.scrap !== 0).length,
      lowStock: rows.filter((r) => r.isLow).length,
      customInStock: rows.reduce((sum, r) => sum + r.customCount, 0),
    };

    return { stats, rows };
  },

  async batches(params: { q?: string } = {}): Promise<InventoryBatch[]> {
    const rows = await inventoryRepository.batches(params);
    const now = new Date();

    return rows.map((b) => ({
      id: b.id,
      batchNo: b.batchNo,
      skuId: b.sku.id,
      productName: b.sku.product.name,
      colorName: b.sku.colorName,
      unit: b.sku.product.unit,
      variantType: b.sku.variantType === "custom" ? ("custom" as const) : ("normal" as const),
      productionDate: b.productionDate ? formatDateOnly(b.productionDate) : null,
      quantity: b.quantity,
      ageDays: b.productionDate
        ? Math.max(0, Math.floor((now.getTime() - b.productionDate.getTime()) / DAY_MS))
        : null,
    }));
  },

  async instances(params: { q?: string; status?: string } = {}): Promise<InventoryInstance[]> {
    const rows = await inventoryRepository.instances(params);
    const docIds = [
      ...new Set(
        rows.flatMap((r) => [r.inboundDocumentId, r.outboundDocumentId].filter((v): v is string => !!v)),
      ),
    ];
    const docs = await inventoryRepository.documentsByIds(docIds);
    const docMap = new Map(docs.map((d) => [d.id, d]));

    return rows.map((r) => {
      const inbound = r.inboundDocumentId ? docMap.get(r.inboundDocumentId) : undefined;
      const outbound = r.outboundDocumentId ? docMap.get(r.outboundDocumentId) : undefined;
      return {
        id: r.id,
        code: r.code,
        skuId: r.sku.id,
        productName: r.sku.product.name,
        colorName: r.sku.colorName,
        unit: r.sku.product.unit,
        status: r.status,
        locationName: r.location?.name ?? null,
        productionDate: r.productionDate ? formatDateOnly(r.productionDate) : null,
        inboundDocNo: inbound?.docNo ?? null,
        outboundDocNo: outbound?.docNo ?? null,
        inboundDate: inbound ? formatDateOnly(inbound.bizDate) : null,
        outboundDate: outbound ? formatDateOnly(outbound.bizDate) : null,
        note: r.note,
      };
    });
  },

  async movements(params: {
    q?: string;
    bizType?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
    /** 导出时一次性取够，不再受页面 100 条的限制 */
    maxRows?: number;
  }): Promise<InventoryMovementPage> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize =
      params.maxRows ?? Math.min(100, Math.max(10, params.pageSize ?? 50));

    const from = params.from ? parseDateOnly(params.from) : null;
    const toDate = params.to ? parseDateOnly(params.to) : null;
    // 只填「到」的时候要含当天最后一刻，否则当天的流水全被排除在外
    const to = toDate ? new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999) : undefined;

    const { total, rows } = await inventoryRepository.movementPage({
      q: params.q,
      bizType: params.bizType,
      from: from ?? undefined,
      to,
      page,
      pageSize,
    });

    return {
      total,
      page,
      pageSize,
      items: rows.map((r) => ({
        id: r.id,
        occurredOn: formatDateOnly(r.occurredAt),
        bizType: r.bizType,
        bizTypeLabel: bizTypeLabel(r.bizType),
        skuId: r.sku.id,
        productName: r.sku.product.name,
        colorName: r.sku.colorName,
        unit: r.sku.product.unit,
        locationName: r.location.name,
        qtyDelta: r.qtyDelta,
        docNo: r.document?.docNo ?? null,
        docType: r.document ? docTypeLabel(r.document.type) : null,
        docStatus: r.document ? (r.document.status as "draft" | "approved" | "voided") : null,
        batchNo: r.batch?.batchNo ?? null,
        instanceCode: r.itemInstance?.code ?? null,
        note: r.note,
        reversal: r.reversal,
      })),
    };
  },
};
