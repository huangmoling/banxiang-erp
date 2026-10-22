import "server-only";
import { prisma } from "@/lib/prisma";
import { formatCompactDate } from "@/lib/date";
import type { Prisma } from "@prisma/client";

export type Db = Prisma.TransactionClient;

/** 处置单列表/详情共用的取数形状：一次取全，避免详情页再补四五次查询 */
const DOC_SELECT = {
  id: true,
  docNo: true,
  type: true,
  status: true,
  bizDate: true,
  locationId: true,
  remark: true,
  itemCount: true,
  totalQty: true,
  approvedAt: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  location: { select: { id: true, name: true, type: true, isSellable: true } },
  createdBy: { select: { displayName: true } },
  approvedBy: { select: { displayName: true } },
  voidedBy: { select: { displayName: true } },
  items: {
    orderBy: { lineNo: "asc" },
    include: {
      sku: {
        select: {
          id: true,
          colorName: true,
          variantType: true,
          product: { select: { id: true, name: true, unit: true } },
        },
      },
      disposalInstances: {
        select: { id: true, code: true, status: true, locationId: true, disposalItemId: true },
      },
    },
  },
} satisfies Prisma.DocumentSelect;

export type RawScrapDoc = Prisma.DocumentGetPayload<{ select: typeof DOC_SELECT }>;

