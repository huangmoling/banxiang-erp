import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { formatCompactDate } from "@/lib/date";

type Db = Prisma.TransactionClient;

export const returnItemSelect = {
  id: true,
  lineNo: true,
  skuId: true,
  qty: true,
  batchNo: true,
  remark: true,
  destination: true,
  originItemId: true,
  sku: {
    select: {
      colorName: true,
      variantType: true,
      product: { select: { id: true, name: true, unit: true } },
    },
  },
  /** 原出库行：详情页要显示「原单第几行、发了多少、之前退过多少」 */
  originItem: {
    select: { id: true, lineNo: true, qty: true, returnedQty: true, batchNo: true },
  },
} satisfies Prisma.DocumentItemSelect;

export const returnDocSelect = {
  id: true,
  docNo: true,
  status: true,
  bizDate: true,
  originDocumentId: true,
  externalNo: true,
  receiverName: true,
  trackingNo: true,
  remark: true,
  itemCount: true,
  totalQty: true,
  approvedAt: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  createdBy: { select: { displayName: true } },
  approvedBy: { select: { displayName: true } },
  voidedBy: { select: { displayName: true } },
  originDocument: { select: { id: true, docNo: true, bizDate: true } },
  items: { orderBy: { lineNo: "asc" }, select: returnItemSelect },
} satisfies Prisma.DocumentSelect;

export type ReturnDocRecord = Prisma.DocumentGetPayload<{ select: typeof returnDocSelect }>;
export type ReturnItemRecord = ReturnDocRecord["items"][number];

export type CreateReturnDocData = {
  docNo: string;
  type: string;
  status: string;
  bizDate: Date;
  originDocumentId: string;
  externalNo: string | null;
  receiverName: string | null;
  trackingNo: string | null;
  remark: string | null;
  itemCount: number;
  totalQty: number;
  createdById: string | null;
};

export type CreateReturnItemData = {
  skuId: string;
  lineNo: number;
  qty: number;
  batchNo: string | null;
  destination: string;
  originItemId: string;
  remark: string | null;
};

/** 原出库单的可退视图所需字段（搜索与详情共用） */
const originSelect = {
  id: true,
  docNo: true,
  bizDate: true,
  externalNo: true,
  receiverName: true,
  trackingNo: true,
  totalQty: true,
} satisfies Prisma.DocumentSelect;

