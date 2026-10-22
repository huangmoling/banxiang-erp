import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { instanceStatusLabel } from "@/modules/document/document.types";

/**
 * 入库单「彻底删除」——管理员专用。
 *
 * 和红冲的区别：
 * - 红冲是**留痕更正**：原单还在、反向流水并排留着，账对了但记录不消失。
 * - 彻底删除是**当作没发生过**：正因为它连流水一起删掉，才配叫「误录」。
 *   单号腾出来、列表里不再占位，「本月入库」也不会再算这一笔。
 *
 * 因此这里把闸门收得很紧，任何一条不满足就整单不动：
 * 1. 只能删入库单（别的单据类型走红冲，不开口子）。
 * 2. 草稿：本来就没生成任何流水，直接删。
 * 3. 已生效：货必须**还在仓里**——常规款按 SKU 在仓位的结存够不够扣，
 *    定制款逐件核对「在库 + 没被别的草稿单占用」。货已经发出去的，
 *    先删/冲下游单据，否则删了这张单库存会变成负数。
 * 4. 已作废（红冲过）：库存早已退回，只需要把残留的件与流水一起清掉。
 *
 * 删除动作本身写审计日志（谁在什么时候删了哪张单），
 * 这样「记录消失」这件事本身仍然留痕。
 */

type Db = Prisma.TransactionClient;

export type PurgeInboundResult = {
  docNo: string;
  /** 这张单带走了多少件货（= 从账上抹掉的入库量） */
  removedQty: number;
  status: "draft" | "approved" | "voided";
};

export const inboundPurgeService = {
  /** 彻底删除一张入库单。调用方负责权限（只给 admin）。 */
  async purge(id: string, actor: { userId: string }): Promise<PurgeInboundResult> {
    const result = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.findUnique({
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
        },
      });

      if (!doc) throw new NotFoundError("找不到这张入库单，可能已经被删掉了");
      if (doc.type !== "inbound") {
        throw new ValidationError("这里只能删入库单。别的单据要更正请用红冲，账才追得回来");
      }

      const totalQty = doc.items.reduce((sum, item) => sum + item.qty, 0);
      const status: "draft" | "approved" | "voided" =
        doc.status === "approved" ? "approved" : doc.status === "voided" ? "voided" : "draft";

      // 草稿：没审核过，一条流水都没有，删了就删了
      if (status === "draft") {
        await tx.document.delete({ where: { id } });
        return { docNo: doc.docNo, removedQty: 0, status };
      }

      if (!doc.location) {
        throw new ValidationError("这张入库单没有记录入库仓位，数据异常，不敢删——账不知道往哪退");
      }
      const location = doc.location;

      // 已生效的单据必须先确认货还在，不然删完库存就成负数了
      if (status === "approved") {
        await assertStockStillThere(tx, doc, location);
      }

      const itemIds = doc.items.map((i) => i.id);

      // 1) 流水全删（已作废的单据这里连同红冲产生的反向流水一起清掉，净效果为零）
      await tx.stockMovement.deleteMany({ where: { documentId: id } });

      // 2) 批次数扣回：只有「已生效」需要，作废时红冲已经扣过了
      if (status === "approved" && location.isSellable) {
        await releaseBatches(tx, doc);
      }

      // 3) 定制件：这些编号是这张单生出来的，单一没它们也就没意义了。
      //    按「明细行」和「来源单据」两路删：早期数据只记了 inboundDocumentId。
      await tx.itemInstance.deleteMany({
        where: { OR: [{ inboundDocumentId: id }, { documentItemId: { in: itemIds } }] },
      });

      // 4) 单据本体（明细由外键级联删除）
      await tx.document.delete({ where: { id } });

      return { docNo: doc.docNo, removedQty: status === "approved" ? totalQty : 0, status };
    });

    await writeAudit(
      actor.userId,
      "inbound.purge",
      id,
      result.status === "draft"
        ? `删除入库草稿「${result.docNo}」`
        : `【管理员彻底删除】入库单「${result.docNo}」，从账上抹掉 ${result.removedQty} 件，单据与流水一并删除`,
    );

    return result;
  },
};

type PurgeItem = {
  id: string;
  skuId: string;
  lineNo: number;
  qty: number;
  batchNo: string | null;
  sku: {
    id: string;
    colorName: string | null;
    variantType: string;
    product: { name: string; unit: string };
  };
};

type PurgeDoc = {
  id: string;
  docNo: string;
  status: string;
  type: string;
  location: { id: string; name: string; type: string; isSellable: boolean } | null;
  items: PurgeItem[];
};

/**
 * 已生效单据的删除前提：货得还在。
 * 常规款按「SKU + 仓位」把同款多行合并后再比（同单里两行同色很常见，
 * 逐行比会让「3 件 + 3 件、仓里只有 4 件」这种情况漏过去）。
 */
