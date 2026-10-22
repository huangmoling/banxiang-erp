import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { formatCompactDate } from "@/lib/date";

type Db = Prisma.TransactionClient;

export const inboundItemSelect = {
  id: true,
  lineNo: true,
  skuId: true,
  qty: true,
  productionDate: true,
  batchNo: true,
  remark: true,
  sku: {
    select: {
      colorName: true,
      variantType: true,
      product: { select: { id: true, name: true, unit: true } },
    },
  },
} satisfies Prisma.DocumentItemSelect;

export const inboundDocSelect = {
  id: true,
  docNo: true,
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
  location: { select: { name: true } },
  createdBy: { select: { displayName: true } },
  approvedBy: { select: { displayName: true } },
  voidedBy: { select: { displayName: true } },
  items: { orderBy: { lineNo: "asc" }, select: inboundItemSelect },
} satisfies Prisma.DocumentSelect;

export type InboundDocRecord = Prisma.DocumentGetPayload<{ select: typeof inboundDocSelect }>;
export type InboundItemRecord = InboundDocRecord["items"][number];

export type CreateDocData = {
  docNo: string;
  type: string;
  status: string;
  bizDate: Date;
  locationId: string | null;
  remark: string | null;
  itemCount: number;
  totalQty: number;
  createdById: string | null;
};

export type CreateItemData = {
  skuId: string;
  lineNo: number;
  qty: number;
  productionDate: Date | null;
  batchNo: string | null;
  remark: string | null;
};

export const inboundRepository = {
  findById(id: string): Promise<InboundDocRecord | null> {
    return prisma.document.findFirst({
      where: { id, type: "inbound" },
      select: inboundDocSelect,
    });
  },

  async list(params: {
    q: string;
    status: "all" | "draft" | "approved" | "voided";
    page: number;
    pageSize: number;
  }): Promise<{ items: InboundDocRecord[]; total: number }> {
    const q = params.q.trim();
    const where: Prisma.DocumentWhereInput = {
      type: "inbound",
      ...(params.status !== "all" ? { status: params.status } : {}),
      ...(q
        ? {
            OR: [
              { docNo: { contains: q } },
              { remark: { contains: q } },
              { items: { some: { sku: { product: { name: { contains: q } } } } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.document.findMany({
        where,
        select: inboundDocSelect,
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
      prisma.document.count({ where: { type: "inbound", status: "draft" } }),
      prisma.document.count({ where: { type: "inbound", status: "approved" } }),
    ]);
    return { draft, approved };
  },

  /**
   * 取当天最大单号 +1。用 max 而不是 count：
   * 中间删过草稿也不会把单号重复发出去。
   */
  async nextDocNo(bizDate: Date, db: Db): Promise<string> {
    const prefix = `RK-${formatCompactDate(bizDate)}-`;
    const last = await db.document.findFirst({
      where: { docNo: { startsWith: prefix } },
      select: { docNo: true },
      orderBy: { docNo: "desc" },
    });

    const lastSeq = last ? Number.parseInt(last.docNo.slice(prefix.length), 10) : 0;
    const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
    return `${prefix}${String(next).padStart(3, "0")}`;
  },

  createDoc(data: CreateDocData, items: CreateItemData[], db: Db): Promise<{ id: string }> {
    return db.document.create({
      data: { ...data, items: { create: items } },
      select: { id: true },
    });
  },

  /** 审核时读取：带 SKU 的规格（判断按件还是按数量）与所属产品 */
  findForApprove(id: string, db: Db) {
    return db.document.findFirst({
      where: { id, type: "inbound" },
      select: {
        id: true,
        docNo: true,
        status: true,
        bizDate: true,
        locationId: true,
        items: {
          orderBy: { lineNo: "asc" },
          select: {
            id: true,
            skuId: true,
            qty: true,
            productionDate: true,
            batchNo: true,
            sku: {
              select: {
                variantType: true,
                colorName: true,
                product: { select: { id: true, name: true } },
              },
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

  /** 同一 SKU + 同一生产日期归为一个批次，数量累加 */
  ensureBatch(
    data: { skuId: string; batchNo: string; productionDate: Date | null; qty: number },
    db: Db,
  ): Promise<{ id: string }> {
    return db.batch.upsert({
      where: { skuId_batchNo: { skuId: data.skuId, batchNo: data.batchNo } },
      create: {
        skuId: data.skuId,
        batchNo: data.batchNo,
        productionDate: data.productionDate,
        quantity: data.qty,
      },
      update: { quantity: { increment: data.qty } },
      select: { id: true },
    });
  },

  createInstance(
    data: {
      code: string;
      skuId: string;
      status: string;
      locationId: string;
      productionDate: Date | null;
      inboundDocumentId: string;
      /** 入库来源明细行：一物一码的「这件是哪一行进的」，删除/红冲都要靠它定位 */
      documentItemId?: string | null;
      batchId?: string | null;
    },
    db: Db,
  ): Promise<{ id: string }> {
    return db.itemInstance.create({ data, select: { id: true } });
  },

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
    },
    db: Db,
  ): Promise<void> {
    return db.stockMovement.create({ data }).then(() => undefined);
  },

  countInstancesByPrefix(prefix: string, db: Db): Promise<number> {
    return db.itemInstance.count({ where: { code: { startsWith: prefix } } });
  },

  /** 单据审核后刷新商品「近 90 天使用次数」，让常用款在选品搜索里排前面 */
  async touchProducts(productIds: string[], db: Db): Promise<void> {
    for (const id of productIds) {
      await db.product.update({
        where: { id },
        data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
      });
    }
  },

  /** 只允许删除草稿：已生效的单据必须走红冲，原始记录永久保留 */
  deleteDraft(id: string, db: Db): Promise<unknown> {
    return db.document.delete({ where: { id } });
  },

  /** 定制件审核后回填唯一编号，用于详情页展示 */
  findInstanceCodes(documentId: string) {
    return prisma.stockMovement.findMany({
      where: { documentId, itemInstanceId: { not: null } },
      select: { documentItemId: true, itemInstanceId: true },
    });
  },

  findInstanceCodeMap(instanceIds: string[]): Promise<{ id: string; code: string }[]> {
    if (instanceIds.length === 0) return Promise.resolve([]);
    return prisma.itemInstance.findMany({
      where: { id: { in: instanceIds } },
      select: { id: true, code: true },
    });
  },

  listNormalLocations(): Promise<{ id: string; name: string }[]> {
    return prisma.location.findMany({
      where: { type: "normal", isSellable: true },
      select: { id: true, name: true },
      orderBy: [{ sortNo: "asc" }, { name: "asc" }],
    });
  },
};
