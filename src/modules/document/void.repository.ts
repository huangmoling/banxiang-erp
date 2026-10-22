import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * 红冲仓储层。
 *
 * 红冲不是「改数字」，而是给原单补一套反向流水：
 * 库存是流水求和得来的，反向流水一进来，账自然就退回去了，
 * 原始记录一条都不删、不改，事后随时能看出「哪天冲的、冲的哪张单」。
 *
 * 这里刻意不依赖各单据模块自己的 repository：
 * 红冲要跨四种单据操作，共用一份查询比四处拼装可靠。
 */

export type Db = Prisma.TransactionClient;

/** 单据里的一件货（定制款）当前长什么样 */
export type InstanceRow = {
  id: string;
  code: string;
  status: string;
  locationId: string | null;
  outboundItemId: string | null;
  stocktakeItemId: string | null;
  disposalItemId: string | null;
  returnItemId: string | null;
};

export const voidRepository = {
  /** 取一张单据的完整现场：明细、仓位、原始流水（不含上次红冲留下的反向流水） */
  findForVoid(id: string, db: Db) {
    return db.document.findUnique({
      where: { id },
      include: {
        location: { select: { id: true, name: true, type: true, isSellable: true } },
        items: {
          orderBy: { lineNo: "asc" },
          include: {
            sku: {
              select: {
                id: true,
                colorName: true,
                variantType: true,
                product: { select: { name: true, unit: true } },
              },
            },
          },
        },
        movements: {
          // 关键：排除红冲流水，否则冲第二次会把上一次的反向也一起冲掉
          where: { reversal: false },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  },

  /** 某 SKU 在某仓位的当前结存（事务内求和，拿到的是最新账） */
  async qtyAt(skuId: string, locationId: string, db: Db): Promise<number> {
    const agg = await db.stockMovement.aggregate({
      where: { skuId, locationId },
      _sum: { qtyDelta: true },
    });
    return agg._sum.qtyDelta ?? 0;
  },

  /** 一张出库单有没有已经退过货：退过就不许冲，否则退货行会挂在一张作废单上 */
  async returnCountOf(originDocumentId: string, db: Db): Promise<number> {
    return db.document.count({
      where: {
        type: "return",
        status: { not: "voided" },
        originDocumentId,
      },
    });
  },

  /** 这张单据上的件（定制款）：入库来源行 / 出库去向行 / 退货去向行 / 处置去向行 */
  instancesOfDocument(documentId: string, db: Db): Promise<InstanceRow[]> {
    return db.itemInstance.findMany({
      where: {
        OR: [
          { inboundDocumentId: documentId },
          { outboundDocumentId: documentId },
          { returnDocumentId: documentId },
          { disposalItem: { documentId } },
        ],
      },
      select: {
        id: true,
        code: true,
        status: true,
        locationId: true,
        outboundItemId: true,
        stocktakeItemId: true,
        disposalItemId: true,
        returnItemId: true,
      },
    });
  },

  /** 按明细行取件（入库行用它自己的 documentItemId 挂件，比按单据查更准） */
  instancesOfItem(documentItemId: string, db: Db): Promise<InstanceRow[]> {
    return db.itemInstance.findMany({
      where: { documentItemId },
      select: {
        id: true,
        code: true,
        status: true,
        locationId: true,
        outboundItemId: true,
        stocktakeItemId: true,
        disposalItemId: true,
        returnItemId: true,
      },
      orderBy: { code: "asc" },
    });
  },

  /**
   * 入库行上的件。
   * 早期版本的件只记了 inboundDocumentId，没挂明细行 id（历史数据还在），
   * 所以这里用「明细行 OR (单据 + SKU)」两路兜住——
   * 只认 documentItemId 会把老数据当成「一件都没找到」，红冲直接卡死。
   */
  instancesOfInboundItem(
    documentId: string,
    documentItemId: string,
    skuId: string,
    db: Db,
  ): Promise<InstanceRow[]> {
    return db.itemInstance.findMany({
      where: {
        OR: [{ documentItemId }, { inboundDocumentId: documentId, skuId }],
      },
      select: {
        id: true,
        code: true,
        status: true,
        locationId: true,
        outboundItemId: true,
        stocktakeItemId: true,
        disposalItemId: true,
        returnItemId: true,
      },
      orderBy: { code: "asc" },
    });
  },

  batchByNo(skuId: string, batchNo: string, db: Db) {
    return db.batch.findUnique({
      where: { skuId_batchNo: { skuId, batchNo } },
      select: { id: true, batchNo: true, quantity: true },
    });
  },

  /** 批次余量增减（可正可负，负向由调用方先校验够不够扣） */
  addBatchQty(batchId: string, delta: number, db: Db) {
    return db.batch.update({
      where: { id: batchId },
      data: { quantity: { increment: delta } },
      select: { id: true, batchNo: true, quantity: true },
    });
  },

  /** 把件改到某个状态；locationId 传 null 表示离开仓位 */
  setInstanceState(
    ids: string[],
    data: {
      status: string;
      locationId: string | null;
      outboundItemId?: string | null;
      returnItemId?: string | null;
      disposalItemId?: string | null;
    },
    db: Db,
  ) {
    if (ids.length === 0) return Promise.resolve({ count: 0 });
    return db.itemInstance.updateMany({ where: { id: { in: ids } }, data });
  },

  /** 单件一条流水：数量恒为 ±1，带上件号才追得回是哪一件 */
  createMovement(
    data: {
      skuId: string;
      locationId: string;
      qtyDelta: number;
      bizType: string;
      documentId: string;
      documentItemId: string | null;
      batchId: string | null;
      itemInstanceId?: string | null;
      occurredAt: Date;
      createdById: string;
      note: string;
    },
    db: Db,
  ) {
    return db.stockMovement.create({ data: { ...data, reversal: true } });
  },

  /** 退货红冲要把原出库行的「已退数量」退回去，否则这单永远退不了第二次 */
  reduceReturnedQty(originItemId: string, qty: number, db: Db) {
    return db.documentItem.update({
      where: { id: originItemId },
      data: { returnedQty: { decrement: qty } },
      select: { id: true, returnedQty: true },
    });
  },

  markVoided(id: string, userId: string, reason: string, db: Db) {
    return db.document.update({
      where: { id },
      data: {
        status: "voided",
        voidedAt: new Date(),
        voidedById: userId,
        voidReason: reason,
      },
      select: { id: true, docNo: true },
    });
  },
};

export type VoidRepository = typeof voidRepository;

/** 直接查库（不带事务）的场景，例如详情页判断按钮是否可点 */
export function voidDb() {
  return prisma;
}
