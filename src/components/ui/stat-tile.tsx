import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";

/**
 * 数字块。仪表台和报表的第一层信息。
 *
 * 数字用 tabular-nums（等宽），一行四个的时候千位不会互相错位——这是
 * 「看起来精密」的实质来源，比任何装饰都有效。
 *
 * warn / danger 态可以直接把整个块染成警示色，用于「还有 23 个包裹没发」
 * 这种必须一眼看到的事。
 */
export function StatTile({
  label,
  value,
  unit,
  hint,
  icon,
  tone = "neutral",
  href,
  emphasize = false,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  /** 副文：说明这个数字是怎么来的，或者拆分明细 */
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: BadgeTone;
  href?: string;
  /** 主指标（比如今天的待发货）：数字更大、带品牌色左边条 */
  emphasize?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        {icon ? <span className={`shrink-0 ${TONE_TEXT[tone]}`}>{icon}</span> : null}
        <span className="truncate text-[12.5px] font-medium text-ink-2">{label}</span>
        {emphasize ? <Badge tone={tone}>重点</Badge> : null}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span
          className={`tnum font-semibold leading-none tracking-[-0.02em] ${
            emphasize ? "text-[30px]" : "text-[24px]"
          } ${TONE_TEXT[tone]}`}
        >
          {value}
        </span>
        {unit ? <span className="text-[12px] text-muted">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{hint}</div> : null}
    </>
  );

  const base = `card theme-surface block px-4 py-3.5 ${
    href ? "transition-colors hover:border-brand/40" : ""
  }`;

  if (href) {
    return (
      <Link href={href} className={base}>
        {body}
      </Link>
    );
  }
  return <div className={base}>{body}</div>;
}

const TONE_TEXT: Record<BadgeTone, string> = {
  neutral: "text-ink",
  brand: "text-brand-ink",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  custom: "text-custom",
};
