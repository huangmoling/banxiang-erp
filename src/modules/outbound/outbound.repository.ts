import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { formatCompactDate } from "@/lib/date";

type Db = Prisma.TransactionClient;

export const outboundItemSelect = {
  id: true,
  lineNo: true,
  skuId: true,
  qty: true,
  batchNo: true,
  remark: true,
  // 行级收货信息：一行一个包裹。留空时由服务层回退到单据上的整单地址
  receiverInfo: true,
  externalNo: true,
  trackingNo: true,
  shippedAt: true,
  shippedBy: { select: { displayName: true } },
  sku: {
    select: {
      colorName: true,
      variantType: true,
      product: { select: { id: true, name: true, unit: true } },
    },
  },
} satisfies Prisma.DocumentItemSelect;

export const outboundDocSelect = {
  id: true,
  docNo: true,
  status: true,
  bizDate: true,
  locationId: true,
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
  createdById: true,
  submittedAt: true,
  location: { select: { name: true } },
  createdBy: { select: { displayName: true } },
  approvedBy: { select: { displayName: true } },
  voidedBy: { select: { displayName: true } },
  submittedBy: { select: { displayName: true } },
  items: { orderBy: { lineNo: "asc" }, select: outboundItemSelect },
} satisfies Prisma.DocumentSelect;

export type OutboundDocRecord = Prisma.DocumentGetPayload<{ select: typeof outboundDocSelect }>;
export type OutboundItemRecord = OutboundDocRecord["items"][number];

export type CreateDocData = {
  docNo: string;
  type: string;
  status: string;
  bizDate: Date;
  locationId: string | null;
  externalNo: string | null;
  receiverName: string | null;
  trackingNo: string | null;
  remark: string | null;
  itemCount: number;
  totalQty: number;
  createdById: string | null;
};

export type CreateItemData = {
  skuId: string;
  lineNo: number;
  qty: number;
  batchNo: string | null;
  remark: string | null;
  /** 这一行自己的收货信息 / 订单号 / 物流单号（可空 = 沿用单据） */
  receiverInfo: string | null;
  externalNo: string | null;
  trackingNo: string | null;
};

