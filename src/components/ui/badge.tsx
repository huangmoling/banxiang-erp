import type { ReactNode } from "react";

/**
 * 状态徽章。整个系统的"这批货现在什么状态"都用它，颜色语义固定：
 *   中性 = 草稿 / 未开始      brand = 进行中 / 待处理
 *   ok   = 已生效 / 已完成    warn  = 要注意（待发、待检）
 *   danger = 有问题（缺货、报废）  custom = 定制款（按件追踪）
 *
 * 形态是「圆点 + 文字」，不是彩色胶囊：一屏表格里几十个胶囊会显得软塌塌，
 * 而颜色一多就没人再看颜色。圆点小到不抢视线，但足够在长表格里定位。
 *
 * 定制紫例外——它是"属性"不是"状态"，保留一块极淡的底，成组时更容易认出来。
 *
 * 颜色写在 globals.css 的 .badge-* 里（用 CSS 变量），因为单据详情头是深色的，
 * 同一枚徽章在深底上要换一套亮色（.on-deep 覆盖），用 Tailwind 类做不到。
 */
export type BadgeTone = "neutral" | "brand" | "ok" | "warn" | "danger" | "custom";

export function Badge({
  tone = "neutral",
  dot = true,
  children,
  title,
}: {
  tone?: BadgeTone;
  /** 默认带圆点；纯文字标签传 false */
  dot?: boolean;
  children: ReactNode;
  title?: string;
}) {
  const chip = tone === "custom";
  return (
    <span className={`badge badge-${tone} ${chip ? "badge-chip" : ""}`} title={title}>
      {dot ? <span className="badge-dot" /> : null}
      {children}
    </span>
  );
}
