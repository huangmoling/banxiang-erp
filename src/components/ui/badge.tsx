import type { ReactNode } from "react";

/**
 * 状态徽章。整个系统的"这批货现在什么状态"都用它，颜色语义固定：
 *   中性 = 草稿 / 未开始      brand = 进行中 / 待处理
 *   ok   = 已生效 / 已完成    warn  = 要注意（待发、待检）
 *   danger = 有问题（缺货、报废）  custom = 定制款（按件追踪）
 *
 * 定制紫是这套系统独有的语义：定制件一物一码、退回不可二次销售，
 * 它不该和普通款挤在同一个灰标签里。
 */
export type BadgeTone = "neutral" | "brand" | "ok" | "warn" | "danger" | "custom";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-sunken text-ink-2",
  brand: "bg-brand-soft text-brand-ink",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  custom: "bg-custom-soft text-custom",
};

const DOT: Record<BadgeTone, string> = {
  neutral: "bg-muted",
  brand: "bg-brand",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  custom: "bg-custom",
};

export function Badge({
  tone = "neutral",
  dot = false,
  children,
  title,
}: {
  tone?: BadgeTone;
  /** 极小状态下加个圆点，比纯文字更容易在长表格里扫到 */
  dot?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-medium leading-5 ${TONE[tone]}`}
      title={title}
    >
      {dot ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone]}`} /> : null}
      {children}
    </span>
  );
}
