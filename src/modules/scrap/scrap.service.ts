import "server-only";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatDateOnly, parseDateOnly, startOfToday } from "@/lib/date";
import { PRESENT_INSTANCE_STATUSES, instanceStatusLabel } from "@/modules/document/document.types";
import { scrapRepository as repo, type Db } from "./scrap.repository";
import type {
  CreateScrapInput,
  ListScrapQuery,
  ScrapItemInput,
} from "./scrap.schema";
import {
  DISPOSITION_LABEL,
  toDisposition,
  type Disposition,
  type ScrapDocView,
  type ScrapItemView,
  type ScrapListResult,
  type ScrapMeta,
  type ScrapStockResult,
} from "./scrap.types";

const BIZ_TYPE = "scrap";
const UNIT_FALLBACK = "件";

/** 报废区：转报废的货最终躺在这里，等集中处理 */
async function scrapLocation(tx?: Db) {
  const db = tx ?? prisma;
  return db.location.findFirst({
    where: { type: "scrap" },
    select: { id: true, name: true },
  });
}

export const scrapService = {
  async list(query: ListScrapQuery): Promise<ScrapListResult> {
    const { rows, total, counts } = await repo.list(query);
    return {
      items: rows.map(toView),
      total,
      page: query.page,
      pageSize: query.pageSize,
      counts,
    };
  },

  async detail(id: string): Promise<ScrapDocView> {
    const doc = await repo.findById(id);
    if (!doc) throw new NotFoundError("找不到这张处置单");
    return toView(doc);
  },

  async meta(): Promise<ScrapMeta> {
    const locations = await repo.locations();
    return {
      // 报废区本身就是「终点」，不能再当起点，否则货在报废区里空转
      locations: locations.filter((l) => l.type !== "scrap"),
      defectiveId: locations.find((l) => l.type === "defective")?.id ?? null,
      today: formatDateOnly(startOfToday()),
    };
  },

  /** 源仓位里现有什么货：处置单的候选行 */
  async stock(locationId: string): Promise<ScrapStockResult> {
    const location = await repo.location(locationId);
    if (!location) throw new NotFoundError("找不到这个仓位，请刷新后重选");
    if (location.type === "scrap") {
      throw new ValidationError("报废区里的货不能再处置一次：它已经是终点了");
    }

    const withStock = await repo.skusWithStock(locationId);
    const skuIds = withStock.map((r) => r.skuId);
    const [infos, instances] = await Promise.all([
      repo.skuInfoByIds(skuIds),
      repo.instancesInLocation(locationId, skuIds),
    ]);

    const infoMap = new Map(infos.map((i) => [i.id, i]));

    const heldIds = instances
      .flatMap((i) => [i.outboundItemId, i.stocktakeItemId, i.disposalItemId])
      .filter((v): v is string => !!v);
    const holders = await repo.findHolderDocNos(heldIds);

    const instBySku = new Map<string, ScrapStockResult["rows"][number]["instances"]>();
    for (const inst of instances) {
      // 只有还在库的件才可能被出库草稿占着；退回次品区的件保留历史出库记录，但不算占用
      const heldBy =
        (inst.status === "in_stock" ? inst.outboundItemId : null) ??
        inst.stocktakeItemId ??
        inst.disposalItemId;
      const list = instBySku.get(inst.skuId) ?? [];
      list.push({
        id: inst.id,
        code: inst.code,
        productionDate: inst.productionDate ? formatDateOnly(inst.productionDate) : null,
        reservedBy: heldBy ? (holders.get(heldBy) ?? "另一张草稿") : null,
      });
      instBySku.set(inst.skuId, list);
    }

    const rows = withStock
      .map(({ skuId, qty }) => {
        const info = infoMap.get(skuId);
        if (!info) return null;
        return {
          skuId,
          productId: info.product.id,
          productName: info.product.name,
          unit: info.product.unit || UNIT_FALLBACK,
          colorName: info.colorName,
          variantType: info.variantType === "custom" ? ("custom" as const) : ("normal" as const),
          qty,
          batches: [],
          instances: instBySku.get(skuId) ?? [],
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      // 按产品名 + 颜色排，跟货架上的顺序大致对得上
      .sort((a, b) =>
        a.productName === b.productName
          ? (a.colorName ?? "").localeCompare(b.colorName ?? "")
          : a.productName.localeCompare(b.productName),
      );

    return {
      locationId: location.id,
      locationName: location.name,
      locationType: location.type,
      isSellable: location.isSellable,
      rows,
      total: rows.reduce((sum, r) => sum + r.qty, 0),
    };
  },

  async create(input: CreateScrapInput, actor: { userId: string }): Promise<ScrapDocView> {
    const bizDate = input.bizDate ? parseDateOnly(input.bizDate) : startOfToday();
    if (!bizDate) throw new ValidationError("业务日期不是有效日期");

    const location = await repo.location(input.sourceLocationId);
    if (!location) throw new ValidationError("找不到源仓位，请刷新后重选");
    if (location.type === "scrap") {
      throw new ValidationError("报废区里的货不能再处置一次：选主仓或次品区");
    }

    const skus = await repo.skuInfoByIds(input.items.map((i) => i.skuId));
    const skuMap = new Map(skus.map((s) => [s.id, s]));
    for (const item of input.items) {
      if (!skuMap.has(item.skuId)) {
        throw new ValidationError("有一行选的颜色已经不存在了，请刷新后重选");
      }
    }

    // 定制款必须点到具体件：一物一码的货，只说「2 件」等于没记
    for (const [index, item] of input.items.entries()) {
      const sku = skuMap.get(item.skuId)!;
      const picked = item.instanceIds ?? [];
      if (sku.variantType === "custom") {
        if (picked.length !== item.qty) {
          throw new ValidationError(
            lineLabel(index + 1, sku) + "是定制款，要勾选具体处理哪几件，勾选数要和数量一致",
          );
        }
      } else if (picked.length > 0) {
        throw new ValidationError(lineLabel(index + 1, sku) + "是常规款，不用指定件号");
      }
    }

    const totalQty = input.items.reduce((sum, i) => sum + i.qty, 0);

    const id = await prisma.$transaction(async (tx) => {
      const docNo = await repo.nextDocNo(bizDate, tx);
      const created = await repo.createDoc(
        {
          docNo,
          type: "scrap",
          bizDate,
          locationId: location.id,
          remark: input.remark?.trim() || null,
          itemCount: input.items.length,
          totalQty,
          createdById: actor.userId,
        },
        input.items.map((item, index) => ({
          skuId: item.skuId,
          lineNo: index + 1,
          qty: item.qty,
          disposition: item.disposition,
          remark: item.remark?.trim() || null,
        })),
        tx,
      );

      const itemIdByLine = new Map(created.items.map((i) => [i.lineNo, i.id]));
      for (const [index, item] of input.items.entries()) {
        const picked = item.instanceIds ?? [];
        if (picked.length === 0) continue;
        const itemId = itemIdByLine.get(index + 1);
        if (!itemId) continue;
        const locked = await repo.lockInstancesToItem(picked, itemId, tx);
        if (locked.count !== picked.length) {
          throw new ConflictError("有一件货刚被别的单占用了，请刷新后重选");
        }
      }

      if (input.approveNow) {
        await approveInTx(tx, created.id, actor.userId);
      }
      return created.id;
    });

    return scrapService.detail(id);
  },

  async approve(id: string, actor: { userId: string }): Promise<ScrapDocView> {
    await prisma.$transaction(async (tx) => {
      await approveInTx(tx, id, actor.userId);
    });
    return scrapService.detail(id);
  },

  async remove(id: string, actor: { userId: string }): Promise<void> {
    const doc = await repo.findById(id);
    if (!doc) throw new NotFoundError("找不到这张处置单");
    if (doc.status === "approved") {
      throw new ConflictError("已生效的处置单不能删除。填错了请用「红冲」退回，账会一并回滚");
    }

    await prisma.$transaction(async (tx) => {
      await repo.deleteDraft(id, tx);
    });

    await writeAudit(actor.userId, "scrap.delete", id, `删除处置草稿「${doc.docNo}」`);
  },
};

/**
 * 审核：把处置单变成流水。
 * 三种处理方式在账上的区别只有一处——**转报废的货还在仓库里**（进报废区），
 * 另外两种是真的离开系统，所以只写源仓位一条负数流水。
 * 定制件不管哪种方式都要落件号状态，否则一物一码就断了。
 */
async function approveInTx(tx: Db, id: string, userId: string): Promise<void> {
  const doc = await repo.findForApprove(id, tx);
  if (!doc) throw new NotFoundError("找不到这张处置单");
  if (doc.status === "approved") throw new ConflictError("这张单已经生效了，无需重复审核");
  if (doc.status === "voided") throw new ConflictError("已红冲的单据不能再审核");
  if (!doc.location) throw new ValidationError("这张单没有指定源仓位，请删掉重建");
  if (doc.location.type === "scrap") {
    throw new ValidationError("报废区里的货不能再处置一次");
  }
  if (doc.items.length === 0) throw new ValidationError("这张单没有任何明细，请删掉重建");

  const source = doc.location;
  const dest = await scrapLocation(tx);
  const needDest = doc.items.some((i) => toDisposition(i.disposition) === "scrap");
  if (needDest && !dest) {
    throw new ValidationError("还没有报废区仓位，先初始化仓位再转报废");
  }

  const skuIds = [...new Set(doc.items.map((i) => i.skuId))];
  // 库存按 SKU 合计比，不是按行比：同款同色拆成两行各扣一半会扣成负数
  const onHand = await repo.stockInLocation(source.id, skuIds, tx);
  const demand = new Map<string, number>();
  for (const item of doc.items) {
    demand.set(item.skuId, (demand.get(item.skuId) ?? 0) + item.qty);
  }
  for (const item of doc.items) {
    const label = lineLabel(item.lineNo, item.sku);
    const unit = item.sku.product.unit || UNIT_FALLBACK;
    const have = onHand.get(item.skuId) ?? 0;
    const want = demand.get(item.skuId) ?? 0;
    if (have < want) {
      throw new ConflictError(
        `${label}在「${source.name}」只有 ${have} ${unit}，本单要处理 ${want} ${unit}。请改数量，或先核对该款的实际库存`,
      );
    }
  }

  for (const item of doc.items) {
    const label = lineLabel(item.lineNo, item.sku);
    const disposition = toDisposition(item.disposition);
    const isCustom = item.sku.variantType === "custom";
    const occurredAt = doc.bizDate;

    if (isCustom) {
      const picked = item.disposalInstances;
      if (picked.length !== item.qty) {
        throw new ConflictError(
          `${label}要处理 ${item.qty} 件，但只勾了 ${picked.length} 件。定制款每一件都有编号，要一件件勾清楚`,
        );
      }
      for (const inst of picked) {
        if (!PRESENT_INSTANCE_STATUSES.includes(inst.status)) {
          throw new ConflictError(
            `${label}的 ${inst.code} 现在${instanceStatusLabel(inst.status)}，不在仓里，处理不了`,
          );
        }
        if (inst.locationId !== source.id) {
          throw new ConflictError(`${label}的 ${inst.code} 不在「${source.name}」，不能在这里处理`);
        }
        if (inst.disposalItemId !== item.id) {
          throw new ConflictError(`${label}的 ${inst.code} 没有被这一行锁定，请刷新后重新保存`);
        }
      }

      // 源仓位减一件
      for (const inst of picked) {
        await repo.createMovement(
          {
            skuId: item.skuId,
            locationId: source.id,
            qtyDelta: -1,
            bizType: BIZ_TYPE,
            documentId: doc.id,
            documentItemId: item.id,
            batchId: null,
            itemInstanceId: inst.id,
            occurredAt,
            createdById: userId,
            note: `${DISPOSITION_LABEL[disposition]} · ${inst.code}`,
          },
          tx,
        );
      }

      if (disposition === "scrap" && dest) {
        for (const inst of picked) {
          await repo.createMovement(
            {
              skuId: item.skuId,
              locationId: dest.id,
              qtyDelta: 1,
              bizType: BIZ_TYPE,
              documentId: doc.id,
              documentItemId: item.id,
              batchId: null,
              itemInstanceId: inst.id,
              occurredAt,
              createdById: userId,
              note: `进报废区 · ${inst.code}`,
            },
            tx,
          );
        }
      }

      await repo.setInstanceState(
        picked.map((i) => i.id),
        {
          status:
            disposition === "scrap"
              ? "scrapped"
              : disposition === "offline_sale"
                ? "sold_offline"
                : "disposed",
          // 转报废的货还在仓库（报废区），另外两种已经离开
          locationId: disposition === "scrap" && dest ? dest.id : null,
        },
        tx,
      );
      continue;
    }

    // 常规款：可售仓位才扣批次；次品区本来就没有批次
    if (source.isSellable) {
      let remaining = item.qty;
      const batches = await repo.listBatchesWithStock(item.skuId, tx);
      for (const batch of batches) {
        if (remaining <= 0) break;
        const take = Math.min(batch.quantity, remaining);
        await repo.decrementBatch(batch.id, take, tx);
        await repo.createMovement(
          {
            skuId: item.skuId,
            locationId: source.id,
            qtyDelta: -take,
            bizType: BIZ_TYPE,
            documentId: doc.id,
            documentItemId: item.id,
            batchId: batch.id,
            occurredAt,
            createdById: userId,
            note: `${DISPOSITION_LABEL[disposition]} · 批次 ${batch.batchNo}`,
          },
          tx,
        );
        remaining -= take;
      }
      if (remaining > 0) {
        // 没归批的货（入库时没填生产日期），批次不够扣，剩下的走无批次流水
        await repo.createMovement(
          {
            skuId: item.skuId,
            locationId: source.id,
            qtyDelta: -remaining,
            bizType: BIZ_TYPE,
            documentId: doc.id,
            documentItemId: item.id,
            batchId: null,
            occurredAt,
            createdById: userId,
            note: `${DISPOSITION_LABEL[disposition]} · 无批次`,
          },
          tx,
        );
      }
    } else {
      await repo.createMovement(
        {
          skuId: item.skuId,
          locationId: source.id,
          qtyDelta: -item.qty,
          bizType: BIZ_TYPE,
          documentId: doc.id,
          documentItemId: item.id,
          batchId: null,
          occurredAt,
          createdById: userId,
          note: DISPOSITION_LABEL[disposition],
        },
        tx,
      );
    }

    // 转报废：货挪进报废区，报废区的账也要有，否则「报废区有多少」永远对不上
    if (disposition === "scrap" && dest) {
      await repo.createMovement(
        {
          skuId: item.skuId,
          locationId: dest.id,
          qtyDelta: item.qty,
          bizType: BIZ_TYPE,
          documentId: doc.id,
          documentItemId: item.id,
          batchId: null,
          occurredAt,
          createdById: userId,
          note: `进报废区 · 来自「${source.name}」`,
        },
        tx,
      );
    }
  }

  await repo.markApproved(doc.id, userId, tx);
  await writeAudit(userId, "scrap.approve", doc.id, `处置单「${doc.docNo}」审核生效`, tx);
}

/* ------------------------------------------------------------------ 视图 */

type RawDoc = NonNullable<Awaited<ReturnType<typeof repo.findById>>>;
type RawItem = RawDoc["items"][number];

function toView(doc: RawDoc): ScrapDocView {
  return {
    id: doc.id,
    docNo: doc.docNo,
    status: (doc.status === "approved" ? "approved" : doc.status === "voided" ? "voided" : "draft") as ScrapDocView["status"],
    bizDate: formatDateOnly(doc.bizDate),
    sourceLocationId: doc.location?.id ?? null,
    sourceLocationName: doc.location?.name ?? null,
    fromDefective: doc.location?.type === "defective",
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
    preview: previewOf(doc),
    items: doc.items.map(toItemView),
  };
}

function toItemView(item: RawItem): ScrapItemView {
  return {
    id: item.id,
    lineNo: item.lineNo,
    skuId: item.skuId,
    productId: item.sku.product.id,
    productName: item.sku.product.name,
    unit: item.sku.product.unit || UNIT_FALLBACK,
    colorName: item.sku.colorName,
    variantType: item.sku.variantType === "custom" ? "custom" : "normal",
    qty: item.qty,
    disposition: toDisposition(item.disposition),
    instanceCodes: item.disposalInstances.map((i) => i.code),
    remark: item.remark,
  };
}

/** 列表页一句话摘要：三行以内说清这批货怎么处理掉了 */
function previewOf(doc: RawDoc): string {
  const parts = doc.items.slice(0, 3).map((item) => {
    const color = item.sku.colorName?.trim() ? item.sku.colorName : "无颜色";
    const disposition = DISPOSITION_LABEL[toDisposition(item.disposition)];
    return `${item.sku.product.name} ${color} ×${item.qty} ${disposition}`;
  });
  const more = doc.items.length > 3 ? ` 等 ${doc.items.length} 行` : "";
  return parts.join("；") + more;
}

function lineLabel(lineNo: number, sku: { colorName: string | null; product: { name: string } }): string {
  const color = sku.colorName?.trim() ? sku.colorName : "无颜色";
  return `第 ${lineNo} 行「${sku.product.name} · ${color}」`;
}

async function writeAudit(
  userId: string,
  action: string,
  entityId: string,
  summary: string,
  tx?: Db,
): Promise<void> {
  const data = { userId, action, entityType: "document", entityId, summary };
  try {
    if (tx) await tx.auditLog.create({ data });
    else await prisma.auditLog.create({ data });
  } catch {
    // 审计失败不能把已经记好的账回滚掉
  }
}

export type { Disposition, ScrapItemInput };
