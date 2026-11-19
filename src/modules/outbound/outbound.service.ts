import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatDateOnly, parseDateOnly, startOfToday, todayDateOnly } from "@/lib/date";
import { stockRepository } from "@/modules/inventory/stock.repository";
import { outboundRepository, type OutboundDocRecord } from "./outbound.repository";
import type {
  CreateOutboundInput,
  ListOutboundQuery,
  UpdateOutboundInfoInput,
  UpdateOutboundItemInput,
} from "./outbound.schema";
import type {
  AvailabilityResult,
  OutboundDocView,
  OutboundItemView,
  OutboundListResult,
  OutboundMeta,
  PendingShipSummary,
} from "./outbound.types";

const UNIT_FALLBACK = "件";

const INSTANCE_STATUS_LABEL: Record<string, string> = {
  in_stock: "在库",
  outbound: "已出库",
  returned: "退回待检",
  defective: "次品区",
  scrapped: "已报废",
  sold_offline: "已线下售出",
  disposed: "已处置",
};

function instanceStatusLabel(status: string): string {
  return INSTANCE_STATUS_LABEL[status] ?? status;
}

/** 「第 2 行「云栖沙发 · 米白」」——报错时要让人一眼找到是哪一行 */
function lineLabel(item: {
  lineNo: number;
  sku: { colorName: string | null; product: { name: string } };
}): string {
  const color = item.sku.colorName?.trim();
  return `第 ${item.lineNo} 行「${item.sku.product.name}${color ? ` · ${color}` : ""}」`;
}

/**
 * 提交工单前的「缺货体检」：只出提醒，绝不拦。
 * 定制件的工期长是常态，货还在做就把单子先攒起来才对；
 * 真正的硬拦截在仓管点确认那一刻（approveInTx 里那段库存校验），不用重复写。
 */
async function shortageWarningsOf(doc: OutboundDocRecord): Promise<string[]> {
  const need = new Map<string, number>();
  for (const item of doc.items) {
    need.set(item.skuId, (need.get(item.skuId) ?? 0) + item.qty);
  }
  if (need.size === 0) return [];

  const stockMap = await stockRepository.stockBySkuIds([...need.keys()]);
  const warnings: string[] = [];
  for (const [skuId, qty] of need) {
    const have = stockMap.get(skuId) ?? 0;
    if (qty > have) {
      const line = doc.items.find((i) => i.skuId === skuId)!;
      const unit = line.sku.product.unit || UNIT_FALLBACK;
      warnings.push(`${lineLabel(line)} 现在只有 ${have} ${unit}，本单要 ${qty} ${unit}`);
    }
  }
  return warnings;
}

/**
 * 行级字段留空时回退到单据上的整单地址。
 * 老单据（地址只存在单据上）因此不用迁移就能原样显示、原样打印。
 */
function resolveLine(item: OutboundDocRecord["items"][number], doc: OutboundDocRecord) {
  const own = item.receiverInfo?.trim();
  return {
    receiverInfo: own || doc.receiverName?.trim() || null,
    receiverInherited: !own && !!doc.receiverName?.trim(),
    externalNo: item.externalNo?.trim() || doc.externalNo?.trim() || null,
    trackingNo: item.trackingNo?.trim() || doc.trackingNo?.trim() || null,
  };
}

/**
 * 交单之前逐行体检地址：一个包裹没地址，仓管拿着单也发不出去。
 * 只拦「提交/立即发货」，普通草稿随便存——录到一半出去接个电话是常事。
 */
function assertReceiverComplete(
  items: { receiverInfo?: string | null }[],
  docReceiver: string | null,
): void {
  const fallback = docReceiver?.trim();
  if (fallback) return; // 有整单地址兜底，行级不填也没关系

  const missing: number[] = [];
  items.forEach((item, index) => {
    if (!item.receiverInfo?.trim()) missing.push(index + 1);
  });
  if (missing.length === 0) return;

  const shown = missing.slice(0, 6).join("、");
  const more = missing.length > 6 ? ` 等 ${missing.length} 行` : "";
  throw new ValidationError(
    `第 ${shown}${more} 行还没有填收货信息。一行就是一个包裹，没有地址仓管发不出去`,
  );
}

function toItemView(
  item: OutboundDocRecord["items"][number],
  doc: OutboundDocRecord,
  codes: string[],
): OutboundItemView {
  const line = resolveLine(item, doc);
  return {
    id: item.id,
    lineNo: item.lineNo,
    skuId: item.skuId,
    productId: item.sku.product.id,
    productName: item.sku.product.name,
    unit: item.sku.product.unit,
    colorName: item.sku.colorName,
    variantType: item.sku.variantType === "custom" ? "custom" : "normal",
    qty: item.qty,
    batchNo: item.batchNo,
    instanceCodes: codes,
    remark: item.remark,
    receiverInfo: line.receiverInfo,
    receiverInherited: line.receiverInherited,
    externalNo: line.externalNo,
    trackingNo: line.trackingNo,
    shippedAt: item.shippedAt ? item.shippedAt.toISOString() : null,
    shippedByName: item.shippedBy?.displayName ?? null,
    // 已作废（红冲）的单按「全部已发」呈现：货当初确实走了、之后又被冲回来，
    // 单据本身已经无效，不该再留一个点了必然 409 的「确认发出」按钮。
    shipped: doc.status === "voided" || item.shippedAt !== null,
  };
}