export const outboundRepository = {
  findById(id: string): Promise<OutboundDocRecord | null> {
    return prisma.document.findFirst({
      where: { id, type: "outbound" },
      select: outboundDocSelect,
    });
  },

  async list(params: {
    q: string;
    status: "all" | "draft" | "approved" | "voided" | "pending";
    page: number;
    pageSize: number;
  }): Promise<{ items: OutboundDocRecord[]; total: number }> {
    const q = params.q.trim();
    const where: Prisma.DocumentWhereInput = {
      type: "outbound",
      // 草稿与待发货都是 status=draft，靠 submittedAt 分家：
      // 「草稿」= 自己开了一半没提交，「待发货」= 内勤已经交过来了
      ...(params.status === "pending"
        ? { status: "draft", submittedAt: { not: null } }
        : params.status === "draft"
          ? { status: "draft", submittedAt: null }
          : params.status !== "all"
            ? { status: params.status }
            : {}),
      ...(q
        ? {
            OR: [
              { docNo: { contains: q } },
              // 仓管最常按淘宝订单号、物流单号反查
              { externalNo: { contains: q } },
              { trackingNo: { contains: q } },
              { receiverName: { contains: q } },
              { remark: { contains: q } },
              { items: { some: { sku: { product: { name: { contains: q } } } } } },
              // 地址落到行上以后，按买家姓名 / 手机号 / 城市搜整单，只能走行级字段
              { items: { some: { receiverInfo: { contains: q } } } },
              { items: { some: { externalNo: { contains: q } } } },
              { items: { some: { trackingNo: { contains: q } } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.document.findMany({
        where,
        select: outboundDocSelect,
        // 待发货按提交时间正序：压得最久的排最前，别让老单烂在列表底下
        orderBy:
          params.status === "pending"
            ? [{ submittedAt: "asc" }, { createdAt: "asc" }]
            : [{ bizDate: "desc" }, { createdAt: "desc" }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      prisma.document.count({ where }),
    ]);

    return { items, total };
  },

  /**
   * 四个页签的计数。草稿与待发货互不重叠，加起来就是全部未审核的单。
   * 待发货另外给一个「未发行数」（= 包裹数）：一张单可能装几十个地址，
   * 只说「3 张单」会让人以为活儿很少。
   */
  async counts(): Promise<{
    draft: number;
    approved: number;
    pending: number;
    pendingPackages: number;
  }> {
    const [draft, approved, pending, pendingPackages] = await Promise.all([
      prisma.document.count({
        where: { type: "outbound", status: "draft", submittedAt: null },
      }),
      prisma.document.count({ where: { type: "outbound", status: "approved" } }),
      prisma.document.count({
        where: { type: "outbound", status: "draft", submittedAt: { not: null } },
      }),
      prisma.documentItem.count({
        where: {
          shippedAt: null,
          document: { type: "outbound", status: "draft", submittedAt: { not: null } },
        },
      }),
    ]);
    return { draft, approved, pending, pendingPackages };
  },

  /**
   * 仪表台与侧栏角标共用。
   * 一张单可能装几十个买家地址，所以「张数」已经不是工作量了——
   * 真正要跑几趟看的是**未发出的明细行数**，也就是包裹数。
   */
  async pendingSummary(since: Date): Promise<{
    total: number;
    packages: number;
    today: number;
    overdue: number;
    oldestAt: Date | null;
  }> {
    const docWhere: Prisma.DocumentWhereInput = {
      type: "outbound",
      status: "draft",
      submittedAt: { not: null },
    };
    // 只数还没发的行：已发的行货已经走了，不该再提示
    const itemWhere = (extra: Prisma.DocumentItemWhereInput = {}): Prisma.DocumentItemWhereInput => ({
      shippedAt: null,
      document: docWhere,
      ...extra,
    });

    const [total, packages, overdue, oldest] = await Promise.all([
      prisma.document.count({ where: docWhere }),
      prisma.documentItem.count({ where: itemWhere() }),
      prisma.documentItem.count({ where: itemWhere({ document: { ...docWhere, submittedAt: { lt: since } } }) }),
      prisma.document.findFirst({
        where: docWhere,
        orderBy: { submittedAt: "asc" },
        select: { submittedAt: true },
      }),
    ]);

    return {
      total,
      packages,
      today: packages - overdue,
      overdue,
      oldestAt: oldest?.submittedAt ?? null,
    };
  },

  /** 取当天最大单号 +1。用 max 而不是 count：中间删过草稿也不会把单号重复发出去 */
  async nextDocNo(bizDate: Date, db: Db): Promise<string> {
    const prefix = `CK-${formatCompactDate(bizDate)}-`;
    const last = await db.document.findFirst({
      where: { docNo: { startsWith: prefix } },
      select: { docNo: true },
      orderBy: { docNo: "desc" },
    });

    const lastSeq = last ? Number.parseInt(last.docNo.slice(prefix.length), 10) : 0;
    const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
    return `${prefix}${String(next).padStart(3, "0")}`;
  },

  /** 建单并回传每行的 id：选中的定制件要挂到对应行上 */
  createDoc(
    data: CreateDocData,
    items: CreateItemData[],
    db: Db,
  ): Promise<{ id: string; items: { id: string; lineNo: number }[] }> {
    return db.document.create({
      data: { ...data, items: { create: items } },
      select: { id: true, items: { select: { id: true, lineNo: true } } },
    });
  },

  /** 审核时读取：带规格（按件/按数量）、以及这一行已经锁定的定制件 */
  findForApprove(id: string, db: Db) {
    return db.document.findFirst({
      where: { id, type: "outbound" },
      select: {
        id: true,
        docNo: true,
        status: true,
        bizDate: true,
        locationId: true,
        // 内勤提交过没有：决定「隔天确认要不要改记账日」
        submittedAt: true,
        items: {
          orderBy: { lineNo: "asc" },
          select: {
            id: true,
            skuId: true,
            qty: true,
            batchNo: true,
            lineNo: true,
            // 已发过的行不再参与确认：部分发货的基础
            shippedAt: true,
            receiverInfo: true,
            sku: {
              select: {
                variantType: true,
                colorName: true,
                product: { select: { id: true, name: true, unit: true } },
              },
            },
            outboundInstances: {
              select: {
                id: true,
                code: true,
                status: true,
                batchId: true,
                locationId: true,
                stocktakeItemId: true,
                disposalItemId: true,
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

  /**
   * 按行确认发出：给选中的行盖时间戳。
   * 只认还没发的行（shippedAt: null），重复点确认不会把同一行扣两遍库存。
   */
  markItemsShipped(itemIds: string[], shippedById: string, at: Date, db: Db) {
    return db.documentItem.updateMany({
      where: { id: { in: itemIds }, shippedAt: null },
      data: { shippedAt: at, shippedById },
    });
  },

  /** 这张单还剩几行没发（0 = 全部发完，该结案了） */
  countUnshipped(documentId: string, db: Db): Promise<number> {
    return db.documentItem.count({ where: { documentId, shippedAt: null } });
  },

  /**
   * 删掉一行（只允许删还没发的行，服务层已校验）。
   * 删完要重算单据上的行数与件数，否则列表显示会对不上。
   */
  deleteItem(itemId: string, db: Db) {
    return db.documentItem.delete({ where: { id: itemId } });
  },

  /** 删行后按真实剩余行重算冗余字段（行数、总件数），不靠前端传 */
  async recountItems(documentId: string, db: Db): Promise<{ itemCount: number; totalQty: number }> {
    const agg = await db.documentItem.aggregate({
      where: { documentId },
      _count: { _all: true },
      _sum: { qty: true },
    });
    const itemCount = agg._count._all;
    const totalQty = agg._sum.qty ?? 0;
    await db.document.update({ where: { id: documentId }, data: { itemCount, totalQty } });
    return { itemCount, totalQty };
  },

  /**
   * 改某一行的收货信息 / 订单号 / 物流单号。
   * 只碰这三样，数量与商品一律不动——那动了就要重算库存与批次。
   */
  updateItemInfo(
    itemId: string,
    data: { receiverInfo: string | null; externalNo: string | null; trackingNo: string | null },
    db: Db | typeof prisma,
  ) {
    return db.documentItem.update({ where: { id: itemId }, data });
  },

  /** 单独读一行：校验它确实属于这张单、且还没发 */
  findItem(documentId: string, itemId: string, db: Db | typeof prisma) {
    return db.documentItem.findFirst({
      where: { id: itemId, documentId },
      select: {
        id: true,
        lineNo: true,
        qty: true,
        shippedAt: true,
        receiverInfo: true,
        externalNo: true,
        trackingNo: true,
        document: { select: { id: true, docNo: true, status: true, type: true, submittedAt: true } },
      },
    });
  },

  /** 内勤提交发货工单：只打时间戳，状态仍是 draft，库存一点不动 */
  markSubmitted(id: string, submittedById: string, db: Db) {
    return db.document.update({
      where: { id },
      data: { submittedAt: new Date(), submittedById },
    });
  },

  /**
   * 改收货信息这类「不动货」的字段。
   * 只认 draft：已生效的单据要改只能红冲，不允许在这里偷偷改。
   */
  updateInfo(
    id: string,
    data: {
      receiverName: string | null;
      trackingNo: string | null;
      externalNo: string | null;
      remark: string | null;
    },
    db: Db | typeof prisma,
  ) {
    return db.document.update({ where: { id }, data });
  },

  /** 隔天确认时把记账日改到真实发货那天 */
  updateBizDate(id: string, bizDate: Date, db: Db) {
    return db.document.update({ where: { id }, data: { bizDate } });
  },

  /** 只允许删除草稿：已生效的单据必须走红冲，原始记录永久保留 */
  deleteDraft(id: string, db: Db): Promise<unknown> {
    return db.document.delete({ where: { id } });
  },

  listSellableLocations(): Promise<{ id: string; name: string }[]> {
    return prisma.location.findMany({
      where: { type: "normal", isSellable: true },
      select: { id: true, name: true },
      orderBy: [{ sortNo: "asc" }, { name: "asc" }],
    });
  },

  // ---------------- 批次（常规款） ----------------

  /** 有剩余的批次，按生产日期先后（自动出库就按这个顺序扣，先产的先走） */
  listBatchesWithStock(skuId: string, db: Db) {
    return db.batch.findMany({
      where: { skuId, quantity: { gt: 0 } },
      select: { id: true, batchNo: true, quantity: true, productionDate: true },
      orderBy: [{ productionDate: "asc" }, { createdAt: "asc" }],
    });
  },

  findBatchByNo(skuId: string, batchNo: string, db: Db) {
    return db.batch.findUnique({
      where: { skuId_batchNo: { skuId, batchNo } },
      select: { id: true, batchNo: true, quantity: true },
    });
  },

  decrementBatch(id: string, qty: number, db: Db) {
    return db.batch.update({ where: { id }, data: { quantity: { decrement: qty } } });
  },

  /**
   * 把实际扣减的批次写回明细行。
   * 流水才是权威账，这里只是让单据详情能直接显示「这行扣的是哪批」，
   * 一行跨多个批次时用逗号拼起来。
   */
  updateItemBatchNo(itemId: string, batchNo: string, db: Db) {
    return db.documentItem.update({ where: { id: itemId }, data: { batchNo } });
  },

  // ---------------- 单件（定制款） ----------------

  /** 事务内读取待出库的单件，校验是否还在库、是否已被别的单锁定 */
  findInstancesByIds(ids: string[], db: Db) {
    if (ids.length === 0) return Promise.resolve([]);
    return db.itemInstance.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        code: true,
        skuId: true,
        status: true,
        locationId: true,
        batchId: true,
        outboundItemId: true,
      },
    });
  },

  /** 草稿阶段就把件挂到行上：这件货被这张单占了，别的单选不到它 */
  lockInstancesToItem(instanceIds: string[], itemId: string, db: Db) {
    return db.itemInstance.updateMany({
      // 已被盘点草稿判为盘亏、或已被处置草稿选中的件都要排除：
      // 一边说这件丢了 / 已经报废，一边又把它发出去，账就废了
      where: {
        id: { in: instanceIds },
        outboundItemId: null,
        stocktakeItemId: null,
        disposalItemId: null,
      },
      data: { outboundItemId: itemId },
    });
  },

  markInstancesOutbound(instanceIds: string[], documentId: string, db: Db) {
    return db.itemInstance.updateMany({
      where: { id: { in: instanceIds } },
      data: { status: "outbound", locationId: null, outboundDocumentId: documentId },
    });
  },

  /** 详情页用：本单各行锁定的件（草稿也有），不依赖流水 */
  listInstancesByItemIds(itemIds: string[]) {
    if (itemIds.length === 0) return Promise.resolve([]);
    return prisma.itemInstance.findMany({
      where: { outboundItemId: { in: itemIds } },
      select: { id: true, code: true, outboundItemId: true, status: true },
      orderBy: { code: "asc" },
    });
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

  /** 单据生效后刷新商品「近 90 天使用次数」，让常发的款在选品搜索里排前面 */
  async touchProducts(productIds: string[], db: Db): Promise<void> {
    for (const id of productIds) {
      await db.product.update({
        where: { id },
        data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
      });
    }
  },

  // ---------------- 可出库明细（批次 + 在库件） ----------------

  async availabilityData(skuIds: string[]) {
    if (skuIds.length === 0) {
      return { batches: [], instances: [], holders: [] };
    }

    const [batches, instances] = await Promise.all([
      prisma.batch.findMany({
        where: { skuId: { in: skuIds }, quantity: { gt: 0 } },
        select: { skuId: true, batchNo: true, quantity: true, productionDate: true },
        orderBy: [{ productionDate: "asc" }, { createdAt: "asc" }],
      }),
      prisma.itemInstance.findMany({
        // 被盘点草稿判为盘亏、或被处置草稿选中的件不再出现在可选清单里
        where: {
          skuId: { in: skuIds },
          status: "in_stock",
          stocktakeItemId: null,
          disposalItemId: null,
        },
        select: {
          id: true,
          code: true,
          skuId: true,
          productionDate: true,
          inboundDocumentId: true,
          outboundItemId: true,
        },
        orderBy: { code: "asc" },
      }),
    ]);

    // 已在草稿里被占用的件，要告诉仓管「它被哪张单拿去了」，否则会以为系统丢货
    const holderItemIds = [
      ...new Set(instances.map((i) => i.outboundItemId).filter((v): v is string => !!v)),
    ];
    const holders = holderItemIds.length
      ? await prisma.documentItem.findMany({
          where: { id: { in: holderItemIds } },
          select: { id: true, document: { select: { docNo: true, status: true } } },
        })
      : [];

    return { batches, instances, holders };
  },

  /** 来源入库单号（单件列表里显示，方便对着纸单找货） */
  findDocNosByIds(ids: string[]): Promise<{ id: string; docNo: string }[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return prisma.document.findMany({
      where: { id: { in: ids } },
      select: { id: true, docNo: true },
    });
  },
};
