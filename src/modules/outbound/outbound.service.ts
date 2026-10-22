import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatDateOnly, parseDateOnly, startOfToday, todayDateOnly } from "@/lib/date";
import { stockRepository } from "@/modules/inventory/stock.repository";
import { outboundRepository, type OutboundDocRecord } from "./outbound.repository";
import type { CreateOutboundInput, ListOutboundQuery } from "./outbound.schema";
import type {
  AvailabilityResult,
  OutboundDocView,
  OutboundItemView,
  OutboundListResult,
  OutboundMeta,
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

function toItemView(item: OutboundDocRecord["items"][number], codes: string[]): OutboundItemView {
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

function toView(doc: OutboundDocRecord, codesByItem?: Map<string, string[]>): OutboundDocView {
  const status = doc.status === "approved" ? "approved" : doc.status === "voided" ? "voided" : "draft";

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
    createdByName: doc.createdBy?.displayName ?? null,
    approvedByName: doc.approvedBy?.displayName ?? null,
    approvedAt: doc.approvedAt ? doc.approvedAt.toISOString() : null,
    voidedAt: doc.voidedAt ? doc.voidedAt.toISOString() : null,
    voidReason: doc.voidReason,
    voidedByName: doc.voidedBy?.displayName ?? null,
    createdAt: doc.createdAt.toISOString(),
    preview: buildPreview(doc),
    items: doc.items.map((item) => toItemView(item, codesByItem?.get(item.id) ?? [])),
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
   */
  async create(input: CreateOutboundInput, actor: { userId: string }): Promise<OutboundDocView> {
    const bizDate = input.bizDate ? parseDateOnly(input.bizDate) : startOfToday();
    if (!bizDate) throw new ValidationError("业务日期格式有误");

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

      if (input.approveNow) {
        await approveInTx(tx, id, actor.userId);
      }

      return id;
    });

    return outboundService.detail(created);
  },

  /** 审核草稿：把单据变成负数流水，这一步之后库存才会减 */
  async approve(id: string, actor: { userId: string }): Promise<OutboundDocView> {
    await prisma.$transaction(async (tx) => {
      await approveInTx(tx, id, actor.userId);
    });

    return outboundService.detail(id);
  },

  /** 删除草稿。删掉后行上锁定的定制件自动解锁（外键 SetNull） */
  async remove(id: string, actor: { userId: string }): Promise<void> {
    const doc = await outboundRepository.findById(id);
    if (!doc) throw new NotFoundError("找不到这张出库单");
    if (doc.status === "approved") {
      throw new ConflictError("已生效的出库单不能删除。要更正请等红冲功能上线，或联系管理员");
    }

    await prisma.$transaction(async (tx) => {
      await outboundRepository.deleteDraft(id, tx);
    });

    await writeAudit(actor.userId, "outbound.delete", id, `删除出库草稿「${doc.docNo}」`);
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
async function approveInTx(tx: Prisma.TransactionClient, id: string, userId: string): Promise<void> {
  const doc = await outboundRepository.findForApprove(id, tx);
  if (!doc) throw new NotFoundError("找不到这张出库单");
  if (doc.status === "approved") throw new ConflictError("这张出库单已经审核过了，无需重复操作");
  if (doc.status === "voided") throw new ConflictError("已作废的单据不能审核");
  if (!doc.locationId) throw new ValidationError("这张单没有指定发货仓位，请重新建单");

  const location = await tx.location.findUnique({
    where: { id: doc.locationId },
    select: { id: true, name: true, type: true, isSellable: true },
  });
  if (!location || location.type !== "normal" || !location.isSellable) {
    throw new ValidationError("只能从主仓这类常规仓位发货");
  }

  // 行级校验：件必须在库，且数量要和勾选的件数一致
  for (const item of doc.items) {
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

  // 汇总校验：同一颜色多行合并后一起看，别让两行各出一半把库存超掉
  const needBySku = new Map<string, number>();
  for (const item of doc.items) {
    needBySku.set(item.skuId, (needBySku.get(item.skuId) ?? 0) + item.qty);
  }

  const stockMap = await stockRepository.stockBySkuIdsInTx([...needBySku.keys()], tx);
  const shortages: string[] = [];
  for (const [skuId, need] of needBySku) {
    const have = stockMap.get(skuId) ?? 0;
    if (need > have) {
      const line = doc.items.find((i) => i.skuId === skuId)!;
      const unit = line.sku.product.unit || UNIT_FALLBACK;
      shortages.push(`${lineLabel(line)} 只有 ${have} ${unit}，本单要出 ${need}`);
    }
  }
  if (shortages.length > 0) {
    throw new ValidationError(`库存不够，先别发：${shortages.join("；")}`);
  }

  // 业务日期就是流水发生时间：补录昨天的发货，账也记在昨天
  const occurredAt = doc.bizDate;
  const productIds = new Set<string>();

  for (const item of doc.items) {
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

  await outboundRepository.markApproved(doc.id, userId, tx);
  await outboundRepository.touchProducts([...productIds], tx);

  await writeAudit(userId, "outbound.approve", doc.id, `出库单「${doc.docNo}」审核生效`, tx);
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
