import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/** 可售仓位（主仓）id 列表。次品区 / 报废区不可售，单独统计 */
async function sellableLocationIds(): Promise<string[]> {
  const rows = await prisma.location.findMany({
    where: { isSellable: true },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * 可售仓位按 SKU 汇总。
 * 传 tx 时读到的是事务内最新状态（出库审核必须用这个，否则并发下会超发）。
 */
async function sumSellable(db: Prisma.TransactionClient, skuIds: string[]): Promise<Map<string, number>> {
  if (skuIds.length === 0) return new Map();

  const locations = await db.location.findMany({
    where: { isSellable: true },
    select: { id: true },
  });
  if (locations.length === 0) return new Map();

  const rows = await db.stockMovement.groupBy({
    by: ["skuId"],
    where: { skuId: { in: skuIds }, locationId: { in: locations.map((l) => l.id) } },
    _sum: { qtyDelta: true },
  });

  return new Map(rows.map((r) => [r.skuId, r._sum.qtyDelta ?? 0]));
}

/**
 * 库存推导仓储层。
 * 库存数字没有任何「当前值」字段可以写，只能对 stock_movements 求和。
 * 这样无论谁在什么时候查，账都能对上；错账只能通过红冲修，不能改数字。
 */
export const stockRepository = {
  sellableLocationIds,

  /** 批量取多个 SKU 的可售库存，避免逐条查询造成 N+1 */
  stockBySkuIds(skuIds: string[]): Promise<Map<string, number>> {
    return sumSellable(prisma, skuIds);
  },

  /**
   * 事务内版本：审单时必须和写流水在同一个事务里读，
   * 否则「查库存 → 判定够 → 写流水」之间别人可以插进来把货出掉。
   */
  stockBySkuIdsInTx(skuIds: string[], db: Prisma.TransactionClient): Promise<Map<string, number>> {
    return sumSellable(db, skuIds);
  },

  /** 全库可售在库总件数 */
  async onHand(): Promise<number> {
    const locations = await sellableLocationIds();
    if (locations.length === 0) return 0;

    const agg = await prisma.stockMovement.aggregate({
      where: { locationId: { in: locations } },
      _sum: { qtyDelta: true },
    });
    return agg._sum.qtyDelta ?? 0;
  },

  /** 次品区（不可售）当前件数：单独报表，不混进可售库存 */
  async defectiveQty(): Promise<number> {
    const locs = await prisma.location.findMany({
      where: { type: "defective" },
      select: { id: true },
    });
    if (locs.length === 0) return 0;

    const agg = await prisma.stockMovement.aggregate({
      where: { locationId: { in: locs.map((l) => l.id) } },
      _sum: { qtyDelta: true },
    });
    return agg._sum.qtyDelta ?? 0;
  },

  /**
   * 按业务类型汇总某时间段内的业务量（件数，始终为正）。
   * 入库是正流水、出库是负流水，所以按方向取绝对值；
   * 同时只统计「正向入账」的那一侧，红冲/作废产生的反向流水不能把数字抵消掉。
   */
  async sumByBizTypesSince(
    bizTypes: string[],
    since: Date,
    direction: "in" | "out" = "in",
  ): Promise<number> {
    if (bizTypes.length === 0) return 0;

    const agg = await prisma.stockMovement.aggregate({
      where: {
        bizType: { in: bizTypes },
        occurredAt: { gte: since },
        qtyDelta: direction === "in" ? { gt: 0 } : { lt: 0 },
      },
      _sum: { qtyDelta: true },
    });
    return Math.abs(agg._sum.qtyDelta ?? 0);
  },

  /** 某 SKU 各仓位的结存明细（详情页/盘点核对用） */
  async stockByLocation(skuIds: string[]): Promise<
    { skuId: string; locationId: string; locationName: string; qty: number }[]
  > {
    if (skuIds.length === 0) return [];

    const rows = await prisma.stockMovement.groupBy({
      by: ["skuId", "locationId"],
      where: { skuId: { in: skuIds } },
      _sum: { qtyDelta: true },
    });

    const locations = await prisma.location.findMany({
      select: { id: true, name: true },
    });
    const nameMap = new Map(locations.map((l) => [l.id, l.name]));

    return rows.map((r) => ({
      skuId: r.skuId,
      locationId: r.locationId,
      locationName: nameMap.get(r.locationId) ?? "未知仓位",
      qty: r._sum.qtyDelta ?? 0,
    }));
  },
};

export type StockRepository = typeof stockRepository;
export type Db = Prisma.TransactionClient;
