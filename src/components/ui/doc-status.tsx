import { Badge, type BadgeTone } from "./badge";
import { DOC_STATUS_LABEL, type DocStatus } from "@/modules/document/document.types";

/**
 * 单据状态徽章。
 *
 * 颜色语义全站统一：草稿=黄（提醒你还没生效）、已生效=绿、已作废=灰。
 * hint 是补在后面的半句人话——「·未入账」「·未扣库存」比单说「草稿」有用得多，
 * 因为它回答的是"这事儿到底有没有落到账上"。
 *
 * 注意：hint 不降透明度。视觉上差一档可以用字重解决，用 opacity 会让小字
 * 直接掉到 AA 以下，而对比度扫描器读的是 color，查不出来。
 */
const TONE: Record<DocStatus, BadgeTone> = {
  draft: "warn",
  approved: "ok",
  voided: "neutral",
};

export function DocStatusBadge({ status, hint }: { status: DocStatus; hint?: string }) {
  return (
    <Badge tone={TONE[status]}>
      {DOC_STATUS_LABEL[status]}
      {hint ? <span className="font-normal">· {hint}</span> : null}
    </Badge>
  );
}
