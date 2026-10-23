import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatDateOnly, parseDateOnly, startOfToday, todayDateOnly } from "@/lib/date";
import { returnRepository, type ReturnDocRecord } from "./return.repository";
import type { CreateReturnInput, ListReturnQuery } from "./return.schema";
import {
  CUSTOM_ALLOWED_DESTINATIONS,
  DESTINATION_LABEL,
  toDestination,
  type OriginDetail,
  type ReturnDestination,
  type ReturnableOrigin,
  type ReturnDocView,
  type ReturnItemView,
  type ReturnListResult,
  type ReturnMeta,
} from "./return.types";

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

/** 原出库行的说法，退货报错要用原单的行号，不能用自己的行号 */
function originLabel(item: {
  lineNo: number;
  sku: { colorName: string | null; product: { name: string; unit: string } };
}): string {
  const color = item.sku.colorName?.trim();
  return `原单第 ${item.lineNo} 行「${item.sku.product.name}${color ? ` · ${color}` : ""}」`;
}

function toItemView(item: ReturnDocRecord["items"][number], codes: string[]): ReturnItemView {
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
    destination: toDestination(item.destination),
    originItemId: item.originItemId,
    originLineNo: item.originItem?.lineNo ?? null,
    originQty: item.originItem?.qty ?? null,
    originReturnedQty: item.originItem?.returnedQty ?? null,
    batchNo: item.batchNo,
    instanceCodes: codes,
    remark: item.remark,
  };
}

function buildPreview(doc: ReturnDocRecord): string {
  const parts = doc.items.slice(0, 3).map((item) => {
    const color = item.sku.colorName?.trim();
    const dest = DESTINATION_LABEL[toDestination(item.destination)];
    return `${item.sku.product.name}${color ? ` · ${color}` : ""} ×${item.qty}→${dest}`;
  });
  const more = doc.items.length > 3 ? ` 等 ${doc.items.length} 项` : "";
  return parts.join("、") + more;
}

