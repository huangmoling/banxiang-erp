import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  formatCompactDate,
  formatDateOnly,
  formatLocalDateTime,
  nowLocalDateTime,
  parseLocalDateTime,
} from "@/lib/date";
import { stocktakeRepository, type StocktakeDocRecord } from "./stocktake.repository";
import type { CreateStocktakeInput, ListStocktakeQuery, SheetQuery } from "./stocktake.schema";
import {
  PRESENT_INSTANCE_STATUSES,
  instanceStatusLabel,
  toLocationType,
  type StocktakeDocView,
  type StocktakeListResult,
  type StocktakeLocation,
  type StocktakeMeta,
  type StocktakeRowView,
  type StocktakeSheet,
  type StocktakeSheetRow,
} from "./stocktake.types";

const UNIT_FALLBACK = "件";
/** 盘点差异流水的业务类型。仪表台的「本月入库/出库」不统计它，库存却照样对得上 */
const BIZ_TYPE = "stocktake_adjust";
/** 盘盈批次前缀：盘出来的货没有生产日期，单独归一个批次，不然批次合计会少于库存 */
const GAIN_BATCH_PREFIX = "PD-";

type SkuBrief = {
  colorName: string | null;
  product: { name: string; unit: string };
};

/** 「第 2 行「云栖托特包 · 米白」」——报错时要让人一眼找到是哪一行 */
function rowLabel(lineNo: number, sku: SkuBrief): string {
  const color = sku.colorName?.trim();
  return `第 ${lineNo} 行「${sku.product.name}${color ? ` · ${color}` : ""}」`;
}

function skuText(sku: SkuBrief): string {
  const color = sku.colorName?.trim();
  return `${sku.product.name}${color ? ` · ${color}` : ""}`;
}

function toItemView(
  item: StocktakeDocRecord["items"][number],
  afterQty: number,
  codes: string[],
): StocktakeRowView {
  const bookQty = item.bookQty ?? 0;
  return {
    id: item.id,
    lineNo: item.lineNo,
    skuId: item.skuId,
    productId: item.sku.product.id,
    productName: item.sku.product.name,
    unit: item.sku.product.unit || UNIT_FALLBACK,
    colorName: item.sku.colorName,
    variantType: item.sku.variantType === "custom" ? "custom" : "normal",
    bookQty,
    countedQty: item.qty,
    diffQty: item.qty - bookQty,
    afterQty,
    instanceCodes: codes,
    remark: item.remark,
  };
}

/** 列表摘要：说清楚「盘的是哪个仓位、有几个款对不上」 */
function buildPreview(doc: StocktakeDocRecord): string {
  const loc = doc.location?.name ?? "未指定仓位";
  const diffs = doc.items
    .map((item) => ({ item, diff: item.qty - (item.bookQty ?? 0) }))
    .filter((x) => x.diff !== 0);

  if (diffs.length === 0) return `${loc} · ${doc.items.length} 个款账实相符`;
  const parts = diffs
    .slice(0, 3)
    .map((x) => `${skuText(x.item.sku)} ${x.diff > 0 ? "+" : ""}${x.diff}`);
  const more = diffs.length > 3 ? ` 等 ${diffs.length} 个款` : "";
  return `${loc}：${parts.join("、")}${more}`;
}

function toView(
  doc: StocktakeDocRecord,
  afterBySku?: Map<string, number>,
  codesByItem?: Map<string, string[]>,
): StocktakeDocView {
  const status = doc.status === "approved" ? "approved" : doc.status === "voided" ? "voided" : "draft";

  const items = doc.items.map((item) =>
    toItemView(
      item,
      afterBySku?.get(item.skuId) ?? 0,
      codesByItem?.get(item.id) ?? [],
    ),
  );

  const bookTotal = items.reduce((s, i) => s + i.bookQty, 0);
  const totalQty = items.reduce((s, i) => s + i.countedQty, 0);
  const gainQty = items.reduce((s, i) => s + Math.max(0, i.diffQty), 0);
  const lossQty = items.reduce((s, i) => s + Math.max(0, -i.diffQty), 0);

  return {
    id: doc.id,
    docNo: doc.docNo,
    status,
    bizDate: formatDateOnly(doc.bizDate),
    snapshotAt: doc.snapshotAt ? doc.snapshotAt.toISOString() : null,
    locationId: doc.locationId,
    locationName: doc.location?.name ?? null,
    locationType: toLocationType(doc.location?.type),
    isSellable: doc.location?.isSellable ?? false,
    remark: doc.remark,
    itemCount: doc.itemCount,
    totalQty,
    bookTotal,
    gainQty,
    lossQty,
    diffLines: items.filter((i) => i.diffQty !== 0).length,
    createdByName: doc.createdBy?.displayName ?? null,
    approvedByName: doc.approvedBy?.displayName ?? null,
    approvedAt: doc.approvedAt ? doc.approvedAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    preview: buildPreview(doc),
    items,
  };
}

