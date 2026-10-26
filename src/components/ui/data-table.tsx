import type { ReactNode } from "react";

/**
 * 表格外壳。
 *
 * 全站 24 处裸 <table>，每处自己处理横向滚动、表头底色、空状态——
 * 结果就是有的页面表格能横滑、有的把卡片撑破。
 *
 * 这里只统一外壳，行还是各页面自己渲染（列差别太大，抽象成 schema 反而更难维护）。
 * 用法：
 *   <DataTable head={<tr><th className="th">品名</th></tr>} empty={<EmptyState .../>} isEmpty={rows.length===0}>
 *     {rows.map(...)}
 *   </DataTable>
 */
export function DataTable({
  head,
  children,
  isEmpty = false,
  empty,
  footer,
  minWidth,
}: {
  head: ReactNode;
  children: ReactNode;
  isEmpty?: boolean;
  empty?: ReactNode;
  /** 分页条之类，粘在表格底部 */
  footer?: ReactNode;
  /** 列多到窄屏放不下时给个下限，靠横向滚动兜住，而不是把列挤成一条缝 */
  minWidth?: string;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
      <div className="overflow-x-auto">
        <table
          className="w-full border-collapse"
          style={minWidth ? { minWidth } : undefined}
        >
          <thead className="bg-sunken/60">{head}</thead>
          <tbody>{isEmpty ? null : children}</tbody>
        </table>
      </div>
      {isEmpty && empty ? empty : null}
      {footer}
    </div>
  );
}
