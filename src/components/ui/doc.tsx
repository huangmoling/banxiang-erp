import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, ArrowRight, Check, CircleAlert, Info } from "lucide-react";
import { Badge, type BadgeTone } from "./badge";

/**
 * 单据页面（建单 / 详情）的共用件。
 *
 * 入库 / 出库 / 退货 / 盘点 四套单据，页头、状态条、单据信息卡、底部操作条
 * 基本都是同一份代码抄了四遍；改一次措辞要改八个文件。
 * 这里只统一"讲同一种事"的部分，字段本身仍由各页决定。
 */

/* ── 页头 ─────────────────────────────────────────────────────────── */

/** 返回箭头。列表 ↔ 单据之间唯一的回路，必须一直在同一个位置 */
export function BackLink({ href, title }: { href: string; title: string }) {
  return (
    <Link
      href={href}
      title={title}
      aria-label={title}
      className="mt-0.5 rounded-md p-1.5 text-muted transition-colors hover:bg-line-2 hover:text-ink"
    >
      <ArrowLeft size={16} />
    </Link>
  );
}

/**
 * 单据标题区：返回 + 主标题 + 状态徽章 + 一行摘要 + 右侧操作。
 *
 * 单号用等宽数字：仓管对单号时是一位一位对的，字宽不齐会看串行。
 */
export function DocTitle({
  backHref,
  backTitle,
  title,
  statusBadge,
  meta,
  actions,
}: {
  backHref: string;
  backTitle: string;
  title: string;
  statusBadge?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <BackLink href={backHref} title={backTitle} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="tnum text-[19px] leading-tight font-semibold tracking-[-0.01em] text-ink">
              {title}
            </h1>
            {statusBadge}
          </div>
          {meta ? <p className="mt-1 text-[12.5px] text-muted">{meta}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ── 状态条 ───────────────────────────────────────────────────────── */

const BAR: Record<"ok" | "warn" | "danger" | "info" | "brand", string> = {
  ok: "border-ok/40 bg-ok-soft text-ok",
  warn: "border-warn/40 bg-warn-soft text-warn",
  danger: "border-danger/30 bg-danger-soft text-danger",
  info: "border-line bg-sunken text-ink-2",
  brand: "border-brand/30 bg-brand-soft text-brand-ink",
};

const BAR_ICON = { ok: Check, warn: CircleAlert, danger: AlertCircle, info: Info, brand: CircleAlert } as const;

/**
 * 一句话说清"这张单现在算不算数"。
 *
 * 仓管看完单号，第二个问题永远是"库存动了没有"。这句必须显眼、必须在折叠之上，
 * 不能只靠右上角一个灰字「草稿」去暗示。
 */
export function StateBar({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "danger" | "info" | "brand";
  children: ReactNode;
}) {
  const Icon = BAR_ICON[tone];
  return (
    <div
      className={`flex items-start gap-2.5 rounded-card border px-3.5 py-3 text-[12.5px] leading-5 ${BAR[tone]}`}
    >
      <Icon size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ── 卡片 ─────────────────────────────────────────────────────────── */

/** 带标题栏的分区卡。明细表、单据信息、规则说明都用它，保证同一页里间距一致 */
export function SectionCard({
  title,
  hint,
  actions,
  children,
  padded = true,
  flush = false,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** padded=false 用于内部自带表格的卡片（表格要贴边） */
  padded?: boolean;
  /** flush 去掉标题栏下边框，用于标题只是分组名、下面还有内容块的情况 */
  flush?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-card shadow-card">
      {title ? (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${
            flush ? "" : "border-b border-line"
          }`}
        >
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
            {hint ? <span className="text-[11.5px] text-muted">{hint}</span> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className={padded ? "p-4 sm:p-5" : ""}>{children}</div>
    </section>
  );
}

/* ── 单据信息 ─────────────────────────────────────────────────────── */

export function InfoRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon?: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 text-[12.5px]">
      {Icon ? (
        <Icon size={14} strokeWidth={1.7} className="mt-0.5 shrink-0 text-muted" />
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <dt className="w-[62px] shrink-0 text-muted">{label}</dt>
      <dd className={`min-w-0 flex-1 break-words text-ink ${mono ? "tnum" : ""}`}>{value}</dd>
    </div>
  );
}

/** 备注块。单据上的备注常带换行（收货地址、破损描述），必须保留 */
export function RemarkBlock({ remark }: { remark: string }) {
  return (
    <div className="mt-3 rounded-lg bg-sunken px-3 py-2.5 text-[12px] leading-5 whitespace-pre-wrap text-ink-2">
      <div className="mb-0.5 text-[11.5px] text-muted">备注</div>
      {remark}
    </div>
  );
}

/** 「再开一张 / 打印」这类去别处的入口条：干完一单接着干下一单，是最常走的路 */
export function AgainLink({
  href,
  icon: Icon = ArrowRight,
  children,
}: {
  href: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between rounded-card border border-line bg-card px-4 py-3 text-[13px] text-ink shadow-card transition-colors hover:border-brand/40 hover:text-brand-ink"
    >
      {children}
      <Icon
        size={14}
        className="text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand-ink"
      />
    </Link>
  );
}

/* ── 建单页 ───────────────────────────────────────────────────────── */

/** 建单页抬头：返回 + 标题 + 「怎么用这一页」一句话 */
export function FormTitle({
  backHref,
  backTitle,
  title,
  description,
  aside,
}: {
  backHref: string;
  backTitle: string;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <BackLink href={backHref} title={backTitle} />
        <div className="min-w-0">
          <h1 className="text-[19px] leading-tight font-semibold tracking-[-0.01em] text-ink">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{description}</p>
          ) : null}
        </div>
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}

/** 表单校验错误。放在页头下面，不弹窗——错误要跟出错的地方同屏 */
export function InlineError({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-card border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[12.5px] leading-5 text-danger">
      <AlertCircle size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * 底部操作条。
 *
 * 建单页很长，按钮必须常在视野里；同时左边那句「N 行 · 合计 X 件」是
 * 保存前最后一道校验——数字不对，人就不用点下去了。
 */
export function FormActionBar({
  summary,
  children,
}: {
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="sticky bottom-0 -mx-4 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="tnum text-[12px] text-muted">{summary}</span>
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
    </div>
  );
}

/**
 * 规则说明卡：审核后会发生什么。
 *
 * 这几条不是装饰——仓管不点审核，是因为不确定点了会怎样。
 * 把后果写在按钮旁边，比写在手册里有用。
 */
export function RuleCard({
  title,
  items,
}: {
  title: string;
  items: ReactNode[];
}) {
  return (
    <section className="rounded-card border border-line bg-sunken px-4 py-3.5 text-[12px] leading-[1.8] text-ink-2">
      <div className="mb-2 text-[12.5px] font-semibold text-ink">{title}</div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5">
            <Check size={13} className="mt-1 shrink-0 text-ok" />
            <span className="min-w-0">{it}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── 小标签 ───────────────────────────────────────────────────────── */

/** 常规款 / 定制款。本系统唯一需要反复区分的商品属性 */
export function VariantTag({ variant }: { variant: "normal" | "custom" }) {
  return variant === "custom" ? (
    <Badge tone="custom">定制·按件</Badge>
  ) : (
    <Badge tone="neutral">常规·按数量</Badge>
  );
}

export type { BadgeTone };