/** 列表摘要：把明细压成一行「产品·颜色 ×数量」 */
function buildPreview(doc: OutboundDocRecord): string {
  const parts = doc.items.slice(0, 3).map((item) => {
    const color = item.sku.colorName?.trim();
    return `${item.sku.product.name}${color ? ` · ${color}` : ""} ×${item.qty}`;
  });
  const more = doc.items.length > 3 ? ` 等 ${doc.items.length} 项` : "";
  return parts.join("、") + more;
}

/** 提交到今天隔了几个自然日（0 = 今天提交）。按日历日算，不按 24 小时算 */
function waitedDaysOf(submittedAt: Date | null): number | null {
  if (!submittedAt) return null;
  const a = Date.UTC(submittedAt.getFullYear(), submittedAt.getMonth(), submittedAt.getDate());
  const t = startOfToday();
  const b = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.max(0, Math.round((b - a) / 86400000));
}

function toView(doc: OutboundDocRecord, codesByItem?: Map<string, string[]>): OutboundDocView {
  const status = doc.status === "approved" ? "approved" : doc.status === "voided" ? "voided" : "draft";
  const submittedAt = doc.submittedAt ?? null;
  const shippedCount =
    status === "voided"
      ? doc.items.length
      : doc.items.filter((i) => i.shippedAt !== null).length;

  return {
    id: doc.id,
    docNo: doc.docNo,
    status,
    bizDate: formatDateOnly(doc.bizDate),
    locationId: doc.locationId,
    locationName: doc.location?.name ?? null,
    externalNo: doc.externalNo,
    receiverName: doc.receiverName,
    trackingNo: doc.trackingNo,
    remark: doc.remark,
    itemCount: doc.itemCount,
    totalQty: doc.totalQty,
    shippedCount,
    pendingCount: doc.items.length - shippedCount,
    // 有行发出去过 = 这张单不能删（删了流水跟着走，库存会凭空回来）
    hasShipped: shippedCount > 0,
    allShipped: doc.items.length > 0 && shippedCount === doc.items.length,
    createdByName: doc.createdBy?.displayName ?? null,
    approvedByName: doc.approvedBy?.displayName ?? null,
    approvedAt: doc.approvedAt ? doc.approvedAt.toISOString() : null,
    voidedAt: doc.voidedAt ? doc.voidedAt.toISOString() : null,
    voidReason: doc.voidReason,
    voidedByName: doc.voidedBy?.displayName ?? null,
    createdAt: doc.createdAt.toISOString(),
    submittedAt: submittedAt ? submittedAt.toISOString() : null,
    submittedByName: doc.submittedBy?.displayName ?? null,
    // 待发货 = 内勤交了、还有行没发出去。全部发完就不是待办了
    pendingShip: status === "draft" && submittedAt !== null && shippedCount < doc.items.length,
    waitedDays: waitedDaysOf(submittedAt),
    preview: buildPreview(doc),
    items: doc.items.map((item) => toItemView(item, doc, codesByItem?.get(item.id) ?? [])),
  };
}