function toLocation(row: {
  id: string;
  name: string;
  type: string;
  isSellable: boolean;
}): StocktakeLocation {
  return {
    id: row.id,
    name: row.name,
    type: toLocationType(row.type),
    isSellable: row.isSellable,
  };
}

/**
 * 「截止到 20:35」这个说法，人听起来是「20:35 这一分钟结束之前」。
 * datetime-local 只到分钟，若按 20:35:00 切，这一分钟里已经录的单子会被甩到截止后，
 * 白白多出一截「截止后变动」。统一补到这一分钟的 59 秒，口径才和人嘴上说的一致。
 *
 * 但选的是「此刻」这一分钟时，补到分钟末就成了未来时刻——这几十秒里新录的流水会被算进账面，
 * 账面就不再冻结。所以再夹一次：截止时点永远不晚于现在。
 */
function parseSnapshot(input: string | undefined): Date | null {
  if (!input) return null;
  const d = parseLocalDateTime(input);
  if (!d) return null;
  d.setSeconds(59, 999);
  const now = new Date();
  return d.getTime() > now.getTime() ? now : d;
}

export const stocktakeService = {
  async list(query: ListStocktakeQuery): Promise<StocktakeListResult> {
    const [{ items, total }, counts] = await Promise.all([
      stocktakeRepository.list(query),
      stocktakeRepository.counts(),
    ]);

    return {
      items: items.map((doc) => toView(doc)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      counts,
    };
  },

  async detail(id: string): Promise<StocktakeDocView> {
    const doc = await stocktakeRepository.findById(id);
    if (!doc) throw new NotFoundError("找不到这张盘点单");

    const [afterBySku, codes] = await Promise.all([
      doc.locationId && doc.snapshotAt
        ? stocktakeRepository.afterQtyBySku(doc.locationId, doc.snapshotAt, doc.id)
        : Promise.resolve(new Map<string, number>()),
      stocktakeRepository.listInstancesByItemIds(doc.items.map((i) => i.id)),
    ]);

    const codesByItem = new Map<string, string[]>();
    for (const row of codes) {
      if (!row.stocktakeItemId) continue;
      const list = codesByItem.get(row.stocktakeItemId) ?? [];
      list.push(row.code);
      codesByItem.set(row.stocktakeItemId, list);
    }

    return toView(doc, afterBySku, codesByItem);
  },

  async meta(): Promise<StocktakeMeta> {
    const locs = await stocktakeRepository.locations();
    const earliest = new Date(Date.now() - 7 * 86_400_000);
    return {
      locations: locs.map(toLocation),
      now: nowLocalDateTime(),
      earliest: formatLocalDateTime(earliest),
    };
  },

  /**
   * 生成盘点表：列出这个仓位在截止时点账面不为零的所有款。
   * 另外附带「截止后变动」，让数货的人知道：现在系统上的数字和账面不一样，
   * 是因为你数的这段时间又出入了一些货，不是你数错了。
   */
  async sheet(params: { locationId: string; snapshotAt?: string }): Promise<StocktakeSheet> {
    const location = await stocktakeRepository.location(params.locationId);
    if (!location) throw new NotFoundError("找不到这个仓位，请刷新后重选");

    const snapshotAt = parseSnapshot(params.snapshotAt) ?? new Date();

    const [bookMap, afterMap] = await Promise.all([
      stocktakeRepository.bookQtyBySku(location.id, snapshotAt),
      stocktakeRepository.afterQtyBySku(location.id, snapshotAt),
    ]);

    const skuIds = [...new Set([...bookMap.keys(), ...afterMap.keys()])].filter(
      (skuId) => (bookMap.get(skuId) ?? 0) !== 0 || (afterMap.get(skuId) ?? 0) !== 0,
    );

    const infos = await stocktakeRepository.skuInfoByIds(skuIds);
    const customSkuIds = infos.filter((i) => i.variantType === "custom").map((i) => i.id);

    const present =
      customSkuIds.length > 0
        ? await stocktakeRepository.instancesPresentAt(location.id, customSkuIds)
        : [];

    const holderItemIds = [
      ...new Set(
        present
          .flatMap((i) => [i.stocktakeItemId, i.outboundItemId])
          .filter((v): v is string => !!v),
      ),
    ];
    const holders = new Map(
      (await stocktakeRepository.findHolderDocNosByItemIds(holderItemIds)).map((r) => [
        r.id,
        r.document.docNo,
      ]),
    );

    const instancesBySku = new Map<string, StocktakeSheetRow["instances"]>();
    for (const row of present) {
      // 只有在库的件才可能被出库草稿占着；退回次品区的件保留历史出库记录，但不算占用
      const holderItemId =
        row.stocktakeItemId ?? (row.status === "in_stock" ? row.outboundItemId : null);
      const list = instancesBySku.get(row.skuId) ?? [];
      list.push({
        id: row.id,
        code: row.code,
        productionDate: row.productionDate ? formatDateOnly(row.productionDate) : null,
        reservedBy: holderItemId ? (holders.get(holderItemId) ?? "另一张单据") : null,
      });
      instancesBySku.set(row.skuId, list);
    }

    const rows: StocktakeSheetRow[] = infos
      .map((info) => ({
        skuId: info.id,
        productId: info.product.id,
        productName: info.product.name,
        unit: info.product.unit || UNIT_FALLBACK,
        colorName: info.colorName,
        variantType: info.variantType === "custom" ? ("custom" as const) : ("normal" as const),
        bookQty: bookMap.get(info.id) ?? 0,
        afterQty: afterMap.get(info.id) ?? 0,
        instances: instancesBySku.get(info.id) ?? [],
      }))
      .sort((a, b) => {
        const byName = a.productName.localeCompare(b.productName, "zh-CN");
        if (byName !== 0) return byName;
        return (a.colorName ?? "").localeCompare(b.colorName ?? "", "zh-CN");
      });

    return {
      location: toLocation(location),
      snapshotAt: snapshotAt.toISOString(),
      rows,
      bookTotal: rows.reduce((s, r) => s + r.bookQty, 0),
      afterTotal: rows.reduce((s, r) => s + r.afterQty, 0),
    };
  },

  /**
   * 建盘点单。账面数一律由后端按截止时点算，前端只提交「实盘数」。
   * 定制款的盘亏必须落到具体件上：一件一个编号，说「少了 1 件」等于没说少的是哪件。
   */
  async create(input: CreateStocktakeInput, actor: { userId: string }): Promise<StocktakeDocView> {
    const snapshotAt = parseSnapshot(input.snapshotAt);
    if (!snapshotAt) throw new ValidationError("截止时点格式不对，请重新选择");
    if (parseLocalDateTime(input.snapshotAt)!.getTime() > Date.now()) {
      throw new ValidationError("截止时点不能晚于现在——还没到的时刻数不出实物");
    }

    const location = await stocktakeRepository.location(input.locationId);
    if (!location) throw new NotFoundError("找不到这个仓位，请刷新后重选");

    const other = await stocktakeRepository.findOtherDraft(location.id, null);
    if (other) {
      throw new ConflictError(
        `「${location.name}」已经有一张盘点草稿（${other.docNo}）还没审核。先把它审掉或删掉——两张草稿按同一个账面各调一次，差异会被算两遍`,
      );
    }

    const bookMap = await stocktakeRepository.bookQtyBySku(location.id, snapshotAt);
    const infos = await stocktakeRepository.skuInfoByIds(input.items.map((i) => i.skuId));
    const infoMap = new Map(infos.map((i) => [i.id, i]));

    const customSkuIds = infos.filter((i) => i.variantType === "custom").map((i) => i.id);
    const present =
      customSkuIds.length > 0
        ? await stocktakeRepository.instancesPresentAt(location.id, customSkuIds)
        : [];
    const presentBySku = new Map<string, Map<string, (typeof present)[number]>>();
    for (const row of present) {
      const m = presentBySku.get(row.skuId) ?? new Map();
      m.set(row.id, row);
      presentBySku.set(row.skuId, m);
    }
    const holders = new Map(
      (
        await stocktakeRepository.findHolderDocNosByItemIds(
          present
            .flatMap((i) => [i.stocktakeItemId, i.outboundItemId])
            .filter((v): v is string => !!v),
        )
      ).map((r) => [r.id, r.document.docNo]),
    );

    for (const [index, item] of input.items.entries()) {
      const lineNo = index + 1;
      const info = infoMap.get(item.skuId);
      if (!info) throw new ValidationError(`第 ${lineNo} 行的商品颜色已被删除，请重新选择`);

      const label = rowLabel(lineNo, info);
      const bookQty = bookMap.get(item.skuId) ?? 0;
      const isCustom = info.variantType === "custom";
      const picked = item.instanceIds ?? [];
      const diff = item.countedQty - bookQty;

      if (isCustom) {
        if (diff > 0) {
          throw new ValidationError(
            `${label}是定制款，每一件都有唯一编号，账上没有的件不会凭空多出来。如果确实多出一件，先查是不是放在别的仓位，或者这张入库单还没录`,
          );
        }
        if (diff < 0) {
          if (picked.length !== -diff) {
            throw new ValidationError(
              `${label}账面 ${bookQty} 件、实盘 ${item.countedQty} 件，少了 ${-diff} 件，请勾选少的是哪几件`,
            );
          }
          const avail = presentBySku.get(item.skuId) ?? new Map();
          for (const instanceId of picked) {
            const inst = avail.get(instanceId);
            if (!inst) {
              throw new ValidationError(`${label}选中的件不在「${location.name}」，请刷新后重选`);
            }
            const holderItemId = inst.stocktakeItemId ?? inst.outboundItemId;
            if (holderItemId) {
              throw new ConflictError(
                `${label}的 ${inst.code} 已经被 ${holders.get(holderItemId) ?? "另一张单据"} 占用（出库草稿已拣货，或另一张盘点单判了盘亏）。先处理那边，再来盘这一件`,
              );
            }
          }
        }
      } else if (picked.length > 0) {
        throw new ValidationError(`${label}是常规款，按数量盘就行，不用一件件勾`);
      }
    }

    const totalQty = input.items.reduce((sum, i) => sum + i.countedQty, 0);
    const bizDate = new Date(snapshotAt);
    bizDate.setHours(0, 0, 0, 0);

    const created = await prisma.$transaction(async (tx) => {
      const otherInTx = await stocktakeRepository.findOtherDraft(location.id, null, tx);
      if (otherInTx) {
        throw new ConflictError(
          `「${location.name}」刚有人开了一张盘点草稿（${otherInTx.docNo}），请先把那张处理完`,
        );
      }

      const docNo = await stocktakeRepository.nextDocNo(bizDate, tx);

      const { id, items: createdItems } = await stocktakeRepository.createDoc(
        {
          docNo,
          type: "stocktake",
          status: "draft",
          bizDate,
          snapshotAt,
          locationId: location.id,
          remark: input.remark?.trim() || null,
          itemCount: input.items.length,
          totalQty,
          createdById: actor.userId,
        },
        input.items.map((item, index) => ({
          skuId: item.skuId,
          lineNo: index + 1,
          qty: item.countedQty,
          // 账面数以服务端为准，前端传什么都不看
          bookQty: bookMap.get(item.skuId) ?? 0,
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

        const locked = await stocktakeRepository.lockInstancesToItem(picked, itemId, tx);
        if (locked.count !== picked.length) {
          throw new ConflictError("有一件货刚被别人判为盘亏，请刷新后重选");
        }
      }

      if (input.approveNow) {
        await approveInTx(tx, id, actor.userId);
      }

      return id;
    });

    return stocktakeService.detail(created);
  },

  async approve(id: string, actor: { userId: string }): Promise<StocktakeDocView> {
    await prisma.$transaction(async (tx) => {
      await approveInTx(tx, id, actor.userId);
    });

    return stocktakeService.detail(id);
  },

  /** 删草稿：判为盘亏的件自动解锁（外键 SetNull） */
  async remove(id: string, actor: { userId: string }): Promise<void> {
    const doc = await stocktakeRepository.findById(id);
    if (!doc) throw new NotFoundError("找不到这张盘点单");
    if (doc.status === "approved") {
      throw new ConflictError("已生效的盘点单不能删除。要更正只能再盘一次，差异会重新算出来");
    }

    await prisma.$transaction(async (tx) => {
      await stocktakeRepository.deleteDraft(id, tx);
    });

    await writeAudit(actor.userId, "stocktake.delete", id, `删除盘点草稿「${doc.docNo}」`);
  },
};

/**
 * 审核的实际动作（必须在事务内调用）：
 * 1. 重算账面：截止时点之前录入的流水合计
 * 2. 完整性：账面上有货的款一个都不能漏，漏了就等于不知道那些货还在不在
 * 3. 按行落差异：差异流水的时间锚在「截止时点」，这样截止之后发生的出入库
 *    会叠在修正后的基数上，而不是被这次修正冲掉
 * 4. 常规款盘盈建批次、盘亏按先产后走扣批次；定制款盘亏把件置为盘亏
 * 5. 单据置为已生效
 */
async function approveInTx(tx: Prisma.TransactionClient, id: string, userId: string): Promise<void> {
  const doc = await stocktakeRepository.findForApprove(id, tx);
  if (!doc) throw new NotFoundError("找不到这张盘点单");
  if (doc.status === "approved") throw new ConflictError("这张盘点单已经审核过了，无需重复操作");
  if (doc.status === "voided") throw new ConflictError("已作废的单据不能审核");
  if (!doc.snapshotAt) throw new ValidationError("这张盘点单没有截止时点，请删掉重新建");
  if (!doc.locationId || !doc.location) {
    throw new ValidationError("这张盘点单没有指定仓位，请删掉重新建");
  }

  const location = doc.location;
  const snapshotAt = doc.snapshotAt;
  const bookMap = await stocktakeRepository.bookQtyBySku(location.id, snapshotAt, tx);

  // 完整性：账面不为零的款必须都在单子里
  const inDoc = new Set(doc.items.map((i) => i.skuId));
  const missing = [...bookMap.entries()].filter(([skuId, qty]) => qty !== 0 && !inDoc.has(skuId));
  if (missing.length > 0) {
    const infos = await stocktakeRepository.skuInfoByIds(missing.slice(0, 3).map(([skuId]) => skuId));
    const names = infos.map((i) =>
      `${skuText({ colorName: i.colorName, product: i.product })}(账面 ${bookMap.get(i.id) ?? 0})`,
    );
    throw new ConflictError(
      `这张单还不完整：${names.join("、")}${missing.length > 3 ? ` 等 ${missing.length} 个款` : ""} 账面上还有货，但没在单子里盘。账面上有货的行必须都盘一遍，否则少掉的货没人知道`,
    );
  }

  for (const item of doc.items) {
    const label = rowLabel(item.lineNo, item.sku);
    const bookStored = item.bookQty ?? 0;
    const bookNow = bookMap.get(item.skuId) ?? 0;

    // 账面数在盘点期间被补录的单据改动了 → 这张单的差异已经不可信
    if (bookStored !== bookNow) {
      throw new ConflictError(
        `${label}的账面数变了（建单时 ${bookStored}，现在 ${bookNow}）：盘点期间有人补录了截止时点之前的单据。请删掉这张草稿，重新生成盘点表`,
      );
    }

    const diff = item.qty - bookStored;
    if (diff === 0) continue;

    const isCustom = item.sku.variantType === "custom";

    if (isCustom) {
      if (diff > 0) {
        throw new ValidationError(
          `${label}是定制款，每一件都有唯一编号，账上没有的件不会凭空多出来。请核对后改实盘数`,
        );
      }

      const picked = item.stocktakeInstances;
      if (picked.length !== -diff) {
        throw new ConflictError(
          `${label}账面 ${bookStored} 件、实盘 ${item.qty} 件，少了 ${-diff} 件，要勾选少的是哪几件才能审核`,
        );
      }

      for (const inst of picked) {
        if (!PRESENT_INSTANCE_STATUSES.includes(inst.status)) {
          throw new ConflictError(
            `${label}的 ${inst.code} 已经${instanceStatusLabel(inst.status)}，不在库里，不能算盘亏`,
          );
        }
        if (inst.stocktakeItemId !== item.id) {
          throw new ConflictError(`${label}的 ${inst.code} 没有被这一行锁定，请刷新后重新保存`);
        }
        if (inst.locationId !== location.id) {
          throw new ConflictError(`${label}的 ${inst.code} 不在「${location.name}」，不能在这里盘亏`);
        }
      }

      await stocktakeRepository.markInstancesMissing(
        picked.map((i) => i.id),
        tx,
      );

      for (const inst of picked) {
        await stocktakeRepository.createMovement(
          {
            skuId: item.skuId,
            locationId: location.id,
            qtyDelta: -1,
            bizType: BIZ_TYPE,
            documentId: doc.id,
            documentItemId: item.id,
            // 单件不进批次：批次只跟常规款的数量走
            batchId: null,
            itemInstanceId: inst.id,
            occurredAt: snapshotAt,
            createdById: userId,
            note: `盘亏 · 单件 ${inst.code}`,
          },
          tx,
        );
      }

      continue;
    }

    if (location.isSellable) {
      if (diff > 0) {
        const batchNo = `${GAIN_BATCH_PREFIX}${formatCompactDate(snapshotAt)}`;
        const batch = await stocktakeRepository.createOrGetBatch(item.skuId, batchNo, diff, tx);
        await stocktakeRepository.createMovement(
          {
            skuId: item.skuId,
            locationId: location.id,
            qtyDelta: diff,
            bizType: BIZ_TYPE,
            documentId: doc.id,
            documentItemId: item.id,
            batchId: batch.id,
            occurredAt: snapshotAt,
            createdById: userId,
            note: `盘盈 · 批次 ${batchNo}`,
          },
          tx,
        );
      } else {
        // 盘亏按「先产的先走」扣，和出库的批次顺序保持一致
        let remaining = -diff;
        const batches = await stocktakeRepository.listBatchesWithStock(item.skuId, tx);
        for (const batch of batches) {
          if (remaining <= 0) break;
          const take = Math.min(batch.quantity, remaining);
          await stocktakeRepository.decrementBatch(batch.id, take, tx);
          await stocktakeRepository.createMovement(
            {
              skuId: item.skuId,
              locationId: location.id,
              qtyDelta: -take,
              bizType: BIZ_TYPE,
              documentId: doc.id,
              documentItemId: item.id,
              batchId: batch.id,
              occurredAt: snapshotAt,
              createdById: userId,
              note: `盘亏 · 批次 ${batch.batchNo}`,
            },
            tx,
          );
          remaining -= take;
        }
        if (remaining > 0) {
          // 有没归批的货（入库时没填生产日期），批次不够扣，剩下的走无批次流水
          await stocktakeRepository.createMovement(
            {
              skuId: item.skuId,
              locationId: location.id,
              qtyDelta: -remaining,
              bizType: BIZ_TYPE,
              documentId: doc.id,
              documentItemId: item.id,
              batchId: null,
              occurredAt: snapshotAt,
              createdById: userId,
              note: "盘亏 · 无批次",
            },
            tx,
          );
        }
      }
    } else {
      // 次品区 / 报废区不进批次，只记数量
      await stocktakeRepository.createMovement(
        {
          skuId: item.skuId,
          locationId: location.id,
          qtyDelta: diff,
          bizType: BIZ_TYPE,
          documentId: doc.id,
          documentItemId: item.id,
          batchId: null,
          occurredAt: snapshotAt,
          createdById: userId,
          note: diff > 0 ? "盘盈" : "盘亏",
        },
        tx,
      );
    }
  }

  await stocktakeRepository.markApproved(doc.id, userId, tx);
  await writeAudit(userId, "stocktake.approve", doc.id, `盘点单「${doc.docNo}」审核生效`, tx);
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
