import "server-only";
import { prisma } from "@/lib/prisma";

/** 报表只读仓储层：全部是从既有表里「读」，不写任何东西 */
export const reportRepository = {
  /** 全部仓位（判断哪些流水算可售、哪些算次品区） */
  locations() {
    return prisma.location.findMany({
      select: { id: true, name: true, type: true, isSellable: true },
      orderBy: { sortNo: "asc" },
    });
  },

  /**
   * 区间内的全部流水。
   * 只取四个字段，量级是「每月几十到几百条」，一次取回内存分桶比按月发 12 轮
   * groupBy 更省事，也不会因为跨月边界算错。若将来流水上百万条，这里要改成按 SQL 分组。
   */
  movementsBetween(from: Date, to: Date) {
    return prisma.stockMovement.findMany({
      where: { occurredAt: { gte: from, lte: to } },
      select: { occurredAt: true, bizType: true, qtyDelta: true, locationId: true, skuId: true },
    });
  },

  /** 启用中的 SKU 与商品档案（报表的「款」= SKU，一个颜色一行） */
  skus() {
    return prisma.sku.findMany({
      where: { isActive: true, product: { isActive: true } },
      select: {
        id: true,
        colorName: true,
        variantType: true,
        safetyStock: true,
        product: { select: { id: true, name: true, unit: true } },
      },
      orderBy: [{ product: { name: "asc" } }, { colorName: "asc" }],
    });
  },

  /** 可售仓位的结存，按 SKU 汇总 */
  async sellableBySku(): Promise<Map<string, number>> {
    const locations = await prisma.location.findMany({
      where: { isSellable: true },
      select: { id: true },
    });
    if (locations.length === 0) return new Map();

    const rows = await prisma.stockMovement.groupBy({
      by: ["skuId"],
      where: { locationId: { in: locations.map((l) => l.id) } },
      _sum: { qtyDelta: true },
    });
    return new Map(rows.map((r) => [r.skuId, r._sum.qtyDelta ?? 0]));
  },

  /** 某一类仓位的结存，按 SKU 汇总（次品区存量、报废区存量用） */
  async byLocationTypeSumBySku(type: string): Promise<Map<string, number>> {
    const locations = await prisma.location.findMany({
      where: { type },
      select: { id: true },
    });
    if (locations.length === 0) return new Map();

    const rows = await prisma.stockMovement.groupBy({
      by: ["skuId"],
      where: { locationId: { in: locations.map((l) => l.id) } },
      _sum: { qtyDelta: true },
    });
    return new Map(
      rows
        .map((r) => [r.skuId, r._sum.qtyDelta ?? 0] as [string, number])
        .filter(([, qty]) => qty !== 0),
    );
  },

  /** 还有余量的批次（账龄分析只看「还压在仓库里的」） */
  batchesWithStock() {
    return prisma.batch.findMany({
      where: { quantity: { gt: 0 } },
      select: {
        id: true,
        batchNo: true,
        productionDate: true,
        quantity: true,
        sku: {
          select: { id: true, colorName: true, product: { select: { name: true, unit: true } } },
        },
      },
      orderBy: { productionDate: "asc" },
    });
  },

  /**
   * 区间内「有效」的处置单明细。
   * 损耗口径按单据算而不是按流水算：处置单被红冲后 status 变 voided 自动排除，
   * 流水那边红冲会补一条正数，两种算法结果一样，但按单据能顺带拆出处置方式。
   */
  disposalItemsBetween(from: Date, to: Date) {
    return prisma.documentItem.findMany({
      where: {
        document: { type: "scrap", status: "approved", bizDate: { gte: from, lte: to } },
      },
      select: {
        qty: true,
        disposition: true,
        sku: {
          select: { id: true, colorName: true, variantType: true, product: { select: { name: true, unit: true } } },
        },
        document: {
          select: {
            bizDate: true,
            location: { select: { id: true, name: true, type: true } },
          },
        },
      },
    });
  },

  /** 单据作业量：各类型各状态各多少张 */
  docCounts() {
    return prisma.document.groupBy({
      by: ["type", "status"],
      _count: { _all: true },
    });
  },
};

export type ReportRepository = typeof reportRepository;
