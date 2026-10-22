import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatCompactDate, formatDateOnly, parseDateOnly, startOfToday, todayDateOnly } from "@/lib/date";
import { inboundRepository, type InboundDocRecord } from "./inbound.repository";
import { inboundPurgeService, type PurgeInboundResult } from "./inbound.purge";
import type { CreateInboundInput, ListInboundQuery } from "./inbound.schema";
import type { InboundDocView, InboundItemView, InboundListResult, InboundMeta } from "./inbound.types";

function toItemView(item: InboundDocRecord["items"][number], codes: string[]): InboundItemView {
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
    productionDate: item.productionDate ? formatDateOnly(item.productionDate) : null,
    batchNo: item.batchNo,
    remark: item.remark,
    instanceCodes: codes,
  };
}

function toView(doc: InboundDocRecord, codesByItem?: Map<string, string[]>): InboundDocView {
  const items = doc.items.map((item) => toItemView(item, codesByItem?.get(item.id) ?? []));
  const status = doc.status === "approved" ? "approved" : doc.status === "voided" ? "voided" : "draft";

  return {
    id: doc.id,
    docNo: doc.docNo,
    status,
    bizDate: formatDateOnly(doc.bizDate),
    locationId: doc.locationId,
    locationName: doc.location?.name ?? null,
    remark: doc.remark,
    itemCount: doc.itemCount,
    totalQty: doc.totalQty,
    createdByName: doc.createdBy?.displayName ?? null,
    approvedByName: doc.approvedBy?.displayName ?? null,
    approvedAt: doc.approvedAt ? doc.approvedAt.toISOString() : null,
    voidedAt: doc.voidedAt ? doc.voidedAt.toISOString() : null,
    voidReason: doc.voidReason,
    voidedByName: doc.voidedBy?.displayName ?? null,
    createdAt: doc.createdAt.toISOString(),
    preview: buildPreview(doc),
    items,
  };
}

/** 列表摘要：把明细压成一行「产品·颜色 ×数量」 */
function buildPreview(doc: InboundDocRecord): string {
  const parts = doc.items
    .slice(0, 3)
    .map((item) => {
      const color = item.sku.colorName?.trim();
      return `${item.sku.product.name}${color ? ` · ${color}` : ""} ×${item.qty}`;
    });
  const more = doc.items.length > 3 ? ` 等 ${doc.items.length} 项` : "";
  return parts.join("、") + more;
}

/** 定制件编号前缀：DZ-20261020- */
function instanceCodePrefix(bizDate: Date): string {
  return `DZ-${formatCompactDate(bizDate)}-`;
}

export const inboundService = {
  async list(query: ListInboundQuery): Promise<InboundListResult> {
    const [{ items, total }, counts] = await Promise.all([
      inboundRepository.list(query),
      inboundRepository.counts(),
    ]);

    return {
      items: items.map((doc) => toView(doc)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      counts,
    };
  },

  async detail(id: string): Promise<InboundDocView> {
    const doc = await inboundRepository.findById(id);
    if (!doc) throw new NotFoundError("找不到这张入库单");

    // 定制件的唯一编号从流水反查，避免在单件表上再加一个 documentItemId 字段
    const links = await inboundRepository.findInstanceCodes(id);
    const instanceIds = links.map((l) => l.itemInstanceId).filter((v): v is string => !!v);
    const codeRows = await inboundRepository.findInstanceCodeMap(instanceIds);
    const codeMap = new Map(codeRows.map((r) => [r.id, r.code]));

    const codesByItem = new Map<string, string[]>();
    for (const link of links) {
      if (!link.documentItemId || !link.itemInstanceId) continue;
      const code = codeMap.get(link.itemInstanceId);
      if (!code) continue;
      const list = codesByItem.get(link.documentItemId) ?? [];
      list.push(code);
      codesByItem.set(link.documentItemId, list);
    }

    return toView(doc, codesByItem);
  },

  async meta(): Promise<InboundMeta> {
    return {
      locations: await inboundRepository.listNormalLocations(),
      today: todayDateOnly(),
    };
  },

  /**
   * 建单。approveNow=true 时在同一事务里直接审核生效，
   * 仓管点一次「保存并审核」就把货记进账，不用再回来点第二次。
   */
  async create(input: CreateInboundInput, actor: { userId: string }): Promise<InboundDocView> {
    const bizDate = input.bizDate ? parseDateOnly(input.bizDate) : startOfToday();
    if (!bizDate) throw new ValidationError("业务日期格式有误");

    const locations = await inboundRepository.listNormalLocations();
    if (locations.length === 0) throw new ValidationError("还没有可用仓位，请先初始化主仓");

    const locationId = input.locationId?.trim() || locations[0]!.id;
    if (!locations.some((l) => l.id === locationId)) {
      throw new ValidationError("只能入库到主仓这类常规仓位，次品区与报废区不能直接入库");
    }

    // 一次性把涉及的 SKU 取全，校验颜色是否还存在、是常规款还是定制款
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
    }

    const totalQty = input.items.reduce((sum, i) => sum + i.qty, 0);

    const created = await prisma.$transaction(async (tx) => {
      const docNo = await inboundRepository.nextDocNo(bizDate, tx);

      const { id } = await inboundRepository.createDoc(
        {
          docNo,
          type: "inbound",
          status: "draft",
          bizDate,
          locationId,
          remark: input.remark?.trim() || null,
          itemCount: input.items.length,
          totalQty,
          createdById: actor.userId,
        },
        input.items.map((item, index) => {
          const sku = skuMap.get(item.skuId)!;
          const productionDate = item.productionDate ? parseDateOnly(item.productionDate) : null;
          // 定制件按件管理，不归批；常规件有生产日期就归批（SKU + 生产日期）
          const batchNo =
            sku.variantType === "custom" || !productionDate
              ? null
              : `P${formatCompactDate(productionDate)}`;

          return {
            skuId: item.skuId,
            lineNo: index + 1,
            qty: item.qty,
            productionDate,
            batchNo,
            remark: item.remark?.trim() || null,
          };
        }),
        tx,
      );

      if (input.approveNow) {
        await approveInTx(tx, id, actor.userId);
      }

      return id;
    });

    return inboundService.detail(created);
  },

  /** 审核草稿：把单据变成库存流水，这一步之后数字才会动 */
  async approve(id: string, actor: { userId: string }): Promise<InboundDocView> {
    await prisma.$transaction(async (tx) => {
      await approveInTx(tx, id, actor.userId);
    });

    return inboundService.detail(id);
  },

  /**
   * 删除入库单。
   * 草稿与已生效都走「彻底删除」，细节见 inbound.purge.ts；
   * 权限在路由层收口——**只有管理员**能删，普通账号连草稿都删不了
   * （入库错一笔会让库存数字直接失真，宁可让仓管来找店长，也不给他们自己抹账的按钮）。
   */
  async remove(id: string, actor: { userId: string }): Promise<PurgeInboundResult> {
    return inboundPurgeService.purge(id, actor);
  },
};

