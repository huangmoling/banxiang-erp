/**
 * 单据通用类型（入库 / 出库 / 退货 / 盘点共用）。
 * 纯类型与常量，不含任何服务端依赖，客户端组件可直接引用。
 */

export type DocStatus = "draft" | "approved" | "voided";

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  draft: "草稿",
  approved: "已生效",
  voided: "已作废",
};

export const DOC_STATUS_TONE: Record<DocStatus, string> = {
  draft: "bg-warn-soft text-warn",
  approved: "bg-ok-soft text-ok",
  voided: "bg-sunken text-muted",
};

/** 统一把数据库里的字符串收敛成三态，避免脏值让界面炸掉 */
export function toDocStatus(value: string): DocStatus {
  return value === "approved" ? "approved" : value === "voided" ? "voided" : "draft";
}

/**
 * 颜色名只是自由文本（一色一个 SKU，不建词库），空值统一显示成「无颜色」，
 * 避免界面上出现一片空白格。入库 / 出库 / 退货三处共用同一份，别各写一遍。
 */
export function colorText(colorName: string | null): string {
  return colorName?.trim() ? colorName : "无颜色";
}

/**
 * 单件（定制款）的状态文案。
 * 放在通用文件里，是因为出库、退货、盘点、处置、红冲五处都要把状态翻成人话，
 * 各处各写一份必然出现「次品区 / 次品 / 在次品」三种说法。
 */
export const INSTANCE_STATUS_LABEL: Record<string, string> = {
  in_stock: "在库",
  outbound: "已出库",
  returned: "退回待检",
  defective: "在次品区",
  scrapped: "已报废",
  sold_offline: "已线下售出",
  disposed: "已处置",
  missing: "盘亏",
  voided: "已作废",
};

export function instanceStatusLabel(status: string): string {
  return INSTANCE_STATUS_LABEL[status] ?? status;
}

/** 还物理躺在仓位里的件：能被盘点、能被处置、能被算作「看得见」 */
export const PRESENT_INSTANCE_STATUSES = ["in_stock", "defective", "returned"];

/**
 * 单据类型文案。
 * 单号前缀已经区分了类型，但报表、流水里要给人看「采购入库」而不是 "inbound"。
 * 放在通用文件里，报表、库存流水、单据列表共用一份。
 */
export const DOC_TYPE_LABEL: Record<string, string> = {
  inbound: "采购入库",
  outbound: "销售出库",
  return: "退货入库",
  scrap: "报废处置",
  stocktake: "库存盘点",
};

export function docTypeLabel(type: string): string {
  return DOC_TYPE_LABEL[type] ?? type;
}

