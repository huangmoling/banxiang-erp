import "server-only";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { instanceStatusLabel } from "./document.types";
import { voidRepository as repo, type Db } from "./void.repository";

/**
 * 红冲（作废已生效单据）。
 *
 * 三条规矩，改代码前先看：
 * 1. **不删、不改原始流水**。冲单 = 补一套反向流水，两笔并排留着，谁什么时候冲的都能查。
 * 2. **反向流水沿用原 bizType**，只是数量反号。库存是流水求和，账自然退回去；
 *    而「本月入库/出库」这类作业量统计按方向取绝对值，反向流水不会把历史数字抵消掉
 *    —— 8 号确实入了 10 件，这个事实不因为后来冲单就消失。
 * 3. **冲单时间是「现在」，业务日期仍是原单日期**。这样月度报表落在原期间，
 *    而盘点按录入时间切账面时，这次更正会正确落进「截止后变动」。
 */

const VOIDABLE_TYPES = new Set(["inbound", "outbound", "return", "scrap"]);

const TYPE_LABEL: Record<string, string> = {
  inbound: "入库单",
  outbound: "出库单",
  return: "退货单",
  scrap: "报废/处置单",
  stocktake: "盘点单",
};

type Actor = { userId: string };

type VoidDoc = NonNullable<Awaited<ReturnType<typeof repo.findForVoid>>>;
type VoidItem = VoidDoc["items"][number];

export const voidService = {
  /**
   * 红冲一张已生效单据。调用方负责权限（只给 admin / manager）。
   * 整个动作在一个事务里：任何一行冲不动，整张单都不动，不会留下半截账。
   */
  async voidDocument(id: string, actor: Actor, reason: string) {
    const clean = (reason ?? "").trim();
    if (clean.length < 2) {
      throw new ValidationError("请写一句红冲原因（至少 2 个字）：以后翻账要能看懂当时为什么冲");
    }
    if (clean.length > 200) {
      throw new ValidationError("红冲原因太长，200 字以内就好");
    }

    const result = await prisma.$transaction(async (tx) => {
      const doc = await repo.findForVoid(id, tx);
      if (!doc) throw new NotFoundError("找不到这张单据");

      guardVoidable(doc);

      switch (doc.type) {
        case "inbound":
          await voidInbound(doc, actor, tx);
          break;
        case "outbound":
          await voidOutbound(doc, actor, tx);
          break;
        case "return":
          await voidReturn(doc, actor, tx);
          break;
        case "scrap":
          await voidScrap(doc, actor, tx);
          break;
        default:
          throw new ValidationError("这张单据不支持红冲");
      }

      const voided = await repo.markVoided(doc.id, actor.userId, clean, tx);
      await writeAudit(
        actor.userId,
        `${doc.type}.void`,
        doc.id,
        `红冲${TYPE_LABEL[doc.type] ?? "单据"}「${doc.docNo}」：${clean}`,
        tx,
      );
      return { id: voided.id, docNo: voided.docNo };
    });

    return { ...result, status: "voided" as const };
  },
};

function guardVoidable(doc: VoidDoc): void {
  if (doc.type === "stocktake") {
    throw new ValidationError(
      "盘点单不支持红冲：盘点本身就是一张修正单，冲掉它等于账又回去了。要更正请再盘一次，新的差异会重新算出来",
    );
  }
  if (!VOIDABLE_TYPES.has(doc.type)) {
    throw new ValidationError("这张单据不支持红冲");
  }
  if (doc.status === "voided") {
    throw new ConflictError(`「${doc.docNo}」已经红冲过了，不用再冲一次`);
  }
  if (doc.status !== "approved") {
    throw new ConflictError("只有已生效的单据才能红冲。草稿直接用「删除」清掉就行，它本来就没动过库存");
  }
}

/* ------------------------------------------------------------------ 入库 */

/**
 * 入库红冲 = 把这批货从账上退掉。
 * 前提是货还在：已经发出去的，必须先把出库单冲掉，否则会把库存减成负数。
 */