export const outboundService = {
  async list(query: ListOutboundQuery): Promise<OutboundListResult> {
    const [{ items, total }, counts] = await Promise.all([
      outboundRepository.list(query),
      outboundRepository.counts(),
    ]);

    return {
      items: items.map((doc) => toView(doc)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      counts,
    };
  },

  async detail(id: string): Promise<OutboundDocView> {
    const doc = await outboundRepository.findById(id);
    if (!doc) throw new NotFoundError("找不到这张出库单");

    // 定案件的编号按「锁定在哪一行」反查：草稿阶段就能显示，不必等审核
    const rows = await outboundRepository.listInstancesByItemIds(doc.items.map((i) => i.id));
    const codesByItem = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.outboundItemId) continue;
      const list = codesByItem.get(row.outboundItemId) ?? [];
      list.push(row.code);
      codesByItem.set(row.outboundItemId, list);
    }

    return toView(doc, codesByItem);
  },

  async meta(): Promise<OutboundMeta> {
    return {
      locations: await outboundRepository.listSellableLocations(),
      today: todayDateOnly(),
    };
  },

  /**
   * 某个 SKU 能出什么：常规款看批次余量，定制款看具体在库件。
   * 前端加一行就查一次，数量很少，不做缓存。
   */
  async availability(skuIds: string[]): Promise<AvailabilityResult> {
    const [data, stockMap] = await Promise.all([
      outboundRepository.availabilityData(skuIds),
      stockRepository.stockBySkuIds(skuIds),
    ]);

    const inboundIds = [
      ...new Set(data.instances.map((i) => i.inboundDocumentId).filter((v): v is string => !!v)),
    ];
    const docNoMap = new Map(
      (await outboundRepository.findDocNosByIds(inboundIds)).map((d) => [d.id, d.docNo]),
    );
    const holderMap = new Map(data.holders.map((h) => [h.id, h.document.docNo]));

    const result: AvailabilityResult = {};
    for (const skuId of skuIds) {
      result[skuId] = {
        skuId,
        stock: stockMap.get(skuId) ?? 0,
        batches: data.batches
          .filter((b) => b.skuId === skuId)
          .map((b) => ({
            batchNo: b.batchNo,
            productionDate: b.productionDate ? formatDateOnly(b.productionDate) : null,
            qty: b.quantity,
          })),
        instances: data.instances
          .filter((i) => i.skuId === skuId)
          .map((i) => ({
            id: i.id,
            code: i.code,
            productionDate: i.productionDate ? formatDateOnly(i.productionDate) : null,
            inboundDocNo: i.inboundDocumentId ? (docNoMap.get(i.inboundDocumentId) ?? null) : null,
            reservedBy: i.outboundItemId ? (holderMap.get(i.outboundItemId) ?? "另一张草稿") : null,
          })),
      };
    }

    return result;
  },

  /**
   * 建单。approveNow=true 时在同一事务里审核生效。
   * 草稿阶段就把定制件锁到行上——这件货被这张单占了，别的单选不到，避免两张单抢同一件。
   *
   * 内勤（clerk）在这里被强制降级成「只存草稿」：
   * 「提交」与「确认发货」必须是两个人，这是整条工单流程唯一的复核点。
   * 只在前端藏按钮不算数——请求是可以手写的，所以拦在这一层。
   */
  async create(
    input: CreateOutboundInput,
    actor: { userId: string; role: string },
  ): Promise<OutboundDocView> {
    const bizDate = input.bizDate ? parseDateOnly(input.bizDate) : startOfToday();
    if (!bizDate) throw new ValidationError("业务日期格式有误");

    const isClerk = actor.role === "clerk";

    const locations = await outboundRepository.listSellableLocations();
    if (locations.length === 0) throw new ValidationError("还没有可用仓位，请先初始化主仓");

    const locationId = input.locationId?.trim() || locations[0]!.id;
    if (!locations.some((l) => l.id === locationId)) {
      throw new ValidationError("只能从主仓这类常规仓位发货，次品区与报废区不走销售出库");
    }

    const skuIds = [...new Set(input.items.map((i) => i.skuId))];
    const skus = await prisma.sku.findMany({
      where: { id: { in: skuIds }, isActive: true },
      select: {
        id: true,
        variantType: true,
        colorName: true,
        product: { select: { name: true, isActive: true } },
      },
    });
    const skuMap = new Map(skus.map((s) => [s.id, s]));

    for (const [index, item] of input.items.entries()) {
      const sku = skuMap.get(item.skuId);
      if (!sku || !sku.product.isActive) {
        throw new ValidationError(`第 ${index + 1} 行的商品已被删除或停用，请重新选择`);
      }

      const picked = item.instanceIds ?? [];
      if (sku.variantType === "custom" && picked.length === 0) {
        throw new ValidationError(
          `第 ${index + 1} 行是定制款，要选定具体哪一件才能出库（定制件按件管理，不做批量扣数）`,
        );
      }
      if (sku.variantType !== "custom" && picked.length > 0) {
        throw new ValidationError(`第 ${index + 1} 行是常规款，按数量出库即可，不用选单件`);
      }
    }

    // 选中的件必须真的还在库、属于这个颜色、没被别的单占走
    const allInstanceIds = input.items.flatMap((i) => i.instanceIds ?? []);
    if (allInstanceIds.length > 0) {
      const found = await prisma.itemInstance.findMany({
        where: { id: { in: allInstanceIds } },
        select: {
          id: true,
          code: true,
          skuId: true,
          status: true,
          outboundItemId: true,
          stocktakeItemId: true,
          disposalItemId: true,
        },
      });
      const instanceMap = new Map(found.map((f) => [f.id, f]));

      for (const [index, item] of input.items.entries()) {
        for (const instanceId of item.instanceIds ?? []) {
          const inst = instanceMap.get(instanceId);
          const lineNo = index + 1;

          if (!inst) {
            throw new ValidationError(`第 ${lineNo} 行选的件不存在，可能已被删除，请重新选`);
          }
          if (inst.skuId !== item.skuId) {
            throw new ValidationError(`第 ${lineNo} 行选的件不属于这个颜色，请重新选`);
          }
          if (inst.status !== "in_stock") {
            throw new ConflictError(
              `第 ${lineNo} 行的 ${inst.code} 已经不在库（${instanceStatusLabel(inst.status)}），请重新选`,
            );
          }
          if (inst.outboundItemId) {
            throw new ConflictError(`第 ${lineNo} 行的 ${inst.code} 已被另一张草稿占用，请刷新后重选`);
          }
          if (inst.stocktakeItemId) {
            throw new ConflictError(
              `第 ${lineNo} 行的 ${inst.code} 已经被一张盘点单判为盘亏，不能出库。先处理那张盘点单`,
            );
          }
          if (inst.disposalItemId) {
            throw new ConflictError(
              `第 ${lineNo} 行的 ${inst.code} 已经被一张报废/处置草稿选中，不能出库。先处理那张单`,
            );
          }
        }
      }
    }

    const totalQty = input.items.reduce((sum, i) => sum + i.qty, 0);

    const created = await prisma.$transaction(async (tx) => {
      const docNo = await outboundRepository.nextDocNo(bizDate, tx);

      const { id, items: createdItems } = await outboundRepository.createDoc(
        {
          docNo,
          type: "outbound",
          status: "draft",
          bizDate,
          locationId,
          externalNo: input.externalNo?.trim() || null,
          receiverName: input.receiverName?.trim() || null,
          trackingNo: input.trackingNo?.trim() || null,
          remark: input.remark?.trim() || null,
          itemCount: input.items.length,
          totalQty,
          createdById: actor.userId,
        },
        input.items.map((item, index) => ({
          skuId: item.skuId,
          lineNo: index + 1,
          qty: item.qty,
          batchNo: item.batchNo?.trim() || null,
          remark: item.remark?.trim() || null,
          // 行级收货信息：一行一个包裹。留空就沿用单据上的整单地址
          receiverInfo: item.receiverInfo?.trim() || null,
          externalNo: item.externalNo?.trim() || null,
          trackingNo: item.trackingNo?.trim() || null,
        })),
        tx,
      );

      const itemIdByLine = new Map(createdItems.map((i) => [i.lineNo, i.id]));

      for (const [index, item] of input.items.entries()) {
        const picked = item.instanceIds ?? [];
        if (picked.length === 0) continue;

        const itemId = itemIdByLine.get(index + 1);
        if (!itemId) continue;

        const locked = await outboundRepository.lockInstancesToItem(picked, itemId, tx);
        // 条件更新兜住并发：刚查完还在，并不代表写的时候还在
        if (locked.count !== picked.length) {
          throw new ConflictError("有一件货刚被别的单拿走，请刷新后重选");
        }
      }

      // 内勤不管前端传什么过来，一律按「只存草稿」处理
      const approveNow = input.approveNow && !isClerk;
      const submitNow = input.submitAfterSave || isClerk;

      // 交出去之前每个包裹都得有地址，否则仓管拿着单发不出去
      if (approveNow || submitNow) {
        assertReceiverComplete(input.items, input.receiverName ?? null);
      }

      if (approveNow) {
        await shipItemsInTx(tx, id, null, actor.userId);
      } else if (submitNow) {
        // 内勤建完就直接进待发货，不留在自己手里当草稿——
        // 「存了忘了交」的孤儿单在仓库那边等于不存在，比什么都糟
        await outboundRepository.markSubmitted(id, actor.userId, tx);
        await writeAudit(
          actor.userId,
          "outbound.submit",
          id,
          `提交发货工单「${docNo}」，${totalQty} ${UNIT_FALLBACK}待仓管确认`,
          tx,
        );
      }

      return id;
    });

    return outboundService.detail(created);
  },

  /**
   * 内勤提交发货工单：草稿 → 待发货。
   * 这一步不动库存、不动批次、不碰定制件——只是把单子交出去，让仓库那边看得见。
   * 顺手做一次缺货体检：只提醒、不拦。货还在路上就先攒着单子，是常态。
   */
  async submit(
    id: string,
    actor: { userId: string; role: string },
  ): Promise<{ doc: OutboundDocView; warnings: string[] }> {
    const doc = await outboundRepository.findById(id);
    if (!doc) throw new NotFoundError("找不到这张出库单");
    if (doc.status === "approved") throw new ConflictError("这张单已经发过货了，不用再提交");
    if (doc.status === "voided") throw new ConflictError("这张单已作废，不能提交");

    // 已经交过就当他成功：手指抖两下、网络重试一次都很常见，弹个红字反而让人以为没交上
    if (doc.submittedAt) {
      return { doc: await outboundService.detail(id), warnings: [] };
    }

    if (actor.role === "clerk" && doc.createdById && doc.createdById !== actor.userId) {
      throw new ForbiddenError("这单是别人整理的，内勤只能提交自己开的单");
    }

    // 交给仓库之前把地址补齐：一行一个包裹，没地址的仓管发不出去
    const missing = doc.items
      .filter((i) => !(i.receiverInfo?.trim() || doc.receiverName?.trim()))
      .map((i) => i.lineNo);
    if (missing.length > 0) {
      const shown = missing.slice(0, 6).join("、");
      const more = missing.length > 6 ? ` 等 ${missing.length} 行` : "";
      throw new ValidationError(
        `第 ${shown}${more} 行还没有填收货信息，补齐再提交——仓管是照单发货的`,
      );
    }

    const warnings = await shortageWarningsOf(doc);

    await prisma.$transaction(async (tx) => {
      await outboundRepository.markSubmitted(id, actor.userId, tx);
      await writeAudit(
        actor.userId,
        "outbound.submit",
        id,
        `提交发货工单「${doc.docNo}」，共 ${doc.totalQty} ${UNIT_FALLBACK}，等仓管确认`,
        tx,
      );
    });

    return { doc: await outboundService.detail(id), warnings };
  },

  /** 仪表台横幅与侧栏角标：还有多少个包裹没发（张数、包裹数一起给） */
  async pendingSummary(): Promise<PendingShipSummary> {
    const row = await outboundRepository.pendingSummary(startOfToday());
    return {
      total: row.total,
      packages: row.packages,
      today: row.today,
      overdue: row.overdue,
      oldestAt: row.oldestAt ? row.oldestAt.toISOString() : null,
    };
  },

  /**
   * 改收货信息 / 物流单号 / 订单号 / 备注。
   * 商品明细不在这里改——那些一动就影响库存，只能删单重开。
   * 已生效的单据也不许改：要更正就走红冲，账不能悄悄被抹平。
   */
  async updateInfo(
    id: string,
    input: UpdateOutboundInfoInput,
    actor: { userId: string; role: string },
  ): Promise<OutboundDocView> {
    const doc = await outboundRepository.findById(id);
    if (!doc) throw new NotFoundError("找不到这张出库单");
    if (doc.status === "approved") {
      throw new ConflictError("这张单已经发货了，收货信息不能再改。要更正请让管理员红冲后重开");
    }
    if (doc.status === "voided") throw new ConflictError("这张单已作废，不能再改");
    if (actor.role === "clerk" && doc.createdById && doc.createdById !== actor.userId) {
      throw new ForbiddenError("这单是别人整理的，内勤只能改自己开的单");
    }

    // 没传的字段保持原值，别把人家填好的地址一键清空
    const next = {
      receiverName: input.receiverName === undefined ? doc.receiverName : input.receiverName?.trim() || null,
      trackingNo: input.trackingNo === undefined ? doc.trackingNo : input.trackingNo?.trim() || null,
      externalNo: input.externalNo === undefined ? doc.externalNo : input.externalNo?.trim() || null,
      remark: input.remark === undefined ? doc.remark : input.remark?.trim() || null,
    };

    await outboundRepository.updateInfo(id, next, prisma);
    await writeAudit(actor.userId, "outbound.updateInfo", id, `修改出库单「${doc.docNo}」的收货信息`);

    return outboundService.detail(id);
  },

  /**
   * 确认发货。
   * 不传 itemIds = 把**所有还没发的行**一次发完（老的单地址单据走的还是这条路）；
   * 传了 itemIds 就只发那几行，剩下的继续挂在待发货。
   */
  async ship(
    id: string,
    itemIds: string[] | null,
    actor: { userId: string; role: string },
  ): Promise<{ doc: OutboundDocView; shipped: number; remaining: number; allDone: boolean }> {
    // 接口层已经限了角色，这里再拦一道：内勤永远不能自己确认发货，
    // 否则「内勤提交、仓管确认」这个复核点就白设了
    if (actor.role === "clerk") {
      throw new ForbiddenError("内勤不能点确认发货，这一步要仓管来做");
    }

    const result = await prisma.$transaction(async (tx) => {
      return shipItemsInTx(tx, id, itemIds, actor.userId);
    });

    return { doc: await outboundService.detail(id), ...result };
  },

  /** 兼容旧入口：整单确认 = 把剩下的全发掉 */
  async approve(id: string, actor: { userId: string; role: string }): Promise<OutboundDocView> {
    const { doc } = await outboundService.ship(id, null, actor);
    return doc;
  },

  /**
   * 删除草稿。删掉后行上锁定的定制件自动解锁（外键 SetNull）
   *
   * ⚠ 部分发出的单**绝不许删**：单据一删，明细和库存流水会级联消失，
   * 但货已经走了——账上库存会凭空回来。这条校验只能硬拦，不能提示了事。
   */
  async remove(id: string, actor: { userId: string; role: string }): Promise<void> {
    const doc = await outboundRepository.findById(id);
    if (!doc) throw new NotFoundError("找不到这张出库单");
    if (doc.status === "approved") {
      throw new ConflictError("已生效的出库单不能删除。要更正请走红冲，或联系管理员");
    }

    const shipped = doc.items.filter((i) => i.shippedAt).length;
    if (shipped > 0) {
      throw new ConflictError(
        `这张单已经发出 ${shipped} 个包裹并扣了库存，不能整单删除。` +
          `没发的行可以单独删掉；确实整单不做了，找管理员处理`,
      );
    }

    // 内勤撤销自己整理的单（填错了重来），别人的单不许动
    if (actor.role === "clerk" && doc.createdById && doc.createdById !== actor.userId) {
      throw new ForbiddenError("这单是别人整理的，内勤只能撤销自己开的单");
    }

    await prisma.$transaction(async (tx) => {
      await outboundRepository.deleteDraft(id, tx);
    });

    await writeAudit(actor.userId, "outbound.delete", id, `删除出库草稿「${doc.docNo}」`);
  },

  /**
   * 删掉单据里还没发出的某一行（客户取消、货彻底没有了）。
   * 已发出的行不能删——它的流水已经进了库存账。
   * 删完之后：剩下的行全发完了 ⇒ 单据自动结案；一行不剩 ⇒ 空壳单据一并删掉。
   */
  async removeItem(
    id: string,
    itemId: string,
    actor: { userId: string; role: string },
  ): Promise<{ doc: OutboundDocView; allDone: boolean }> {
    const doc = await outboundRepository.findById(id);
    if (!doc) throw new NotFoundError("找不到这张出库单");
    if (doc.status === "approved") throw new ConflictError("这张单已经全部发完了，不能再删行");
    if (doc.status === "voided") throw new ConflictError("这张单已作废");

    if (actor.role === "clerk" && doc.createdById && doc.createdById !== actor.userId) {
      throw new ForbiddenError("这单是别人整理的，内勤只能删自己开的单");
    }

    const item = doc.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundError("这一行已经不在单据里了，请刷新页面");

    if (item.shippedAt) {
      throw new ConflictError(
        `第 ${item.lineNo} 行已经发出去了（库存已扣、流水已记），不能删。` +
          `如果是发错了，等管理员走红冲`,
      );
    }

    if (doc.items.length === 1) {
      throw new ConflictError("这是单里最后一行。整张单都不要了的话，直接删单更干净");
    }

    const allDone = await prisma.$transaction(async (tx) => {
      await outboundRepository.deleteItem(itemId, tx);
      const agg = await outboundRepository.recountItems(id, tx);

      // 删完发现剩下的行全都发过了 ⇒ 这张单没有待办事项了，直接结案
      const unshipped = await outboundRepository.countUnshipped(id, tx);
      if (unshipped === 0) {
        await outboundRepository.markApproved(id, actor.userId, tx);
        await writeAudit(
          actor.userId,
          "outbound.approve",
          id,
          `出库单「${doc.docNo}」剩 ${agg.itemCount} 行全部发完，结案`,
          tx,
        );
      }
      return unshipped === 0;
    });

    await writeAudit(
      actor.userId,
      "outbound.deleteItem",
      id,
      `从出库单「${doc.docNo}」删掉第 ${item.lineNo} 行（未发出）`,
    );

    return { doc: await outboundService.detail(id), allDone };
  },

  /**
   * 改某一行的收货信息 / 订单号 / 物流单号。
   * 已经发出去的行不改：货在路上了，改地址只会让系统显示的地址和箱子上的不一致。
   * 数量与商品一律不动——那动了就得重算库存与批次。
   */
  async updateItemInfo(
    id: string,
    itemId: string,
    input: UpdateOutboundItemInput,
    actor: { userId: string; role: string },
  ): Promise<OutboundDocView> {
    const doc = await outboundRepository.findById(id);
    if (!doc) throw new NotFoundError("找不到这张出库单");
    if (doc.status === "voided") throw new ConflictError("这张单已作废，不能再改");
    if (doc.status === "approved") {
      throw new ConflictError("这张单已经全部发完了，收货信息不能改。要更正请让管理员红冲后重开");
    }

    if (actor.role === "clerk" && doc.createdById && doc.createdById !== actor.userId) {
      throw new ForbiddenError("这单是别人整理的，内勤只能改自己开的单");
    }

    const item = doc.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundError("这一行已经不在单据里了，请刷新页面");
    if (item.shippedAt) {
      throw new ConflictError("这一行已经发出去了，收货信息不能改。要更正请联系管理员");
    }

    // 没传的字段保持原值，别把人家填好的地址一键清空
    const next = {
      receiverInfo:
        input.receiverInfo === undefined ? item.receiverInfo : input.receiverInfo?.trim() || null,
      externalNo: input.externalNo === undefined ? item.externalNo : input.externalNo?.trim() || null,
      trackingNo:
        input.trackingNo === undefined ? item.trackingNo : input.trackingNo?.trim() || null,
    };

    await outboundRepository.updateItemInfo(itemId, next, prisma);
    await writeAudit(
      actor.userId,
      "outbound.updateItem",
      id,
      `修改出库单「${doc.docNo}」第 ${item.lineNo} 行的收货信息`,
    );

    return outboundService.detail(id);
  },
};

