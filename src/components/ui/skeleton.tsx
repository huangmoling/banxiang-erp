/**
 * 骨架屏。加载中不要显示"加载中…"这四个字——它会让人以为页面卡住了。
 * 用等高的灰块把布局先撑出来，内容到了直接替换，视觉上不跳动。
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-sunken ${className}`} />;
}

/** 多行文本骨架，最后一行短一点，像真的段落 */
export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}

/** 表格骨架：按表头和 n 行占位，避免加载完页面突然长高一大截 */
export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card">
      <div className="flex gap-4 border-b border-line bg-sunken/60 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-line-2 px-4 py-3.5">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={`h-3.5 flex-1 ${c === 0 ? "max-w-[180px]" : ""}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