async function voidInbound(doc: VoidDoc, actor: Actor, tx: Db): Promise<void> {
  const location = doc.location;
  if (!location) {
    throw new ValidationError("这张入库单没有记录入库仓位，红冲不了——账不知道从哪个仓位退");
  }

  for (const item of doc.items) {
    const label = itemLabel(item);
    const unit = unitOf(item);

    if (item.sku.variantType === "custom") {
      const insts = await repo.instancesOfInboundItem(doc.id, item.id, item.skuId, tx);
      if (insts.length !== item.qty) {
        throw new ConflictError(
          `${label}是定制款，单据上数量 ${item.qty} 件，但系统里只找到 ${insts.length} 个件号，数据对不上，请人工核对后再冲`,
        );
      }
      for (const inst of insts) {
        if (inst.status !== "in_stock") {
          throw new ConflictError(
            `${label}的 ${inst.code} 现在${instanceStatusLabel(inst.status)}，不在库，冲不掉。要冲这张入库单，先把它下游的单据（出库 / 退货 / 报废）冲掉`,
          );
        }
        if (inst.outboundItemId || inst.stocktakeItemId || inst.disposalItemId) {
          throw new ConflictError(
            `${label}的 ${inst.code} 正被另一张草稿单占用，先把那张草稿删掉再来冲`,
          );
        }
      }

      for (const inst of insts) {
        await repo.createMovement(
          {
            skuId: item.skuId,
            locationId: location.id,
            qtyDelta: -1,
            bizType: "inbound",
            documentId: doc.id,
            documentItemId: item.id,
            batchId: null,
            itemInstanceId: inst.id,
            occurredAt: doc.bizDate,
            createdById: actor.userId,
            note: `红冲 · ${inst.code} 作废`,
          },
          tx,
        );
      }
      await repo.setInstanceState(
        insts.map((i) => i.id),
        { status: "voided", locationId: null },
        tx,
      );
      continue;
    }

    // 常规款：这个仓位现在还剩多少？货要是已经走了就不能硬减
    const onHand = await repo.qtyAt(item.skuId, location.id, tx);
    if (onHand < item.qty) {
      throw new ConflictError(
        `${label}在「${location.name}」现在只有 ${onHand} ${unit}，这张入库单要冲回 ${item.qty} ${unit}。货已经出库或转走了，得先把下游单据冲掉`,
      );
    }

    let batchId: string | null = null;
    const batchNo = (item.batchNo ?? "").split(",")[0]?.trim();
    if (batchNo && location.isSellable) {
      const batch = await repo.batchByNo(item.skuId, batchNo, tx);
      if (!batch) {
        throw new ConflictError(`${label}对应的批次 ${batchNo} 已经不在了，无法红冲`);
      }
      if (batch.quantity < item.qty) {
        throw new ConflictError(
          `${label}的批次 ${batchNo} 只剩 ${batch.quantity} ${unit}，冲不回 ${item.qty} ${unit}。这批货已经发出去了，先把出库单冲掉`,
        );
      }
      await repo.addBatchQty(batch.id, -item.qty, tx);
      batchId = batch.id;
    }

    await repo.createMovement(
      {
        skuId: item.skuId,
        locationId: location.id,
        qtyDelta: -item.qty,
        bizType: "inbound",
        documentId: doc.id,
        documentItemId: item.id,
        batchId,
        occurredAt: doc.bizDate,
        createdById: actor.userId,
        note: `红冲 · 从「${location.name}」冲回${batchNo ? `（批次 ${batchNo}）` : ""}`,
      },
      tx,
    );
  }
}

/* ------------------------------------------------------------------ 出库 */

/**
 * 出库红冲 = 货退回仓库。
 * 有退货单挂在这张单上时不让冲：退货是按这张单的行算「已退 ≤ 已发」的，
 * 单先作废了，退货就失去了锚点。
 */
async function voidOutbound(doc: VoidDoc, actor: Actor, tx: Db): Promise<void> {
  const returned = await repo.returnCountOf(doc.id, tx);
  if (returned > 0) {
    throw new ConflictError(
      `这张出库单上挂着 ${returned} 张退货单，不能直接冲。请先冲掉退货单——退货的「已退数量」是算在这张单的行上的，单先作废了就对不上账`,
    );
  }
  if (doc.movements.length === 0) {
    throw new ConflictError("这张出库单没有库存流水，数据异常，请人工核对");
  }

  for (const mv of doc.movements) {
    await repo.createMovement(
      {
        skuId: mv.skuId,
        locationId: mv.locationId,
        // 出库是负数，冲回来就是正数；跨批拆出的多条流水逐条对上原批次
        qtyDelta: -mv.qtyDelta,
        bizType: mv.bizType,
        documentId: doc.id,
        documentItemId: mv.documentItemId ?? null,
        batchId: mv.batchId,
        itemInstanceId: mv.itemInstanceId,
        occurredAt: doc.bizDate,
        createdById: actor.userId,
        note: `红冲 · 货退回「${doc.location?.name ?? "原仓位"}」`,
      },
      tx,
    );

    if (mv.batchId) {
      await repo.addBatchQty(mv.batchId, -mv.qtyDelta, tx);
    }
  }

  // 定制件：从「已出库」回到原仓位，并释放出库行的占用
  for (const mv of doc.movements) {
    if (!mv.itemInstanceId) continue;
    await repo.setInstanceState(
      [mv.itemInstanceId],
      { status: "in_stock", locationId: mv.locationId, outboundItemId: null },
      tx,
    );
  }
}

/* ------------------------------------------------------------------ 退货 */

/**
 * 退货红冲 = 把退回来的货再退出去。
 * 去向仓位要扣得回来：如果次品区那几件已经被「线下出售 / 自行处理」消化掉了，
 * 就先冲那张处置单，不能让次品区出现负数。
 */
