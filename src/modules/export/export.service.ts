import "server-only";
import { csvResponse, datedFilename, type CsvCell } from "@/lib/csv";
import { formatDateOnly, formatDateTime, parseDateOnly } from "@/lib/date";
import { DOC_STATUS_LABEL, docTypeLabel, instanceStatusLabel, toDocStatus } from "@/modules/document/document.types";
import { inventoryService } from "@/modules/inventory/inventory.service";
import { bizTypeLabel } from "@/modules/inventory/inventory.types";
import { exportRepository } from "./export.repository";

export type ExportKind =
  | "inventory"
  | "batches"
  | "instances"
  | "movements"
  | "documents"
  | "loss";

export const EXPORT_KINDS: ExportKind[] = [
  "inventory",
  "batches",
  "instances",
  "movements",
  "documents",
  "loss",
];

export type ExportQuery = {
  q?: string;
  bizType?: string;
  status?: string;
  type?: string;
  from?: string;
  to?: string;
};

const DISPOSITION_LABEL: Record<string, string> = {
  scrap: "转报废",
  offline_sale: "线下出售",
  self_dispose: "自行处理",
};

/** 日期参数一律按「自然日」理解：只填到日期，等于包含当天整天 */
function rangeOf(from?: string, to?: string): { from?: Date; to?: Date } {
  const start = from ? parseDateOnly(from) : null;
  const endDay = to ? parseDateOnly(to) : null;
  const end = endDay
    ? new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate(), 23, 59, 59, 999)
    : undefined;
  return { from: start ?? undefined, to: end };
}

function variantText(type: string): string {
  return type === "custom" ? "定制款" : "常规款";
}

export const exportService = {
  /**
   * 生成 CSV 下载响应。
   * 导出的是「当前筛选条件下的全部行」，不是当前页——导一半的表比不导更让人恼火。
   */
  async build(kind: ExportKind, query: ExportQuery): Promise<Response> {
    const { from, to } = rangeOf(query.from, query.to);

    switch (kind) {
      case "inventory": {
        const { rows } = await inventoryService.summary({ q: query.q });
        return csvResponse(
          datedFilename("库存明细"),
          ["商品", "颜色", "单位", "规格", "可售在库", "次品区", "报废区", "安全库存", "库存状态", "在库批次", "在库定制件", "最近变动"],
          rows.map((r) => [
            r.productName,
            r.colorName ?? "无颜色",
            r.unit,
            variantText(r.variantType),
            r.onHand,
            r.defective,
            r.scrap,
            r.safetyStock,
            r.isLow ? "低于安全库存" : r.onHand === 0 ? "无库存" : "正常",
            r.batchCount,
            r.customCount,
            r.lastMovedOn ?? "",
          ]),
        );
      }

      case "batches": {
        const rows = await inventoryService.batches({ q: query.q });
        return csvResponse(
          datedFilename("批次明细"),
          ["批次号", "商品", "颜色", "规格", "生产日期", "账龄(天)", "余量", "单位"],
          rows.map((b) => [
            b.batchNo,
            b.productName,
            b.colorName ?? "无颜色",
            variantText(b.variantType),
            b.productionDate ?? "未记录",
            b.ageDays ?? "",
            b.quantity,
            b.unit,
          ]),
        );
      }

      case "instances": {
        const rows = await inventoryService.instances({ q: query.q, status: query.status });
        return csvResponse(
          datedFilename("定制件台账"),
          ["件号", "商品", "颜色", "状态", "所在仓位", "生产日期", "入库单", "入库日期", "出库单", "出库日期", "备注"],
          rows.map((i) => [
            i.code,
            i.productName,
            i.colorName ?? "无颜色",
            instanceStatusLabel(i.status),
            i.locationName ?? "已离仓",
            i.productionDate ?? "",
            i.inboundDocNo ?? "",
            i.inboundDate ?? "",
            i.outboundDocNo ?? "",
            i.outboundDate ?? "",
            i.note ?? "",
          ]),
        );
      }

      case "movements": {
        const page = await inventoryService.movements({
          q: query.q,
          bizType: query.bizType,
          from: query.from,
          to: query.to,
          maxRows: 5000,
        });
        return csvResponse(
          datedFilename("库存流水"),
          ["日期", "业务类型", "商品", "颜色", "仓位", "变动", "单位", "单据号", "单据类型", "单据状态", "批次号", "件号", "红冲", "备注"],
          page.items.map((m) => [
            m.occurredOn,
            m.bizTypeLabel,
            m.productName,
            m.colorName ?? "无颜色",
            m.locationName,
            m.qtyDelta,
            m.unit,
            m.docNo ?? "",
            m.docType ?? "",
            m.docStatus ? DOC_STATUS_LABEL[toDocStatus(m.docStatus)] : "",
            m.batchNo ?? "",
            m.instanceCode ?? "",
            m.reversal ? "是" : "",
            m.note ?? "",
          ]),
        );
      }

      case "documents": {
        const rows = await exportRepository.documents({ type: query.type, from, to });
        return csvResponse(
          datedFilename("单据清单"),
          ["单号", "类型", "状态", "业务日期", "明细行数", "件数", "仓位", "制单", "审核人", "审核时间", "作废时间", "作废原因", "外部单号", "收货人", "备注"],
          rows.map((d) => {
            const cells: CsvCell[] = [
              d.docNo,
              docTypeLabel(d.type),
              DOC_STATUS_LABEL[toDocStatus(d.status)],
              formatDateOnly(d.bizDate),
              d.itemCount,
              d.totalQty,
              d.location?.name ?? "",
              d.createdBy?.displayName ?? "",
              d.approvedBy?.displayName ?? "",
              d.approvedAt ? formatDateTime(d.approvedAt.toISOString()) : "",
              d.voidedAt ? formatDateTime(d.voidedAt.toISOString()) : "",
              d.voidReason ?? "",
              d.externalNo ?? "",
              d.receiverName ?? "",
              d.remark ?? "",
            ];
            return cells;
          }),
        );
      }

      case "loss": {
        const rows = await exportRepository.disposalItems({ from, to });
        return csvResponse(
          datedFilename("损耗台账"),
          ["单号", "业务日期", "单据状态", "商品", "颜色", "规格", "数量", "单位", "处理方式", "源仓位", "制单", "审核人", "备注"],
          rows.map((item) => [
            item.document.docNo,
            formatDateOnly(item.document.bizDate),
            DOC_STATUS_LABEL[toDocStatus(item.document.status)],
            item.sku.product.name,
            item.sku.colorName ?? "无颜色",
            variantText(item.sku.variantType),
            item.qty,
            item.sku.product.unit,
            DISPOSITION_LABEL[item.disposition ?? "scrap"] ?? "转报废",
            item.document.location?.name ?? "",
            item.document.createdBy?.displayName ?? "",
            item.document.approvedBy?.displayName ?? "",
            item.remark ?? "",
          ]),
        );
      }

      default:
        // 走不到这里：kind 已在 schema 里限死，留一个兜底防止将来加类型漏改
        throw new Error(`未知的导出类型：${kind satisfies never}`);
    }
  },
};

/** 导出时业务类型的中文名，页面上的筛选下拉复用 */
export { bizTypeLabel };