/**
 * 审核的实际动作（必须在事务内调用）：
 * 1. 行级校验：定制款必须点够件、件必须还在库；常规款不能带件
 * 2. 汇总校验：一个颜色出现在多行时按合计算，防止两行各出一半把库存超掉
 * 3. 常规款按批次扣减：指定批次就扣指定批，否则按生产日期先后自动扣
 * 4. 定制款逐件置为已出库，一件一条流水
 * 5. 单据置为已生效，刷新商品使用频次
 */
/**
 * 确认发货（必须在事务内调用）。一单几十个买家地址，缺货是常态，
 * 所以这一步按**行**做：传 itemIds 就只发这几行，传 null 就发全部还没发的。
 *
 * 1. 行级校验：定制款必须点够件、件必须还在库；常规款不能带件
 * 2. 汇总校验：**只看本次要发的行**，同一颜色多行合并算，防止超发
 * 3. 常规款按批次扣减：指定批次就扣指定批，否则按生产日期先后自动扣
 * 4. 定制款逐件置为已出库，一件一条流水
 * 5. 给这几行盖上发货时间；剩下的行还挂着，单据继续留在待发货
 * 6. 全部行发完才算结案（status → approved）
 */
async function shipItemsInTx(
  tx: Prisma.TransactionClient,
  id: string,
  itemIds: string[] | null,
  userId: string,
): Promise<{ shipped: number; remaining: number; allDone: boolean }> {
  const doc = await outboundRepository.findForApprove(id, tx);
  if (!doc) throw new NotFoundError("找不到这张出库单");
  if (doc.status === "approved") throw new ConflictError("这张出库单已经全部发完了，不用再确认");
  if (doc.status === "voided") throw new ConflictError("已作废的单据不能发货");
  if (!doc.locationId) throw new ValidationError("这张单没有指定发货仓位，请重新建单");

  // 本次要处理的行：指定了就只处理指定的，没指定就处理全部还没发的
  const targets = itemIds
    ? doc.items.filter((i) => new Set(itemIds).has(i.id))
    : doc.items.filter((i) => !i.shippedAt);

  if (itemIds) {
    const known = new Set(doc.items.map((i) => i.id));
    const unknown = [...new Set(itemIds)].filter((x) => !known.has(x));
    if (unknown.length > 0) {
      throw new ValidationError("有一行已经不在单据里了（可能刚被删掉），请刷新页面重新勾选");
    }
  }
  if (targets.length === 0) {
    throw new ConflictError(
      itemIds ? "勾选的这几行已经发过了，刷新一下看看" : "这张单没有待发的行",
    );
  }
  const already = targets.filter((i) => i.shippedAt);
  if (already.length > 0) {
    throw new ConflictError(
      `第 ${already.map((i) => i.lineNo).join("、")} 行已经发过了，不能重复发（会扣两遍库存）`,
    );
  }

  const location = await tx.location.findUnique({
    where: { id: doc.locationId },
    select: { id: true, name: true, type: true, isSellable: true },
  });
  if (!location || location.type !== "normal" || !location.isSellable) {
    throw new ValidationError("只能从主仓这类常规仓位发货");
  }

  // 行级校验：件必须在库，且数量要和勾选的件数一致
  for (const item of targets) {
    const label = lineLabel(item);

    if (item.sku.variantType === "custom") {
      if (item.outboundInstances.length === 0) {
        throw new ValidationError(`${label} 是定制款，要选定具体哪一件才能出库`);
      }
      if (item.outboundInstances.length !== item.qty) {
        throw new ValidationError(
          `${label} 勾了 ${item.outboundInstances.length} 件，但数量是 ${item.qty}，两者要对齐`,
        );
      }
      for (const inst of item.outboundInstances) {
        if (inst.status !== "in_stock") {
          throw new ConflictError(
            `${label} 的 ${inst.code} 已经不在库（${instanceStatusLabel(inst.status)}），请把这一行换成在库的件`,
          );
        }
        if (inst.stocktakeItemId) {
          throw new ConflictError(
            `${label} 的 ${inst.code} 已经被一张盘点单判为盘亏，不能出库。先处理那张盘点单，或把这一行换成别的件`,
          );
        }
        if (inst.disposalItemId) {
          throw new ConflictError(
            `${label} 的 ${inst.code} 已经被一张报废/处置草稿选中，不能出库。先处理那张单，或把这一行换成别的件`,
          );
        }
      }
    } else if (item.outboundInstances.length > 0) {
      throw new ValidationError(`${label} 是常规款，不该指定单件编号`);
    }
  }

  // 汇总校验：本次要发的行里，同一颜色多行合并后一起看，
  // 别让两行各出一半把库存超掉。没勾的行不参与——它们这次不出货。
  const needBySku = new Map<string, number>();
  for (const item of targets) {
    needBySku.set(item.skuId, (needBySku.get(item.skuId) ?? 0) + item.qty);
  }

  const stockMap = await stockRepository.stockBySkuIdsInTx([...needBySku.keys()], tx);
  const shortages: string[] = [];
  for (const [skuId, need] of needBySku) {
    const have = stockMap.get(skuId) ?? 0;
    if (need > have) {
      const line = targets.find((i) => i.skuId === skuId)!;
      const unit = line.sku.product.unit || UNIT_FALLBACK;
      shortages.push(`${lineLabel(line)} 只有 ${have} ${unit}，这次要出 ${need}`);
    }
  }
  if (shortages.length > 0) {
    throw new ValidationError(`库存不够，先别发：${shortages.join("；")}`);
  }

  // 流水记在「这一行真正发出去的那天」。
  // 一单几十个包裹常常分两三天发完，如果都记在单据日期上，
  // 昨天的报表凭空多几笔、今天的少几笔，月底对账要抓半天。
  // 例外：仓管自己开单补录昨天的货（没有提交标记），那种单仍按单据业务日期记账。
  const backdated = !doc.submittedAt && doc.bizDate.getTime() < startOfToday().getTime();
  const occurredAt = backdated ? doc.bizDate : startOfToday();

  // 先给这几行盖时间戳：条件更新（shippedAt 仍是空）能兜住并发，
  // 两个人同时点同一行确认，只有一个人能盖成功，另一人整笔回滚，不会扣两遍。
  const marked = await outboundRepository.markItemsShipped(
    targets.map((i) => i.id),
    userId,
    occurredAt,
    tx,
  );
  if (marked.count !== targets.length) {
    throw new ConflictError("有几行刚被别的操作发走了，请刷新后重新勾选");
  }

  const productIds = new Set<string>();

  for (const item of targets) {
    productIds.add(item.sku.product.id);

    if (item.sku.variantType === "custom") {
      const instanceIds = item.outboundInstances.map((i) => i.id);
      await outboundRepository.markInstancesOutbound(instanceIds, doc.id, tx);

      for (const inst of item.outboundInstances) {
        if (inst.batchId) {
          await outboundRepository.decrementBatch(inst.batchId, 1, tx);
        }
        await outboundRepository.createMovement(
          {
            skuId: item.skuId,
            locationId: location.id,
            qtyDelta: -1,
            bizType: "outbound",
            documentId: doc.id,
            documentItemId: item.id,
            batchId: inst.batchId,
            itemInstanceId: inst.id,
            occurredAt,
            createdById: userId,
            note: `单件 ${inst.code}`,
          },
          tx,
        );
      }
      continue;
    }

    // 常规款：先定批次，再逐条写流水——一条流水对应一个批次，批次余量才扣得准
    const allocations = await allocateBatches(tx, item);

    // 把实际扣掉的批次写回明细，详情页才能直接看到「这行扣的是哪批」
    const batchNos = [...new Set(allocations.map((a) => a.batchNo).filter((v): v is string => !!v))];
    if (batchNos.length > 0 && batchNos.join(",") !== item.batchNo) {
      await outboundRepository.updateItemBatchNo(item.id, batchNos.join(","), tx);
    }

    for (const alloc of allocations) {
      await outboundRepository.createMovement(
        {
          skuId: item.skuId,
          locationId: location.id,
          qtyDelta: -alloc.qty,
          bizType: "outbound",
          documentId: doc.id,
          documentItemId: item.id,
          batchId: alloc.batchId,
          occurredAt,
          createdById: userId,
        },
        tx,
      );
    }
  }

  const remaining = await outboundRepository.countUnshipped(doc.id, tx);

  if (remaining === 0) {
    // 全部行发完才算结案。隔天才发完的工单顺手把单据日期挪到今天，
    // 否则列表上这张单会一直沉在昨天那一段，看着像没处理。
    if (doc.submittedAt && doc.bizDate.getTime() < startOfToday().getTime()) {
      await outboundRepository.updateBizDate(doc.id, occurredAt, tx);
      await writeAudit(
        userId,
        "outbound.bizDateShift",
        doc.id,
        `工单隔天才发完，单据日期由 ${formatDateOnly(doc.bizDate)} 改为 ${formatDateOnly(occurredAt)}`,
        tx,
      );
    }
    await outboundRepository.markApproved(doc.id, userId, tx);
    await outboundRepository.touchProducts([...productIds], tx);
    await writeAudit(
      userId,
      "outbound.approve",
      doc.id,
      `出库单「${doc.docNo}」全部 ${doc.items.length} 个包裹发完，结案`,
      tx,
    );
  } else {
    await writeAudit(
      userId,
      "outbound.ship",
      doc.id,
      `确认发出 ${targets.length} 个包裹（本单已发 ${doc.items.length - remaining}/${doc.items.length}），还有 ${remaining} 个待发`,
      tx,
    );
  }

  return { shipped: targets.length, remaining, allDone: remaining === 0 };
}