export const returnRepository = {
  findById(id: string): Promise<ReturnDocRecord | null> {
    return prisma.document.findFirst({
      where: { id, type: "return" },
      select: returnDocSelect,
    });
  },

  async list(params: {
    q: string;
    status: "all" | "draft" | "approved" | "voided";
    page: number;
    pageSize: number;
  }): Promise<{ items: ReturnDocRecord[]; total: number }> {
    const q = params.q.trim();
    const where: Prisma.DocumentWhereInput = {
      type: "return",
      ...(params.status !== "all" ? { status: params.status } : {}),
      ...(q
        ? {
            OR: [
              { docNo: { contains: q } },
              { externalNo: { contains: q } },
              { trackingNo: { contains: q } },
              { receiverName: { contains: q } },
              { remark: { contains: q } },
              // 按原出库单号、原单淘宝单号反查也要能搜到
              { originDocument: { docNo: { contains: q } } },
              { originDocument: { externalNo: { contains: q } } },
              { items: { some: { sku: { product: { name: { contains: q } } } } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.document.findMany({
        where,
        select: returnDocSelect,
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
      prisma.document.count({ where: { type: "return", status: "draft" } }),
      prisma.document.count({ where: { type: "return", status: "approved" } }),
    ]);
    return { draft, approved };
  },

  /** 取当天最大单号 +1；删过草稿也不会重号 */
  async nextDocNo(bizDate: Date, db: Db): Promise<string> {
    const prefix = `TH-${formatCompactDate(bizDate)}-`;
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
    data: CreateReturnDocData,
    items: CreateReturnItemData[],
    db: Db,
  ): Promise<{ id: string; items: { id: string; lineNo: number }[] }> {
    return db.document.create({
      data: { ...data, items: { create: items } },
      select: { id: true, items: { select: { id: true, lineNo: true } } },
    });
  },

  /** 审核时读取：带原出库行的「已发 / 已退」，以及这一行勾选回来的单件 */
  findForApprove(id: string, db: Db) {
    return db.document.findFirst({
      where: { id, type: "return" },
      select: {
        id: true,
        docNo: true,
        status: true,
        bizDate: true,
        originDocumentId: true,
        items: {
          orderBy: { lineNo: "asc" },
          select: {
            id: true,
            skuId: true,
            qty: true,
            batchNo: true,
            lineNo: true,
            destination: true,
            sku: {
              select: {
                variantType: true,
                colorName: true,
                product: { select: { id: true, name: true, unit: true } },
              },
            },
            originItem: {
              select: { id: true, lineNo: true, qty: true, returnedQty: true, batchNo: true },
            },
            returnInstances: {
              select: { id: true, code: true, status: true, batchId: true, outboundItemId: true },
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

  // ---------------- 仓位 ----------------

  /** 三个去向对应的仓位：主仓（可售）/ 次品区 / 报废区 */
  async locations() {
    const rows = await prisma.location.findMany({
      select: { id: true, name: true, type: true, isSellable: true },
      orderBy: [{ sortNo: "asc" }, { name: "asc" }],
    });
    return {
      good: rows.find((l) => l.type === "normal" && l.isSellable) ?? null,
      defective: rows.find((l) => l.type === "defective") ?? null,
      scrap: rows.find((l) => l.type === "scrap") ?? null,
    };
  },

  // ---------------- 原出库单 ----------------

  /** 搜索可退的原出库单：只找已生效的，草稿出库单货还没发，退不了 */
  searchOrigins(q: string, limit: number) {
    const term = q.trim();
    return prisma.document.findMany({
      where: {
        type: "outbound",
        status: "approved",
        ...(term
          ? {
              OR: [
                { docNo: { contains: term } },
                { externalNo: { contains: term } },
                { trackingNo: { contains: term } },
                { receiverName: { contains: term } },
                { items: { some: { sku: { product: { name: { contains: term } } } } } },
                // 地址在行上：按买家姓名、手机号、城市找那张出库单
                { items: { some: { receiverInfo: { contains: term } } } },
                { items: { some: { externalNo: { contains: term } } } },
              ],
            }
          : {}),
      },
      select: {
        ...originSelect,
        items: {
          select: {
            qty: true,
            returnedQty: true,
            receiverInfo: true,
            sku: { select: { colorName: true, product: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ bizDate: "desc" }, { createdAt: "desc" }],
      take: limit,
    });
  },

  /** 单张原出库单的可退明细 */
  findOrigin(id: string) {
    return prisma.document.findFirst({
      where: { id, type: "outbound", status: "approved" },
      select: {
        ...originSelect,
        items: {
          orderBy: { lineNo: "asc" },
          select: {
            id: true,
            lineNo: true,
            skuId: true,
            qty: true,
            returnedQty: true,
            batchNo: true,
            // 一单多地址以后，退货必须能按地址认出退的是哪个买家
            receiverInfo: true,
            externalNo: true,
            sku: {
              select: {
                colorName: true,
                variantType: true,
                product: { select: { name: true, unit: true } },
              },
            },
            /** 定制款：这一行发出去的单件（含已被别的退货草稿占用的） */
            outboundInstances: {
              select: {
                id: true,
                code: true,
                status: true,
                productionDate: true,
                returnItemId: true,
                returnDocumentId: true,
              },
              orderBy: { code: "asc" },
            },
          },
        },
      },
    });
  },

  /** 「已被哪张退货单占用 / 退到哪张单」——让仓管知道件去哪了，别以为系统丢货 */
  findReturnDocNosByIds(ids: string[]): Promise<{ id: string; docNo: string }[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return prisma.document.findMany({
      where: { id: { in: ids } },
      select: { id: true, docNo: true },
    });
  },

  /** 占用件的退货草稿单号（草稿还没生成流水，靠它提示「已被 TH-… 占用」） */
  findHolderDocNosByItemIds(itemIds: string[]): Promise<{ id: string; document: { docNo: string } }[]> {
    if (itemIds.length === 0) return Promise.resolve([]);
    return prisma.documentItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, document: { select: { docNo: true } } },
    });
  },

  // ---------------- 批次（良品回架要回原批次） ----------------

  findBatchByNo(skuId: string, batchNo: string, db: Db) {
    return db.batch.findUnique({
      where: { skuId_batchNo: { skuId, batchNo } },
      select: { id: true, batchNo: true, quantity: true },
    });
  },

  incrementBatch(id: string, qty: number, db: Db) {
    return db.batch.update({ where: { id }, data: { quantity: { increment: qty } } });
  },

  // ---------------- 单件（定制款） ----------------

  /**
   * 草稿阶段就把件挂到退货行上，和出库的锁定逻辑对称：
   * 这一件被这张退货草稿占了，别的草稿退不了它。删草稿靠外键 SetNull 自动释放。
   */
  lockInstancesToItem(instanceIds: string[], itemId: string, db: Db) {
    return db.itemInstance.updateMany({
      where: { id: { in: instanceIds }, returnItemId: null },
      data: { returnItemId: itemId },
    });
  },

  /** 审核：件落到目标仓位（次品区 / 报废区），并记下退到哪张单 */
  markInstancesReturned(
    instanceIds: string[],
    data: { status: string; locationId: string; documentId: string },
    db: Db,
  ) {
    return db.itemInstance.updateMany({
      where: { id: { in: instanceIds } },
      data: {
        status: data.status,
        locationId: data.locationId,
        returnDocumentId: data.documentId,
      },
    });
  },

  /** 详情页用：本单各行退回的件（草稿也有），不依赖流水 */
  listInstancesByItemIds(itemIds: string[]) {
    if (itemIds.length === 0) return Promise.resolve([]);
    return prisma.itemInstance.findMany({
      where: { returnItemId: { in: itemIds } },
      select: { id: true, code: true, returnItemId: true, status: true },
      orderBy: { code: "asc" },
    });
  },

  // ---------------- 流水 / 原行累计 ----------------

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

  /** 原出库行累加已退数量：这张单以后就不能再退超了 */
  incrementOriginReturned(itemId: string, qty: number, db: Db) {
    return db.documentItem.update({
      where: { id: itemId },
      data: { returnedQty: { increment: qty } },
    });
  },
};