function toView(doc: ReturnDocRecord, codesByItem?: Map<string, string[]>): ReturnDocView {
  const status = doc.status === "approved" ? "approved" : doc.status === "voided" ? "voided" : "draft";

  const destinationQty: Record<ReturnDestination, number> = { good: 0, defective: 0, scrap: 0 };
  for (const item of doc.items) {
    destinationQty[toDestination(item.destination)] += item.qty;
  }

  return {
    id: doc.id,
    docNo: doc.docNo,
    status,
    bizDate: formatDateOnly(doc.bizDate),
    originDocumentId: doc.originDocumentId,
    originDocNo: doc.originDocument?.docNo ?? null,
    originBizDate: doc.originDocument?.bizDate ? formatDateOnly(doc.originDocument.bizDate) : null,
    externalNo: doc.externalNo,
    receiverName: doc.receiverName,
    trackingNo: doc.trackingNo,
    remark: doc.remark,
    itemCount: doc.itemCount,
    totalQty: doc.totalQty,
    destinationQty,
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

function summarizeOrigin(items: { qty: number; returnedQty: number }[]) {
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const returnedQty = items.reduce((s, i) => s + i.returnedQty, 0);
  return { totalQty, returnedQty, returnableQty: Math.max(0, totalQty - returnedQty) };
}

export const returnService = {
  async list(query: ListReturnQuery): Promise<ReturnListResult> {
    const [{ items, total }, counts] = await Promise.all([
      returnRepository.list(query),
      returnRepository.counts(),
    ]);

    return {
      items: items.map((doc) => toView(doc)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      counts,
    };
  },

  async detail(id: string): Promise<ReturnDocView> {
    const doc = await returnRepository.findById(id);
    if (!doc) throw new NotFoundError("找不到这张退货单");

    const rows = await returnRepository.listInstancesByItemIds(doc.items.map((i) => i.id));
    const codesByItem = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.returnItemId) continue;
      const list = codesByItem.get(row.returnItemId) ?? [];
      list.push(row.code);
      codesByItem.set(row.returnItemId, list);
    }

    return toView(doc, codesByItem);
  },

  async meta(): Promise<ReturnMeta> {
    const locs = await returnRepository.locations();
    return {
      today: todayDateOnly(),
      goodLocation: locs.good ? { id: locs.good.id, name: locs.good.name } : null,
      defectiveLocation: locs.defective ? { id: locs.defective.id, name: locs.defective.name } : null,
      scrapLocation: locs.scrap ? { id: locs.scrap.id, name: locs.scrap.name } : null,
    };
  },

  /** 搜原出库单。退货不能凭空建单，第一步永远是找到那张发货单 */
  async searchOrigins(q: string, limit: number): Promise<ReturnableOrigin[]> {
    const docs = await returnRepository.searchOrigins(q, limit);
    return docs.map((doc) => {
      const sum = summarizeOrigin(doc.items);
      return {
        id: doc.id,
        docNo: doc.docNo,
        bizDate: formatDateOnly(doc.bizDate),
        externalNo: doc.externalNo,
        receiverName: doc.receiverName,
        // 一单多地址：搜索结果里显示第一个包裹的地址，才认得出是哪张单
        receiverInfo:
          doc.items.find((i) => i.receiverInfo?.trim())?.receiverInfo?.trim() ||
          doc.receiverName,
        trackingNo: doc.trackingNo,
        preview: doc.items
          .slice(0, 3)
          .map((i) => {
            const color = i.sku.colorName?.trim();
            return `${i.sku.product.name}${color ? ` · ${color}` : ""} ×${i.qty}`;
          })
          .join("、"),
        totalQty: sum.totalQty,
        returnedQty: sum.returnedQty,
        returnableQty: sum.returnableQty,
      };
    });
  },

  /** 原出库单逐行可退量（含定制件清单），退货表单全靠它填 */
  async originDetail(id: string): Promise<OriginDetail> {
    const doc = await returnRepository.findOrigin(id);
    if (!doc) {
      throw new NotFoundError("找不到这张出库单，或者它还没审核生效——没发出去的货不能退");
    }

    const sum = summarizeOrigin(doc.items);

    const reserves = doc.items.flatMap((i) =>
      i.outboundInstances.map((inst) => inst.returnItemId).filter((v): v is string => !!v),
    );
    const reserveDocNos = new Map(
      (await returnRepository.findHolderDocNosByItemIds(reserves)).map((r) => [r.id, r.document.docNo]),
    );

    const returnedDocIds = doc.items.flatMap((i) =>
      i.outboundInstances
        .map((inst) => inst.returnDocumentId)
        .filter((v): v is string => !!v),
    );
    const returnedDocNos = new Map(
      (await returnRepository.findReturnDocNosByIds([...new Set(returnedDocIds)])).map((r) => [
        r.id,
        r.docNo,
      ]),
    );

    return {
      id: doc.id,
      docNo: doc.docNo,
      bizDate: formatDateOnly(doc.bizDate),
      externalNo: doc.externalNo,
      receiverName: doc.receiverName,
      trackingNo: doc.trackingNo,
      totalQty: sum.totalQty,
      returnedQty: sum.returnedQty,
      returnableQty: sum.returnableQty,
      items: doc.items.map((item) => ({
        id: item.id,
        lineNo: item.lineNo,
        skuId: item.skuId,
        productName: item.sku.product.name,
        unit: item.sku.product.unit,
        colorName: item.sku.colorName,
        variantType: item.sku.variantType === "custom" ? "custom" : "normal",
        qty: item.qty,
        returnedQty: item.returnedQty,
        returnableQty: Math.max(0, item.qty - item.returnedQty),
        batchNo: item.batchNo,
        // 行上没填地址的老单据，回退到整单地址，显示行为和以前一致
        receiverInfo: item.receiverInfo?.trim() || doc.receiverName?.trim() || null,
        externalNo: item.externalNo?.trim() || doc.externalNo?.trim() || null,
        instances: item.outboundInstances.map((inst) => ({
          id: inst.id,
          code: inst.code,
          productionDate: inst.productionDate ? formatDateOnly(inst.productionDate) : null,
          status: inst.status,
          returnable: inst.status === "outbound" && !inst.returnItemId,
          reservedBy: inst.returnItemId ? (reserveDocNos.get(inst.returnItemId) ?? "另一张退货草稿") : null,
          returnedByDocNo: inst.returnDocumentId
            ? (returnedDocNos.get(inst.returnDocumentId) ?? "已退")
            : null,
        })),
      })),
    };
  },

  /**
   * 建退货单。所有校验都围绕原出库单：
   * 退的是哪一行、发了多少、之前退过多少、还剩多少可退。
   */
  async create(input: CreateReturnInput, actor: { userId: string }): Promise<ReturnDocView> {
    const bizDate = input.bizDate ? parseDateOnly(input.bizDate) : startOfToday();
    if (!bizDate) throw new ValidationError("退货日期格式有误");

    const origin = await returnRepository.findOrigin(input.originDocumentId);
    if (!origin) {
      throw new NotFoundError("找不到这张出库单，或者它还没审核生效——没发出去的货不能退");
    }

    const originItemMap = new Map(origin.items.map((i) => [i.id, i]));

    for (const [index, item] of input.items.entries()) {
      const lineNo = index + 1;
      const originItem = originItemMap.get(item.originItemId);
      if (!originItem) {
        throw new ValidationError(`第 ${lineNo} 行选的原出库明细不属于这张出库单，请重新选`);
      }

      const dest = toDestination(item.destination);
      const isCustom = originItem.sku.variantType === "custom";
      const picked = item.instanceIds ?? [];
      const label = originLabel(originItem);

      if (isCustom) {
        // 定制件退货不允许回良品架：这是硬规则，绕不过去
        if (!CUSTOM_ALLOWED_DESTINATIONS.includes(dest)) {
          throw new ValidationError(
            `${label}是定制款，退货不能选「良品回架」——定制规格退回来基本卖不掉，只能进次品区或报废`,
          );
        }
        if (picked.length === 0) {
          throw new ValidationError(`${label}是定制款，要勾选退回来的是哪一件`);
        }
        if (picked.length !== item.qty) {
          throw new ValidationError(
            `${label}勾了 ${picked.length} 件，但数量填的是 ${item.qty}，两者要对齐`,
          );
        }

        const shipped = new Map(originItem.outboundInstances.map((i) => [i.id, i]));
        for (const instanceId of picked) {
          const inst = shipped.get(instanceId);
          if (!inst) {
            throw new ValidationError(`${label}选中的件不是这一行发出去的，请重新勾选`);
          }
          if (inst.status !== "outbound") {
            throw new ConflictError(
              `${label}的 ${inst.code} 已经退过了（${instanceStatusLabel(inst.status)}），不能重复退`,
            );
          }
          if (inst.returnItemId) {
            throw new ConflictError(
              `${label}的 ${inst.code} 已经被另一张退货草稿占用，请刷新后重选`,
            );
          }
        }
      } else if (picked.length > 0) {
        throw new ValidationError(`${label}是常规款，按数量退就行，不用勾单件`);
      }

      const remaining = originItem.qty - originItem.returnedQty;
      const unit = originItem.sku.product.unit || UNIT_FALLBACK;
      if (remaining <= 0) {
        throw new ValidationError(
          `${label}已经全部退完了（原单发了 ${originItem.qty} ${unit}，已退 ${originItem.returnedQty}），没有可退数量`,
        );
      }
      if (item.qty > remaining) {
        throw new ValidationError(
          `${label}原单发了 ${originItem.qty} ${unit}，之前已退 ${originItem.returnedQty}，这次最多退 ${remaining}`,
        );
      }
    }

    const totalQty = input.items.reduce((sum, i) => sum + i.qty, 0);

    const created = await prisma.$transaction(async (tx) => {
      const docNo = await returnRepository.nextDocNo(bizDate, tx);

      const { id, items: createdItems } = await returnRepository.createDoc(
        {
          docNo,
          type: "return",
          status: "draft",
          bizDate,
          originDocumentId: origin.id,
          externalNo: (input.externalNo ?? origin.externalNo)?.trim() || null,
          receiverName: (input.receiverName ?? origin.receiverName)?.trim() || null,
          trackingNo: input.trackingNo?.trim() || null,
          remark: input.remark?.trim() || null,
          itemCount: input.items.length,
          totalQty,
          createdById: actor.userId,
        },
        input.items.map((item, index) => {
          const originItem = originItemMap.get(item.originItemId)!;
          return {
            // SKU 从原出库行来，绝不信前端传的
            skuId: originItem.skuId,
            lineNo: index + 1,
            qty: item.qty,
            batchNo: originItem.batchNo,
            destination: toDestination(item.destination),
            originItemId: originItem.id,
            remark: item.remark?.trim() || null,
          };
        }),
        tx,
      );

      const itemIdByLine = new Map(createdItems.map((i) => [i.lineNo, i.id]));

      for (const [index, item] of input.items.entries()) {
        const picked = item.instanceIds ?? [];
        if (picked.length === 0) continue;

        const itemId = itemIdByLine.get(index + 1);
        if (!itemId) continue;

        const locked = await returnRepository.lockInstancesToItem(picked, itemId, tx);
        // 条件更新兜住并发：刚查完还没被占，不代表写的时候还没被占
        if (locked.count !== picked.length) {
          throw new ConflictError("有一件货刚被别的退货单占走，请刷新后重选");
        }
      }

      if (input.approveNow) {
        await approveInTx(tx, id, actor.userId);
      }

      return id;
    });

    return returnService.detail(created);
  },

  /** 审核：把退货变成正数流水，良品回架才真正回到可售库存 */
  async approve(id: string, actor: { userId: string }): Promise<ReturnDocView> {
    await prisma.$transaction(async (tx) => {
      await approveInTx(tx, id, actor.userId);
    });

    return returnService.detail(id);
  },

  /** 删除草稿：占用的单件自动释放（外键 SetNull） */
  async remove(id: string, actor: { userId: string }): Promise<void> {
    const doc = await returnRepository.findById(id);
    if (!doc) throw new NotFoundError("找不到这张退货单");
    if (doc.status === "approved") {
      throw new ConflictError("已生效的退货单不能删除。要更正请等红冲功能上线，或联系管理员");
    }

    await prisma.$transaction(async (tx) => {
      await returnRepository.deleteDraft(id, tx);
    });

    await writeAudit(actor.userId, "return.delete", id, `删除退货草稿「${doc.docNo}」`);
  },
};

/**
 * 审核的实际动作（必须在事务内调用）：
 * 1. 重新校验：原行还剩多少可退（草稿可能放了几小时，别单已经退过了）
 * 2. 定制件：必须勾齐件、件必须还是「已出库」、去向只能是次品区/报废（再查一遍）
 * 3. 按去向落仓位：良品回主仓（并把量加回原批次）、次品进次品区、报废进报废区
 * 4. 原出库行 returnedQty 累加，这张单以后再也退不超
 * 5. 单据置为已生效
 */
async function approveInTx(tx: Prisma.TransactionClient, id: string, userId: string): Promise<void> {
  const doc = await returnRepository.findForApprove(id, tx);
  if (!doc) throw new NotFoundError("找不到这张退货单");
  if (doc.status === "approved") throw new ConflictError("这张退货单已经审核过了，无需重复操作");
  if (doc.status === "voided") throw new ConflictError("已作废的单据不能审核");
  if (!doc.originDocumentId) {
    throw new ValidationError("这张退货单没有挂靠原出库单，请重新建单");
  }

  const locations = await locationsInTx(tx);

  for (const item of doc.items) {
    const label = lineLabel(item);
    const dest = toDestination(item.destination);

    if (!item.originItem) {
      throw new ValidationError(`${label}对应的原出库明细已不存在，无法退货`);
    }

    const remaining = item.originItem.qty - item.originItem.returnedQty;
    const unit = item.sku.product.unit || UNIT_FALLBACK;
    if (remaining <= 0) {
      throw new ConflictError(
        `${label}已经全部退完了（原单发了 ${item.originItem.qty} ${unit}，已退 ${item.originItem.returnedQty}），这张单请删掉或改数量`,
      );
    }
    if (item.qty > remaining) {
      throw new ConflictError(
        `${label}原单只发了 ${item.originItem.qty} ${unit}，已经退了 ${item.originItem.returnedQty}，这次最多退 ${remaining}。请改数量后重新保存`,
      );
    }

    if (item.sku.variantType === "custom") {
      if (!CUSTOM_ALLOWED_DESTINATIONS.includes(dest)) {
        throw new ValidationError(`${label}是定制款，退货只能进次品区或报废，不能回良品架`);
      }
      if (item.returnInstances.length === 0) {
        throw new ValidationError(`${label}是定制款，要勾选退回来的是哪一件`);
      }
      if (item.returnInstances.length !== item.qty) {
        throw new ValidationError(
          `${label}勾了 ${item.returnInstances.length} 件，但数量是 ${item.qty}，两者要对齐`,
        );
      }
      for (const inst of item.returnInstances) {
        if (inst.status !== "outbound") {
          throw new ConflictError(
            `${label}的 ${inst.code} 已经退过了（${instanceStatusLabel(inst.status)}），不能重复退`,
          );
        }
      }
    } else if (item.returnInstances.length > 0) {
      throw new ValidationError(`${label}是常规款，不该指定单件编号`);
    }

    const location =
      dest === "good" ? locations.good : dest === "defective" ? locations.defective : locations.scrap;
    if (!location) {
      throw new ValidationError(
        dest === "good"
          ? "还没有可用主仓，先初始化仓位再退货"
          : dest === "defective"
            ? "还没有次品区仓位，先初始化仓位再退货"
            : "还没有报废区仓位，先初始化仓位再退货",
      );
    }

    const occurredAt = doc.bizDate;

    if (item.sku.variantType === "custom") {
      const ids = item.returnInstances.map((i) => i.id);
      await returnRepository.markInstancesReturned(
        ids,
        {
          status: dest === "scrap" ? "scrapped" : "defective",
          locationId: location.id,
          documentId: doc.id,
        },
        tx,
      );

      for (const inst of item.returnInstances) {
        await returnRepository.createMovement(
          {
            skuId: item.skuId,
            locationId: location.id,
            qtyDelta: 1,
            bizType: "return_in",
            documentId: doc.id,
            documentItemId: item.id,
            // 次品/报废不进批次：批次只跟「可售可出」的量走
            batchId: null,
            itemInstanceId: inst.id,
            occurredAt,
            createdById: userId,
            note: `单件 ${inst.code} → ${DESTINATION_LABEL[dest]}`,
          },
          tx,
        );
      }
    } else {
      // 良品回架：把量加回原批次，否则批次余量会越退越少，自动扣批时对不上
      let batchId: string | null = null;
      if (dest === "good") {
        const firstBatchNo = (item.originItem.batchNo ?? "").split(",")[0]?.trim();
        if (firstBatchNo) {
          const batch = await returnRepository.findBatchByNo(item.skuId, firstBatchNo, tx);
          if (batch) {
            await returnRepository.incrementBatch(batch.id, item.qty, tx);
            batchId = batch.id;
          }
        }
      }

      await returnRepository.createMovement(
        {
          skuId: item.skuId,
          locationId: location.id,
          qtyDelta: item.qty,
          bizType: "return_in",
          documentId: doc.id,
          documentItemId: item.id,
          batchId,
          occurredAt,
          createdById: userId,
          note: `退货 → ${DESTINATION_LABEL[dest]}${batchId ? "" : dest === "good" ? "（无批次）" : ""}`,
        },
        tx,
      );
    }

    await returnRepository.incrementOriginReturned(item.originItem.id, item.qty, tx);
  }

  await returnRepository.markApproved(doc.id, userId, tx);
  await writeAudit(userId, "return.approve", doc.id, `退货单「${doc.docNo}」审核生效`, tx);
}

async function locationsInTx(tx: Prisma.TransactionClient) {
  const rows = await tx.location.findMany({
    select: { id: true, name: true, type: true, isSellable: true },
  });
  return {
    good: rows.find((l) => l.type === "normal" && l.isSellable) ?? null,
    defective: rows.find((l) => l.type === "defective") ?? null,
    scrap: rows.find((l) => l.type === "scrap") ?? null,
  };
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
