import type { ReactNode } from "react";

/**
 * 卡片。整个界面的基本容器。
 *
 * mac 风格的表面：半透明 + backdrop-blur，底下那层彩色壁纸会隐隐透上来。
 * 层次靠"模糊程度"和"前后遮挡"，所以边框是白色半透明而不是灰色实线——
 * 灰色实线会让玻璃看起来像贴在纸上的塑料片。
 *
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
    <section className={`card ${padded ? "p-3.5 sm:p-4" : ""} ${className}`}>{children}</section>
  );
}

/** 卡片头：左边标题+说明，右边动作。底部一条极细线跟内容分开 */
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
      className={`flex flex-wrap items-center gap-3 border-b border-line px-3.5 py-2.5 ${className}`}
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** 卡片里的一个内嵌块：比卡片再沉一层，用极淡填充而不是再叠一层模糊 */
export function CardWell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`well px-3.5 py-2.5 ${className}`}>{children}</div>;
}
