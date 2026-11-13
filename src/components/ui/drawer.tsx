"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * 右侧抽屉。
 *
 * 建单从「跳到一个整页」改成「在当前列表上拉开一条抽屉」，省掉两步：
 * 不用离开列表（筛选和滚动位置都还在），也不用等页面重新取数。
 * 仓管连续开单时这个差别很实在。
 *
 * 三条硬规矩：
 *   - 高度撑满，表单一长就内部滚动，抽屉头永远在
 *   - Esc 关闭、点遮罩关闭，但提交中由调用方拦（onClose 里判断）
 *   - 打开时锁 body 滚动，否则背后列表还会跟着滑
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  width = 900,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** 上限宽度，默认 900px；窄屏自动铺满 */
  width?: number;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="fade-in absolute inset-0 bg-[rgb(10_14_18/0.45)]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="drawer-in relative flex h-full w-full flex-col bg-canvas shadow-pop"
        style={{ maxWidth: width }}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-line bg-card px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-tight text-ink">{title}</h2>
            {subtitle ? (
              <p className="mt-1 max-w-[68ch] text-[11.5px] leading-relaxed text-muted">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭（Esc）"
            className="-mr-1 shrink-0 rounded-[5px] p-1.5 text-muted transition-colors hover:bg-ink/[0.06] hover:text-ink"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="flex min-h-full flex-col [&>*]:grow">{children}</div>
        </div>
      </div>
    </div>
  );
}
