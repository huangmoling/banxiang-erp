import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";

/**
 * 数字块。仪表台和报表的第一层信息。
 *
 * mac 风格的做法：标签缩到 12px 灰字，数字放到 30px semibold 并带负字距。
 * 落差全在"字号 + 字重"这一对上，不靠描边框、不靠色块——
 * 上一版四个块长得一模一样、每个都框一圈，看起来像模板，就是因为没有落差。
 *
 * 数字用 tabular-nums（等宽），一行四个的时候千位不会互相错位。
 * 这是「看起来精密」的实质来源，比任何装饰都有效。
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
  /** 主指标（比如今天的待发货）：数字再大一档 */
  emphasize?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="truncate pt-0.5 text-[12px] font-medium text-ink-2">{label}</span>
        {icon ? (
          <span
            className={`-mr-0.5 -mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[5px] ${TONE_ICON[tone]}`}
          >
            {icon}
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 flex items-baseline gap-1">
        <span
          className={`tnum font-semibold leading-none tracking-[-0.03em] ${
            emphasize ? "text-[34px]" : "text-num"
          } ${TONE_TEXT[tone]}`}
        >
          {value}
        </span>
        {unit ? <span className="text-[11.5px] font-medium text-muted">{unit}</span> : null}
        {emphasize ? <Badge tone={tone}>重点</Badge> : null}
      </div>

      {hint ? (
        <div className="mt-1.5 truncate text-[11.5px] leading-relaxed text-muted">{hint}</div>
      ) : null}
    </>
  );

  const base = `card theme-surface block px-3.5 py-3 transition-all duration-200 ${
    href ? "hover:brightness-[1.03] active:scale-[0.995]" : ""
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

/** 图标底板：24% 透明的语义色，玻璃底上不会糊成一块实心 */
const TONE_ICON: Record<BadgeTone, string> = {
  neutral: "bg-ink/6 text-ink-2",
  brand: "bg-brand/12 text-brand-ink",
  ok: "bg-ok/12 text-ok",
  warn: "bg-warn/14 text-warn",
  danger: "bg-danger/12 text-danger",
  custom: "bg-custom/12 text-custom",
};
