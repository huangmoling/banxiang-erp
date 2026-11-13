import type { ReactNode } from "react";

/**
 * 页面头。每个页面第一屏的第一行。
 *
 * mac 的"大标题"（Large Title）：25px semibold + 负字距，然后一整行留白。
 * 不加大标题的那条浅灰底色，也不在标题下画分割线——留白本身就是分隔。
 *
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
    <div className="mb-3.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h1 className="text-display font-semibold text-ink">{title}</h1>
          {meta ? <span className="text-[12px] text-muted">{meta}</span> : null}
        </div>
        {description ? (
          <p className="mt-1 max-w-[64ch] text-[12px] leading-relaxed text-ink-2">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 pb-0.5">{actions}</div>
      ) : null}
    </div>
  );
}
