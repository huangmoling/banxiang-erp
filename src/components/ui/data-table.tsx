import type { ReactNode } from "react";

/**
 * 表格外壳。
 *
 * 全站 24 处裸 <table>，每处自己处理横向滚动、表头底色、空状态——
 * 结果就是有的页面表格能横滑、有的把卡片撑破。
 *
 * mac 风的做法：整张表是一块玻璃，但表头和行**不再各自模糊**
 * （几十行各模糊一次会卡，而且会糊成一片灰）。表头用极淡的填充压一层，
 * 行与行之间用 0.5px 级别的线，靠密度而不靠颜色。
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
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={minWidth ? { minWidth } : undefined}>
          <thead className="bg-brand-soft/70">{head}</thead>
          <tbody>{isEmpty ? null : children}</tbody>
        </table>
      </div>
      {isEmpty && empty ? empty : null}
      {footer}
    </div>
  );
}