type Allocation = { batchId: string | null; batchNo: string | null; qty: number };

/**
 * 把一行的出库数量落到批次上。
 * - 用户指定了批次：只扣那个批次，不够就报错
 * - 没指定：按生产日期先后自动扣（先产的先走），不拦发货，只是把账记准
 * - 批次扣完还有剩余：说明有没归批的货（入库时没填生产日期），这部分照出，流水不带批次
 */
async function allocateBatches(
  tx: Prisma.TransactionClient,
  item: {
    id: string;
    skuId: string;
    qty: number;
    batchNo: string | null;
    lineNo: number;
    sku: { colorName: string | null; product: { name: string; unit: string } };
  },
): Promise<Allocation[]> {
  const label = lineLabel(item);
  const unit = item.sku.product.unit || UNIT_FALLBACK;
  const allocations: Allocation[] = [];
  let remaining = item.qty;

  if (item.batchNo) {
    const batch = await outboundRepository.findBatchByNo(item.skuId, item.batchNo, tx);
    if (!batch) {
      throw new ValidationError(`${label} 找不到批次 ${item.batchNo}，请重新选择`);
    }
    if (batch.quantity < remaining) {
      throw new ValidationError(
        `${label} 批次 ${item.batchNo} 只剩 ${batch.quantity} ${unit}，不够出 ${remaining}`,
      );
    }
    allocations.push({ batchId: batch.id, batchNo: batch.batchNo, qty: remaining });
    remaining = 0;
  } else {
    const batches = await outboundRepository.listBatchesWithStock(item.skuId, tx);
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.quantity, remaining);
      allocations.push({ batchId: batch.id, batchNo: batch.batchNo, qty: take });
      remaining -= take;
    }
  }

  if (remaining > 0) {
    allocations.push({ batchId: null, batchNo: null, qty: remaining });
  }

  for (const alloc of allocations) {
    if (alloc.batchId) {
      await outboundRepository.decrementBatch(alloc.batchId, alloc.qty, tx);
    }
  }

  return allocations;
}

async function writeAudit(
  userId: string,
  action: string,
  entityId: string,
  summary: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const data = { userId, action, entityType: "document", entityId, summary };
  try {
    if (tx) await tx.auditLog.create({ data });
    else await prisma.auditLog.create({ data });
  } catch {
    // 审计写失败不能把已经记好的货回滚掉
  }
}
