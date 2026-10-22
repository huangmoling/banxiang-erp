import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { formatCompactDate } from "@/lib/date";
import { PRESENT_INSTANCE_STATUSES } from "./stocktake.types";

type Db = Prisma.TransactionClient;

export const stocktakeItemSelect = {
  id: true,
  lineNo: true,
  skuId: true,
  qty: true,
  bookQty: true,
  remark: true,
  sku: {
    select: {
      colorName: true,
      variantType: true,
      product: { select: { id: true, name: true, unit: true } },
    },
  },
} satisfies Prisma.DocumentItemSelect;

export const stocktakeDocSelect = {
  id: true,
  docNo: true,
  status: true,
  bizDate: true,
  snapshotAt: true,
  locationId: true,
  remark: true,
  itemCount: true,
  totalQty: true,
  approvedAt: true,
  createdAt: true,
  location: { select: { name: true, type: true, isSellable: true } },
  createdBy: { select: { displayName: true } },
  approvedBy: { select: { displayName: true } },
  items: { orderBy: { lineNo: "asc" }, select: stocktakeItemSelect },
} satisfies Prisma.DocumentSelect;

export type StocktakeDocRecord = Prisma.DocumentGetPayload<{ select: typeof stocktakeDocSelect }>;
export type StocktakeItemRecord = StocktakeDocRecord["items"][number];

export type CreateStocktakeDocData = {
  docNo: string;
  type: string;
  status: string;
  bizDate: Date;
  snapshotAt: Date;
  locationId: string;
  remark: string | null;
  itemCount: number;
  totalQty: number;
  createdById: string | null;
};

export type CreateStocktakeItemData = {
  skuId: string;
  lineNo: number;
  qty: number;
  bookQty: number;
  remark: string | null;
};

/** 按 SKU 汇总某组流水的净数量（正负相加），避免逐条查 */
async function sumQtyBySku(
  db: Db,
  where: Prisma.StockMovementWhereInput,
): Promise<Map<string, number>> {
  const rows = await db.stockMovement.groupBy({
    by: ["skuId"],
    where,
    _sum: { qtyDelta: true },
  });
  return new Map(rows.map((r) => [r.skuId, r._sum.qtyDelta ?? 0]));
}

