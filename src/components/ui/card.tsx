import type { ReactNode } from "react";

/**
 * 卡片。整个界面的基本容器。
 *
 * 层次靠色阶（canvas → card → sunken）而不是阴影，所以深色主题下也不会脏。
 * padding 默认给 0，让表格自己贴边——表格伸到卡片边缘比悬空好看。
 */
export function Card({
  children,
  className = "",
  padded = false,
}: {
  children: ReactNode;
  className?: string;
  /** 普通内容区（不是表格）用 padded，省得每处手写 px-5 py-4 */
  padded?: boolean;
}) {
  return (
    <section className={`card ${padded ? "p-5" : ""} ${className}`}>{children}</section>
  );
}

/** 卡片头：左边标题+说明，右边动作。底部一条细线跟内容分开 */
export function CardHeader({
  title,
  description,
  actions,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-start gap-3 border-b border-line px-5 py-3.5 ${className}`}
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-[14px] font-semibold tracking-tight text-ink">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** 卡片里的一个内嵌块：用 sunken 底，跟卡片表面拉开一层 */
export function CardWell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-line-2 bg-sunken px-4 py-3 ${className}`}>
      {children}
    </div>
  );
}