/**
 * 审核的实际动作（必须在事务内调用）：
 * 1. 常规款：按 生产日期 归批，写一条 +qty 的流水
 * 2. 定制款：为每一件生成唯一编号（DZ-日期-序号），每件写一条 +1 的流水
 * 3. 单据置为已生效，并刷新商品使用频次
 */
async function approveInTx(tx: Prisma.TransactionClient, id: string, userId: string): Promise<void> {
  const doc = await inboundRepository.findForApprove(id, tx);
  if (!doc) throw new NotFoundError("找不到这张入库单");
  if (doc.status === "approved") throw new ConflictError("这张入库单已经审核过了，无需重复操作");
  if (doc.status === "voided") throw new ConflictError("已作废的单据不能审核");
  if (!doc.locationId) throw new ValidationError("这张单没有指定入库仓位，请重新建单");

  const location = await tx.location.findUnique({
    where: { id: doc.locationId },
    select: { id: true, name: true, type: true, isSellable: true },
  });
  if (!location || location.type !== "normal" || !location.isSellable) {
    throw new ValidationError("只能入库到主仓这类常规仓位");
  }

  const prefix = instanceCodePrefix(doc.bizDate);
  let instanceSeq = await inboundRepository.countInstancesByPrefix(prefix, tx);
  const productIds = new Set<string>();
  // 业务日期就是流水发生时间：补录昨天的货，账也记在昨天
  const occurredAt = doc.bizDate;

  for (const item of doc.items) {
    productIds.add(item.sku.product.id);

    if (item.sku.variantType === "custom") {
      for (let i = 0; i < item.qty; i++) {
        instanceSeq += 1;
        const code = `${prefix}${String(instanceSeq).padStart(3, "0")}`;

        const instance = await inboundRepository.createInstance(
          {
            code,
            skuId: item.skuId,
            status: "in_stock",
            locationId: location.id,
            productionDate: item.productionDate,
            inboundDocumentId: doc.id,
            // 挂到明细行上：以后红冲 / 删除要按行找到这一件，不能只靠单据 id + SKU 反推
            documentItemId: item.id,
          },
          tx,
        );

        await inboundRepository.createMovement(
          {
            skuId: item.skuId,
            locationId: location.id,
            qtyDelta: 1,
            bizType: "inbound",
            documentId: doc.id,
            documentItemId: item.id,
            itemInstanceId: instance.id,
            occurredAt,
            createdById: userId,
          },
          tx,
        );
      }
      continue;
    }

    let batchId: string | null = null;
    if (item.batchNo && item.productionDate) {
      const batch = await inboundRepository.ensureBatch(
        {
          skuId: item.skuId,
          batchNo: item.batchNo,
          productionDate: item.productionDate,
          qty: item.qty,
        },
        tx,
      );
      batchId = batch.id;
    }

    await inboundRepository.createMovement(
      {
        skuId: item.skuId,
        locationId: location.id,
        qtyDelta: item.qty,
        bizType: "inbound",
        documentId: doc.id,
        documentItemId: item.id,
        batchId,
        occurredAt,
        createdById: userId,
      },
      tx,
    );
  }

  await inboundRepository.markApproved(doc.id, userId, tx);
  await inboundRepository.touchProducts([...productIds], tx);

  await writeAudit(userId, "inbound.approve", doc.id, `入库单「${doc.docNo}」审核生效`, tx);
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