export const stocktakeRepository = {
  findById(id: string): Promise<StocktakeDocRecord | null> {
    return prisma.document.findFirst({
      where: { id, type: "stocktake" },
      select: stocktakeDocSelect,
    });
  },

  async list(params: {
    q: string;
    status: "all" | "draft" | "approved" | "voided";
    page: number;
    pageSize: number;
  }): Promise<{ items: StocktakeDocRecord[]; total: number }> {
    const q = params.q.trim();
    const where: Prisma.DocumentWhereInput = {
      type: "stocktake",
      ...(params.status !== "all" ? { status: params.status } : {}),
      ...(q
        ? {
            OR: [
              { docNo: { contains: q } },
              { remark: { contains: q } },
              { location: { name: { contains: q } } },
              { items: { some: { sku: { product: { name: { contains: q } } } } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.document.findMany({
        where,
        select: stocktakeDocSelect,
        orderBy: [{ bizDate: "desc" }, { createdAt: "desc" }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      prisma.document.count({ where }),
    ]);

    return { items, total };
  },

  async counts(): Promise<{ draft: number; approved: number }> {
    const [draft, approved] = await Promise.all([
      prisma.document.count({ where: { type: "stocktake", status: "draft" } }),
      prisma.document.count({ where: { type: "stocktake", status: "approved" } }),
    ]);
    return { draft, approved };
  },

  /** 当天最大单号 +1：删过草稿也不重号 */
  async nextDocNo(bizDate: Date, db: Db): Promise<string> {
    const prefix = `PD-${formatCompactDate(bizDate)}-`;
    const last = await db.document.findFirst({
      where: { docNo: { startsWith: prefix } },
      select: { docNo: true },
      orderBy: { docNo: "desc" },
    });

    const lastSeq = last ? Number.parseInt(last.docNo.slice(prefix.length), 10) : 0;
    const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
    return `${prefix}${String(next).padStart(3, "0")}`;
  },

  createDoc(
    data: CreateStocktakeDocData,
    items: CreateStocktakeItemData[],
    db: Db,
  ): Promise<{ id: string; items: { id: string; lineNo: number }[] }> {
    return db.document.create({
      data: { ...data, items: { create: items } },
      select: { id: true, items: { select: { id: true, lineNo: true } } },
    });
  },

  findForApprove(id: string, db: Db) {
    return db.document.findFirst({
      where: { id, type: "stocktake" },
      select: {
        id: true,
        docNo: true,
        status: true,
        bizDate: true,
        snapshotAt: true,
        locationId: true,
        location: { select: { id: true, name: true, type: true, isSellable: true } },
        items: {
          orderBy: { lineNo: "asc" },
          select: {
            id: true,
            lineNo: true,
            skuId: true,
            qty: true,
            bookQty: true,
            sku: {
              select: {
                variantType: true,
                colorName: true,
                product: { select: { id: true, name: true, unit: true } },
              },
            },
            stocktakeInstances: {
              select: { id: true, code: true, status: true, locationId: true, stocktakeItemId: true },
            },
          },
        },
      },
    });
  },

  markApproved(id: string, approvedById: string, db: Db) {
    return db.document.update({
      where: { id },
      data: { status: "approved", approvedById, approvedAt: new Date() },
    });
  },

  deleteDraft(id: string, db: Db): Promise<unknown> {
    return db.document.delete({ where: { id } });
  },

  /** 同一仓位里还挂着的盘点草稿：两张草稿都按同一个基数调整会把差异算两遍 */
  findOtherDraft(
    locationId: string,
    excludeId: string | null,
    db: Db = prisma,
  ): Promise<{ id: string; docNo: string } | null> {
    return db.document.findFirst({
      where: {
        type: "stocktake",
        status: "draft",
        locationId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, docNo: true },
    });
  },

  // ---------------- 仓位 ----------------

  locations(): Promise<{ id: string; name: string; type: string; isSellable: boolean }[]> {
    return prisma.location.findMany({
      select: { id: true, name: true, type: true, isSellable: true },
      orderBy: [{ sortNo: "asc" }, { name: "asc" }],
    });
  },

  location(id: string): Promise<{ id: string; name: string; type: string; isSellable: boolean } | null> {
    return prisma.location.findUnique({
      where: { id },
      select: { id: true, name: true, type: true, isSellable: true },
    });
  },

  // ---------------- 账面 / 截止后变动 ----------------

  /**
   * 账面数：截止时点之前**录入**的流水合计。
   * 用 createdAt（录入时刻）而不是 occurredAt（业务日期）做水位线，
   * 因为业务日期只到「天」：晚上 9 点发的货和凌晨录的单会被算成同一个时点，
   * 一混就把截止后的出库算进了账面。createdAt 一旦写入永不改动，
   * 所以基数天然冻结——建单之后才有的一切流水都进不了账面。
   */
  bookQtyBySku(locationId: string, snapshotAt: Date, db: Db = prisma): Promise<Map<string, number>> {
    return sumQtyBySku(db, { locationId, createdAt: { lte: snapshotAt } });
  },

  /** 截止后变动：水位线之后的净额。排除本单自己的盘点调整，否则会把自己算成「之后的变动」 */
  afterQtyBySku(
    locationId: string,
    snapshotAt: Date,
    excludeDocumentId?: string,
    db: Db = prisma,
  ): Promise<Map<string, number>> {
    return sumQtyBySku(db, {
      locationId,
      createdAt: { gt: snapshotAt },
      ...(excludeDocumentId
        ? { OR: [{ documentId: null }, { documentId: { not: excludeDocumentId } }] }
        : {}),
    });
  },

  /** 这批 SKU 的档案信息（产品名、颜色、单位、常规/定制） */
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

  /** 自定义排序用：按产品名 + 颜色排，跟货架上的摆放顺序大致对得上 */
  productNamesByIds(ids: string[]): Promise<{ id: string; name: string }[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  },

  // ---------------- 单件（定制款） ----------------

  /** 此刻还物理躺在这个仓位里的件（在库 / 次品区 / 退回待检） */
  instancesPresentAt(locationId: string, skuIds: string[]) {
    if (skuIds.length === 0) return Promise.resolve([]);
    return prisma.itemInstance.findMany({
      where: {
        locationId,
        skuId: { in: skuIds },
        status: { in: PRESENT_INSTANCE_STATUSES },
      },
      select: {
        id: true,
        code: true,
        skuId: true,
        status: true,
        productionDate: true,
        stocktakeItemId: true,
        /** 已经被出库草稿拣走的件：实物可能还在架上，但不能再判它丢了 */
        outboundItemId: true,
      },
      orderBy: { code: "asc" },
    });
  },

  /** 「这一件已被 PD-… 判为盘亏」——不然另一个人会以为系统把件弄丢了 */
  findHolderDocNosByItemIds(itemIds: string[]): Promise<{ id: string; document: { docNo: string } }[]> {
    if (itemIds.length === 0) return Promise.resolve([]);
    return prisma.documentItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, document: { select: { docNo: true } } },
    });
  },

  /**
   * 草稿阶段就把「判为盘亏的件」挂到行上：
   * 这些件立刻从可出库里消失，免得一边说丢了、一边又发出去。
   * 删草稿靠外键 SetNull 自动放开。
   */
  lockInstancesToItem(instanceIds: string[], itemId: string, db: Db) {
    return db.itemInstance.updateMany({
      where: {
        id: { in: instanceIds },
        stocktakeItemId: null,
        // 在库的件如果正被出库草稿占着，不能同时被判盘亏：
        // 发货时会发现「这件的账面已经被盘掉了」。次品区/待检的件不受此限。
        OR: [{ outboundItemId: null }, { status: { not: "in_stock" } }],
      },
      data: { stocktakeItemId: itemId },
    });
  },

  /** 审核：件真的找不到了 → 状态置盘亏、仓位清空 */
  markInstancesMissing(instanceIds: string[], db: Db) {
    return db.itemInstance.updateMany({
      where: { id: { in: instanceIds } },
      data: { status: "missing", locationId: null },
    });
  },

  /** 详情页用：本单各行判为盘亏的件（草稿也有），不依赖流水 */
  listInstancesByItemIds(itemIds: string[]) {
    if (itemIds.length === 0) return Promise.resolve([]);
    return prisma.itemInstance.findMany({
      where: { stocktakeItemId: { in: itemIds } },
      select: { id: true, code: true, stocktakeItemId: true, status: true },
      orderBy: { code: "asc" },
    });
  },

  // ---------------- 批次（只有可售仓位才对批次） ----------------

  listBatchesWithStock(skuId: string, db: Db) {
    return db.batch.findMany({
      where: { skuId, quantity: { gt: 0 } },
      select: { id: true, batchNo: true, quantity: true },
      orderBy: [{ productionDate: "asc" }, { createdAt: "asc" }],
    });
  },

  /** 盘盈要有个批次接住，否则批次合计会比库存少；盘出来的货没有生产日期，单独归一个批次 */
  createOrGetBatch(skuId: string, batchNo: string, qty: number, db: Db) {
    return db.batch.upsert({
      where: { skuId_batchNo: { skuId, batchNo } },
      create: { skuId, batchNo, productionDate: null, quantity: qty },
      update: { quantity: { increment: qty } },
      select: { id: true, batchNo: true, quantity: true },
    });
  },

  incrementBatch(id: string, qty: number, db: Db) {
    return db.batch.update({ where: { id }, data: { quantity: { increment: qty } } });
  },

  decrementBatch(id: string, qty: number, db: Db) {
    return db.batch.update({ where: { id }, data: { quantity: { decrement: qty } } });
  },

  // ---------------- 流水 ----------------

  createMovement(
    data: {
      skuId: string;
      locationId: string;
      qtyDelta: number;
      bizType: string;
      documentId: string;
      documentItemId: string;
      batchId?: string | null;
      itemInstanceId?: string | null;
      occurredAt: Date;
      createdById: string | null;
      note?: string | null;
    },
    db: Db,
  ): Promise<void> {
    return db.stockMovement.create({ data }).then(() => undefined);
  },
};
