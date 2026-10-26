import type { ReactNode } from "react";

/**
 * 空状态。系统里有 19 处手写的「还没有…」，每处措辞和留白都不一样。
 *
 * 这里定一个规矩：空状态必须回答两件事——为什么是空的，以及下一步该点哪里。
 * 只说「暂无数据」等于让用户自己猜。
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** 表格里用的紧凑版：不留那么多垂直空间 */
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center px-6 text-center ${
        compact ? "py-10" : "py-16"
      }`}
    >
      {icon ? (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-line-2 bg-sunken text-muted">
          {icon}
        </div>
      ) : null}
      <div className="text-[13.5px] font-medium text-ink">{title}</div>
      {description ? (
        <div className="mt-1 max-w-[420px] text-[12.5px] leading-relaxed text-muted">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