async function assertStockStillThere(
  tx: Db,
  doc: PurgeDoc,
  location: { id: string; name: string },
): Promise<void> {
  const demand = new Map<string, { qty: number; label: string; unit: string }>();
  const batchDemand = new Map<string, { batchNo: string; skuId: string; qty: number; label: string; unit: string }>();

  for (const item of doc.items) {
    const label = itemLabel(item);
    const unit = unitOf(item);

    if (item.sku.variantType === "custom") {
      // 两路找件：新数据挂在明细行上，老数据只记了来源单据 + SKU
      const insts = await tx.itemInstance.findMany({
        where: {
          OR: [{ documentItemId: item.id }, { inboundDocumentId: doc.id, skuId: item.skuId }],
        },
        select: {
          id: true,
          code: true,
          status: true,
          outboundItemId: true,
          stocktakeItemId: true,
          disposalItemId: true,
        },
      });

      if (insts.length !== item.qty) {
        throw new ConflictError(
          `${label}是定制款，单据上写 ${item.qty} 件，系统里只找到 ${insts.length} 个件号。数据对不上，请人工核对后再删`,
        );
      }

      for (const inst of insts) {
        if (inst.status !== "in_stock") {
          throw new ConflictError(
            `${label}的 ${inst.code} 现在${instanceStatusLabel(inst.status)}，不在仓里。先把它下游的单据（出库 / 退货 / 报废）处理掉，再来删这张入库单`,
          );
        }
        if (inst.outboundItemId || inst.stocktakeItemId || inst.disposalItemId) {
          throw new ConflictError(`${label}的 ${inst.code} 正被另一张草稿单占用，先把那张草稿删掉再来删这张`);
        }
      }
      continue;
    }

    const acc = demand.get(item.skuId) ?? { qty: 0, label, unit };
    acc.qty += item.qty;
    demand.set(item.skuId, acc);

    const batchNo = (item.batchNo ?? "").split(",")[0]?.trim();
    if (batchNo) {
      const key = `${item.skuId}::${batchNo}`;
      const b = batchDemand.get(key) ?? { batchNo, skuId: item.skuId, qty: 0, label, unit };
      b.qty += item.qty;
      batchDemand.set(key, b);
    }
  }

  for (const [skuId, need] of demand) {
    const agg = await tx.stockMovement.aggregate({
      where: { skuId, locationId: location.id },
      _sum: { qtyDelta: true },
    });
    const onHand = agg._sum.qtyDelta ?? 0;
    if (onHand < need.qty) {
      throw new ConflictError(
        `${need.label}在「${location.name}」现在只有 ${onHand} ${need.unit}，这张入库单当时进来了 ${need.qty} ${need.unit}。货已经被出库或转走了，先处理下游单据（删草稿 / 冲已生效单）再删这张`,
      );
    }
  }

  for (const need of batchDemand.values()) {
    const batch = await tx.batch.findUnique({
      where: { skuId_batchNo: { skuId: need.skuId, batchNo: need.batchNo } },
      select: { id: true, quantity: true },
    });
    if (!batch) {
      throw new ConflictError(`${need.label}对应的批次 ${need.batchNo} 已经不在系统里了，数据异常，请人工核对`);
    }
    if (batch.quantity < need.qty) {
      throw new ConflictError(
        `${need.label}的批次 ${need.batchNo} 只剩 ${batch.quantity} ${need.unit}，这张单当时进来 ${need.qty} ${need.unit}。这批货已经发出去了，先处理出库单`,
      );
    }
  }
}

/** 把这单占掉的批次余量扣回去；扣到 0 且没有其它流水再引用它时，批次本身也删掉 */
async function releaseBatches(tx: Db, doc: PurgeDoc): Promise<void> {
  const bySku = new Map<string, number>();

  for (const item of doc.items) {
    if (item.sku.variantType === "custom") continue;
    const batchNo = (item.batchNo ?? "").split(",")[0]?.trim();
    if (!batchNo) continue;

    const key = `${item.skuId}::${batchNo}`;
    bySku.set(key, (bySku.get(key) ?? 0) + item.qty);
  }

  for (const [key, qty] of bySku) {
    const [skuId, batchNo] = key.split("::");
    if (!skuId || !batchNo) continue;

    const batch = await tx.batch.findUnique({
      where: { skuId_batchNo: { skuId, batchNo } },
      select: { id: true, quantity: true },
    });
    if (!batch) continue;

    const next = batch.quantity - qty;
    await tx.batch.update({ where: { id: batch.id }, data: { quantity: next } });

    if (next <= 0) {
      // 还有别的流水引用这个批次就留着（余量为 0 但历史要用），否则一并清掉
      const refs = await tx.stockMovement.count({ where: { batchId: batch.id } });
      if (refs === 0) await tx.batch.delete({ where: { id: batch.id } });
    }
  }
}

function itemLabel(item: PurgeDoc["items"][number]): string {
  const color = item.sku.colorName?.trim() ? item.sku.colorName : "无颜色";
  return `第 ${item.lineNo} 行「${item.sku.product.name} · ${color}」`;
}

function unitOf(item: PurgeDoc["items"][number]): string {
  return item.sku.product.unit || "件";
}

async function writeAudit(userId: string, action: string, entityId: string, summary: string): Promise<void> {
  try {
    await prisma.auditLog.create({ data: { userId, action, entityType: "document", entityId, summary } });
  } catch {
    // 审计写失败不能把已经删掉的单「复活」回来
  }
}