async function voidReturn(doc: VoidDoc, actor: Actor, tx: Db): Promise<void> {
  if (doc.movements.length === 0) {
    throw new ConflictError("这张退货单没有库存流水，数据异常，请人工核对");
  }

  const insts = await repo.instancesOfDocument(doc.id, tx);
  for (const inst of insts) {
    if (inst.status === "sold_offline" || inst.status === "disposed") {
      throw new ConflictError(
        `这件 ${inst.code} 已经${instanceStatusLabel(inst.status)}，货不在仓里了，冲不回「已出库」。请先冲掉那张处置单`,
      );
    }
    if (!["defective", "scrapped", "returned"].includes(inst.status)) {
      throw new ConflictError(
        `这件 ${inst.code} 现在${instanceStatusLabel(inst.status)}，不是退货后的状态，冲不了`,
      );
    }
  }

  for (const mv of doc.movements) {
    const qty = Math.abs(mv.qtyDelta);
    const onHand = await repo.qtyAt(mv.skuId, mv.locationId, tx);
    if (onHand < qty) {
      const locName = await locationName(mv.locationId, tx);
      throw new ConflictError(
        `「${locName}」里这个款只剩 ${onHand} 件，这张退货单当时退进来 ${qty} 件，退不回去了。货可能已经被报废或线下出售，先把那张单冲掉`,
      );
    }

    await repo.createMovement(
      {
        skuId: mv.skuId,
        locationId: mv.locationId,
        qtyDelta: -qty,
        bizType: mv.bizType,
        documentId: doc.id,
        documentItemId: mv.documentItemId ?? null,
        batchId: mv.batchId,
        itemInstanceId: mv.itemInstanceId,
        occurredAt: doc.bizDate,
        createdById: actor.userId,
        note: `红冲 · 从未${mv.batchId ? "良品架" : "可售区"}退出`,
      },
      tx,
    );

    if (mv.batchId) {
      await repo.addBatchQty(mv.batchId, -qty, tx);
    }
  }

  // 原出库行的「已退数量」要退回去，否则这张单永远退不了第二次
  for (const item of doc.items) {
    if (!item.originItemId) continue;
    await repo.reduceReturnedQty(item.originItemId, item.qty, tx);
  }

  // 定制件：从次品区 / 报废 / 待检 回到「已出库」，离开仓位
  await repo.setInstanceState(
    insts.map((i) => i.id),
    { status: "outbound", locationId: null, returnItemId: null },
    tx,
  );
}

/* ------------------------------------------------------- 报废 / 处置单 */

/**
 * 报废与处置红冲 = 货回到处置前的仓位。
 * 转报废的那部分还要从报废区扣回来（报废区也是仓位，账要平）。
 */
async function voidScrap(doc: VoidDoc, actor: Actor, tx: Db): Promise<void> {
  const source = doc.location;
  if (!source) {
    throw new ValidationError("这张处置单没有记录源仓位，红冲不了");
  }
  if (doc.movements.length === 0) {
    throw new ConflictError("这张处置单没有库存流水，数据异常，请人工核对");
  }

  const insts = await repo.instancesOfDocument(doc.id, tx);

  for (const mv of doc.movements) {
    // 报废区那一条是正数（货进了报废区），反向要扣回来；
    // 源仓位那一条是负数，反向就是加回去。
    if (mv.qtyDelta > 0) {
      const onHand = await repo.qtyAt(mv.skuId, mv.locationId, tx);
      if (onHand < mv.qtyDelta) {
        const locName = await locationName(mv.locationId, tx);
        throw new ConflictError(
          `「${locName}」里这一款只剩 ${onHand} 件，这张单当时报进去 ${mv.qtyDelta} 件，扣不回来了`,
        );
      }
    }

    await repo.createMovement(
      {
        skuId: mv.skuId,
        locationId: mv.locationId,
        qtyDelta: -mv.qtyDelta,
        bizType: mv.bizType,
        documentId: doc.id,
        documentItemId: mv.documentItemId ?? null,
        batchId: mv.batchId,
        itemInstanceId: mv.itemInstanceId,
        occurredAt: doc.bizDate,
        createdById: actor.userId,
        note: `红冲 · 退回「${source.name}」`,
      },
      tx,
    );

    if (mv.batchId) {
      await repo.addBatchQty(mv.batchId, -mv.qtyDelta, tx);
    }
  }

  // 件回到处置前的身份：源仓位是次品区就当次品，是主仓就当在库
  const restored = source.type === "defective" ? "defective" : "in_stock";
  await repo.setInstanceState(
    insts.map((i) => i.id),
    { status: restored, locationId: source.id, disposalItemId: null },
    tx,
  );
}

/* ------------------------------------------------------------------ 工具 */

function itemLabel(item: VoidItem): string {
  const color = item.sku.colorName?.trim() ? item.sku.colorName : "无颜色";
  return `第 ${item.lineNo} 行「${item.sku.product.name} · ${color}」`;
}

function unitOf(item: VoidItem): string {
  return item.sku.product.unit || "件";
}

async function locationName(id: string, tx: Db): Promise<string> {
  const loc = await tx.location.findUnique({ where: { id }, select: { name: true } });
  return loc?.name ?? "未知仓位";
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
    // 审计写失败不能把已经冲好的账回滚掉
  }
}
