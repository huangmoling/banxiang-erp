import type { ReactNode } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Search } from "lucide-react";

/**
 * 列表页的共用零件。
 *
 * 商品 / 入库 / 出库 / 退货 / 盘点 五个列表页，筛选条、提示条、分页、空状态
 * 是同一段代码抄了五遍——改一次要改五个文件，还容易改漏一个。
 * 这里只抽"壳"，行内容仍由各页面自己渲染（列差异太大，硬套 schema 更难维护）。
 */

/** 页头下方的第一行：搜索 + 附加控件 + 状态筛选 */
export function ListToolbar({
  search,
  extra,
  filters,
}: {
  search: ReactNode;
  extra?: ReactNode;
  filters?: ReactNode;
}) {
  return (
    <div className="card flex flex-wrap items-center gap-2 p-1.5">
      <div className="min-w-[220px] flex-1">{search}</div>
      {extra}
      {filters}
    </div>
  );
}

/** 带放大镜的搜索框。高度压到 36px，和右侧分段按钮齐平 */
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search
        size={14}
        strokeWidth={2}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
      />
      <input
        className="input h-[34px] py-0 pl-8 text-[12.5px]"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="搜索"
      />
    </div>
  );
}

export type FilterOption<T extends string> = {
  value: T;
  label: string;
  /** 计数徽标；null / 0 不显示 */
  count?: number | null;
  /** danger 用于「待发货」这种该被优先处理的筛选项 */
  tone?: "danger";
};

/**
 * 分段筛选。
 *
 * 原来的选中态是浅蓝底 + 蓝字，在五页里都能用但不够利落：文字一多就像一个
 * 静态标签。现在做成滑块——轨道下沉、滑块浮起，选中的那格是"纸片"，
 * 这是分段控件最容易被一眼认出的形态，且不额外引入颜色。
 *
 * tone="danger" 只染计数徽标，不染标签文字：深色主题下正文红在卡片底上只有
 * 4.42:1，达不到 AA。红数字已经足够说明"这一格有活要干"。
 */
export function SegmentedFilter<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly FilterOption<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="flex items-center gap-[2px] rounded-[9px] bg-ink/[0.06] p-[3px]"
      role="group"
    >
      {options.map((o) => {
        const active = o.value === value;
        const showCount = o.count != null && o.count > 0;
        const danger = o.tone === "danger";

        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center rounded-[7px] px-2.5 py-[3px] text-[12px] whitespace-nowrap transition-all duration-150 ${
              active
                ? "bg-card font-medium text-ink shadow-[0_1px_2px_rgba(16,22,40,0.14),0_0_0_0.5px_rgba(16,22,40,0.04)]"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            {o.label}
            {showCount ? (
              <span
                className={`tnum ml-1.5 rounded-[4px] px-1 text-[10px] leading-[14px] ${
                  danger
                    ? "bg-danger/14 text-danger"
                    : active
                      ? "bg-brand/14 text-brand-ink"
                      : "bg-ink/[0.07] text-muted"
                }`}
              >
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 一条横在列表上方的提示。措辞永远是「有多少、意味着什么、下一步点哪」，
 * 只说「有 N 条待处理」等于把判断推回给用户。
 */
export function NoticeBar({
  tone = "warn",
  children,
  action,
}: {
  tone?: "warn" | "danger";
  children: ReactNode;
  action?: ReactNode;
}) {
  const cls =
    tone === "danger" ? "bg-danger/[0.1] text-danger" : "bg-warn/[0.12] text-warn";

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-[12px] px-3.5 py-2.5 text-[12px] ${cls}`}
    >
      <AlertTriangle size={13} strokeWidth={2.2} className="shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

function pageWindow(page: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: number[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(total - 1, page + 1);
  if (start > 2) out.push(0);
  for (let i = start; i <= end; i += 1) out.push(i);
  if (end < total - 1) out.push(0);
  out.push(total);
  return out;
}

/**
 * 分页条。
 *
 * 原来只有「上一页 / 下一页」，且总数超过一页才出现——仓管想知道"今天一共几张"
 * 还得往下滚到底。现在只要列表非空就显示总条数，页码只在真有多页时出现。
 */
export function Pagination({
  total,
  page,
  pageSize,
  onChange,
  unit = "条",
}: {
  total: number;
  page: number;
  pageSize: number;
  onChange: (p: number) => void;
  /** 计数单位：商品用「款」，单据用「张」 */
  unit?: string;
}) {
  if (total <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const nums = pageWindow(page, totalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-3 py-2 text-[12px] text-muted">
      <span className="tnum">
        共 <span className="font-medium text-ink-2">{total}</span> {unit}
      </span>

      {totalPages > 1 ? (
        <div className="flex items-center gap-0.5">
          <PageArrow disabled={page <= 1} onClick={() => onChange(page - 1)} label="上一页" dir="prev" />
          {nums.map((n, i) =>
            n === 0 ? (
              <span key={`gap-${i}`} className="px-1 text-muted">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                onClick={() => onChange(n)}
                aria-current={n === page ? "page" : undefined}
                className={`tnum h-6 min-w-6 rounded-[6px] px-1.5 text-[11.5px] transition-colors ${
                  n === page
                    ? "bg-brand-solid font-medium text-white"
                    : "text-ink-2 hover:bg-ink/[0.06]"
                }`}
              >
                {n}
              </button>
            )
          )}
          <PageArrow
            disabled={page >= totalPages}
            onClick={() => onChange(page + 1)}
            label="下一页"
            dir="next"
          />
        </div>
      ) : null}
    </div>
  );
}

function PageArrow({
  disabled,
  onClick,
  label,
  dir,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  dir: "prev" | "next";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-2 transition-colors hover:bg-ink/[0.06] disabled:pointer-events-none disabled:opacity-40"
    >
      {dir === "prev" ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
    </button>
  );
}
