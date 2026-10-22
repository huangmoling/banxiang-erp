import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/** 库存查询仓储层：全部只读，库存数字一律从 stock_movements 求和得出 */
export const inventoryRepository = {
  locations() {
    return prisma.location.findMany({
      select: { id: true, name: true, type: true, isSellable: true },
      orderBy: { sortNo: "asc" },
    });
  },

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

  async sumByLocationIds(skuIds?: string[]): Promise<{ skuId: string; locationId: string; qty: number }[]> {
    const rows = await prisma.stockMovement.groupBy({
      by: ["skuId", "locationId"],
      where: skuIds ? { skuId: { in: skuIds } } : undefined,
      _sum: { qtyDelta: true },
    });
    return rows.map((r) => ({
      skuId: r.skuId,
      locationId: r.locationId,
      qty: r._sum.qtyDelta ?? 0,
    }));
  },

  /** 还有余量的批次数，按 SKU */
  async batchCountBySku(): Promise<Map<string, number>> {
    const rows = await prisma.batch.groupBy({
      by: ["skuId"],
      where: { quantity: { gt: 0 } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.skuId, r._count._all]));
  },

  /** 在库的定制件件数，按 SKU */
  async customCountBySku(): Promise<Map<string, number>> {
    const rows = await prisma.itemInstance.groupBy({
      by: ["skuId"],
      where: { status: "in_stock" },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.skuId, r._count._all]));
  },

  /** 最近一次业务日期，按 SKU（看这个款多久没动过） */
  async lastMovedBySku(): Promise<Map<string, Date>> {
    const rows = await prisma.stockMovement.groupBy({
      by: ["skuId"],
      _max: { occurredAt: true },
    });
    const map = new Map<string, Date>();
    for (const r of rows) if (r._max.occurredAt) map.set(r.skuId, r._max.occurredAt);
    return map;
  },

  /** 批次明细：只列还有余量的，空批次不占视线 */
  batches(params: { q?: string }) {
    const q = params.q?.trim();
    return prisma.batch.findMany({
      where: {
        quantity: { gt: 0 },
        ...(q
          ? {
              OR: [
                { batchNo: { contains: q } },
                { sku: { colorName: { contains: q } } },
                { sku: { product: { name: { contains: q } } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        batchNo: true,
        productionDate: true,
        quantity: true,
        sku: {
          select: {
            id: true,
            colorName: true,
            variantType: true,
            product: { select: { name: true, unit: true } },
          },
        },
      },
      orderBy: [{ productionDate: "asc" }, { batchNo: "asc" }],
      take: 500,
    });
  },

  /** 定制件台账：一物一码，每一件都能查到从哪来、去哪了 */
  instances(params: { q?: string; status?: string }) {
    const q = params.q?.trim();
    return prisma.itemInstance.findMany({
      where: {
        ...(params.status && params.status !== "all" ? { status: params.status } : {}),
        ...(q
          ? {
              OR: [
                { code: { contains: q } },
                { note: { contains: q } },
                { sku: { colorName: { contains: q } } },
                { sku: { product: { name: { contains: q } } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        code: true,
        status: true,
        productionDate: true,
        note: true,
        inboundDocumentId: true,
        outboundDocumentId: true,
        sku: {
          select: {
            id: true,
            colorName: true,
            product: { select: { name: true, unit: true } },
          },
        },
        location: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { code: "desc" }],
      take: 500,
    });
  },

  /** 批量取单号：件台账上只存了单据 id，展示要单号 */
  documentsByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return prisma.document.findMany({
      where: { id: { in: ids } },
      select: { id: true, docNo: true, bizDate: true },
    });
  },

  async movementPage(params: {
    q?: string;
    bizType?: string;
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  }) {
    const q = params.q?.trim();
    const where: Prisma.StockMovementWhereInput = {
      ...(params.bizType && params.bizType !== "all" ? { bizType: params.bizType } : {}),
      ...(params.from || params.to
        ? {
            occurredAt: {
              ...(params.from ? { gte: params.from } : {}),
              ...(params.to ? { lte: params.to } : {}),
            },
          }
        : {}),
      ...(q
        ? {
            OR: [
              { note: { contains: q } },
              { sku: { colorName: { contains: q } } },
              { sku: { product: { name: { contains: q } } } },
              { document: { docNo: { contains: q } } },
              { itemInstance: { code: { contains: q } } },
              { batch: { batchNo: { contains: q } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        select: {
          id: true,
          occurredAt: true,
          bizType: true,
          qtyDelta: true,
          note: true,
          reversal: true,
          sku: {
            select: {
              id: true,
              colorName: true,
              product: { select: { name: true, unit: true } },
            },
          },
          location: { select: { name: true } },
          batch: { select: { batchNo: true } },
          itemInstance: { select: { code: true } },
          document: { select: { docNo: true, type: true, status: true } },
        },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);

    return { total, rows };
  },
};

export type InventoryRepository = typeof inventoryRepository;
