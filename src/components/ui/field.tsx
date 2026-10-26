import type { ReactNode } from "react";

/**
 * 表单字段。标签在上、提示在下、错误替换提示。
 *
 * 现有页面里这三样东西的间距各不相同（mb-1 / mb-1.5 / mb-2 混用），
 * 一屏十几个输入框叠起来就显得毛糙。统一到一处。
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  htmlFor,
  children,
  className = "",
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-[11.5px] leading-relaxed text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** 表单分节：一个标题 + 说明，把长表单切成几块，别让人一次面对 20 个框 */
export function FormSection({
  title,
  description,
  children,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="border-b border-line-2 px-5 py-4 last:border-b-0">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
