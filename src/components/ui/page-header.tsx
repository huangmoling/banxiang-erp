import type { ReactNode } from "react";

/**
 * 页面头。每个页面第一屏的第一行。
 *
 * 标题 + 一句说明（告诉新人在这一页能干什么）+ 右侧主操作。
 * 说明文字不是装饰：这个系统的用户是仓管和内勤，不是每天点同一个按钮的人。
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** 标题右侧的小字补充，比如「共 128 个 SKU」 */
  meta?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h1 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-ink">
            {title}
          </h1>
          {meta ? <span className="text-[12px] text-muted">{meta}</span> : null}
        </div>
        {description ? (
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