export const scrapRepository = {
  async list(params: {
    q: string;
    status: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: RawScrapDoc[]; total: number; counts: { draft: number; approved: number } }> {
    const where: Prisma.DocumentWhereInput = {
      type: "scrap",
      ...(params.status === "all" ? {} : { status: params.status }),
      ...(params.q
        ? {
            OR: [
              { docNo: { contains: params.q } },
              { remark: { contains: params.q } },
              {
                items: {
                  some: {
                    sku: { product: { name: { contains: params.q } } },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total, grouped] = await Promise.all([
      prisma.document.findMany({
        where,
        select: DOC_SELECT,
        orderBy: [{ bizDate: "desc" }, { docNo: "desc" }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      prisma.document.count({ where }),
      prisma.document.groupBy({
        by: ["status"],
        where: { type: "scrap" },
        _count: { _all: true },
      }),
    ]);

    const counts = { draft: 0, approved: 0 };
    for (const g of grouped) {
      if (g.status === "draft") counts.draft = g._count._all;
      if (g.status === "approved") counts.approved = g._count._all;
    }

    return { rows, total, counts };
  },

  findById(id: string): Promise<RawScrapDoc | null> {
    return prisma.document.findFirst({ where: { id, type: "scrap" }, select: DOC_SELECT });
  },

  /** 审核用：事务内取，明细与件一起读，避免校验与写流水之间被插队 */
  findForApprove(id: string, db: Db): Promise<RawScrapDoc | null> {
    return db.document.findFirst({ where: { id, type: "scrap" }, select: DOC_SELECT });
  },

  async nextDocNo(bizDate: Date, db: Db): Promise<string> {
    const prefix = `BF-${formatCompactDate(bizDate)}-`;
    const last = await db.document.findFirst({
      where: { docNo: { startsWith: prefix } },
      select: { docNo: true },
      orderBy: { docNo: "desc" },
    });
    // 取最大值 +1 而不是数条数：删掉草稿不会导致后面的单号重号
    const lastSeq = last ? Number.parseInt(last.docNo.slice(prefix.length), 10) : 0;
    const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
    return `${prefix}${String(next).padStart(3, "0")}`;
  },

  createDoc(
    data: {
      docNo: string;
      type: string;
      bizDate: Date;
      locationId: string;
      remark: string | null;
      itemCount: number;
      totalQty: number;
      createdById: string;
    },
    items: {
      skuId: string;
      lineNo: number;
      qty: number;
      disposition: string;
      remark: string | null;
    }[],
    db: Db,
  ): Promise<{ id: string; items: { id: string; lineNo: number }[] }> {
    return db.document.create({
      data: { ...data, items: { create: items } },
      select: { id: true, items: { select: { id: true, lineNo: true } } },
    });
  },

  /**
   * 草稿阶段锁件：这一件已经被这张单预定了，别的单选不到它。
   *
   * 注意 outboundItemId 的判定：件退回来之后仍保留着「当年被哪张出库单选走」的记录
   * （历史要追溯），但它已经不在库、不可能再被出库草稿占用。
   * 所以只有 in_stock 的件才需要检查出库占用，否则退回次品区的件永远处理不掉。
   */
  lockInstancesToItem(instanceIds: string[], itemId: string, db: Db) {
    return db.itemInstance.updateMany({
      where: {
        id: { in: instanceIds },
        stocktakeItemId: null,
        disposalItemId: null,
        OR: [{ outboundItemId: null }, { status: { not: "in_stock" } }],
      },
      data: { disposalItemId: itemId },
    });
  },

  /** 这个仓位的这批 SKU 现在各有多少（结存 = 流水求和） */
  async stockInLocation(
    locationId: string,
    skuIds: string[],
    db: Db,
  ): Promise<Map<string, number>> {
    if (skuIds.length === 0) return new Map();
    const rows = await db.stockMovement.groupBy({
      by: ["skuId"],
      where: { locationId, skuId: { in: skuIds } },
      _sum: { qtyDelta: true },
    });
    return new Map(rows.map((r) => [r.skuId, r._sum.qtyDelta ?? 0]));
  },

  /** 某仓位全部有货的 SKU（建单页列候选行用） */
  async skusWithStock(locationId: string): Promise<{ skuId: string; qty: number }[]> {
    // 不用 groupBy 的 having：SQLite 下 `_count` 的 having 写法容易踩方言差异，
    // 这里的行数本来就不多，取回来在内存里过滤更稳
    const rows = await prisma.stockMovement.groupBy({
      by: ["skuId"],
      where: { locationId },
      _sum: { qtyDelta: true },
    });
    return rows
      .map((r) => ({ skuId: r.skuId, qty: r._sum.qtyDelta ?? 0 }))
      .filter((r) => r.qty > 0);
  },

  skuInfoByIds(skuIds: string[]) {
    if (skuIds.length === 0) return Promise.resolve([]);
    return prisma.sku.findMany({
      where: { id: { in: skuIds } },
      select: {
        id: true,
        colorName: true,
        variantType: true,
        product: { select: { id: true, name: true, unit: true } },
      },
    });
  },

  /** 这个仓位里物理还在的件（在库 / 次品区 / 退回待检） */
  instancesInLocation(locationId: string, skuIds: string[]) {
    if (skuIds.length === 0) return Promise.resolve([]);
    return prisma.itemInstance.findMany({
      where: {
        locationId,
        skuId: { in: skuIds },
        status: { in: ["in_stock", "defective", "returned"] },
      },
      select: {
        id: true,
        code: true,
        skuId: true,
        status: true,
        productionDate: true,
        outboundItemId: true,
        stocktakeItemId: true,
        disposalItemId: true,
      },
      orderBy: { code: "asc" },
    });
  },

  /** 被占用的件分别挂在哪张草稿上，界面上要显示「被 CK-… 占着」 */
  async findHolderDocNos(itemIds: string[]): Promise<Map<string, string>> {
    if (itemIds.length === 0) return new Map();
    const rows = await prisma.documentItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, document: { select: { docNo: true } } },
    });
    return new Map(rows.map((r) => [r.id, r.document.docNo]));
  },

  listBatchesWithStock(skuId: string, db: Db) {
    return db.batch.findMany({
      where: { skuId, quantity: { gt: 0 } },
      select: { id: true, batchNo: true, quantity: true },
      orderBy: [{ productionDate: "asc" }, { createdAt: "asc" }],
    });
  },

  decrementBatch(batchId: string, qty: number, db: Db) {
    return db.batch.update({
      where: { id: batchId },
      data: { quantity: { decrement: qty } },
      select: { id: true, batchNo: true, quantity: true },
    });
  },

  createMovement(
    data: {
      skuId: string;
      locationId: string;
      qtyDelta: number;
      bizType: string;
      documentId: string;
      documentItemId: string;
      batchId: string | null;
      itemInstanceId?: string | null;
      occurredAt: Date;
      createdById: string;
      note: string;
    },
    db: Db,
  ) {
    return db.stockMovement.create({ data });
  },

  setInstanceState(
    ids: string[],
    data: { status: string; locationId: string | null },
    db: Db,
  ) {
    if (ids.length === 0) return Promise.resolve({ count: 0 });
    return db.itemInstance.updateMany({ where: { id: { in: ids } }, data });
  },

  markApproved(id: string, userId: string, db: Db) {
    return db.document.update({
      where: { id },
      data: { status: "approved", approvedAt: new Date(), approvedById: userId },
      select: { id: true },
    });
  },

  /** 删草稿：明细由外键级联删掉，被锁的件靠 disposalItemId 的 SetNull 自动放开 */
  deleteDraft(id: string, db: Db) {
    return db.document.delete({ where: { id } });
  },

  location(id: string) {
    return prisma.location.findUnique({ where: { id }, select: { id: true, name: true, type: true, isSellable: true } });
  },

  locations() {
    return prisma.location.findMany({
      select: { id: true, name: true, type: true, isSellable: true },
      orderBy: { sortNo: "asc" },
    });
  },
};

export type ScrapRepository = typeof scrapRepository;
