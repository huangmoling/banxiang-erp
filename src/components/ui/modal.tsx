"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * 弹窗。做成 macOS 的 sheet：从上方轻落、四周重模糊、
 * 面板本身也是一块玻璃（能透出后面页面的颜色，但不会糊到看不清字）。
 *
 * 遮罩用 backdrop-blur 而不是纯黑：纯黑遮罩会把整个界面压成一张黑白照片，
 * mac 的弹窗是"焦点模糊"，不是"灯关了"。
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = "max-w-[440px]",
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fade-in absolute inset-0 bg-ink/20 backdrop-blur-[3px]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={`sheet-in glass relative w-full ${width} rounded-[18px]`}
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
          <div>
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
            {description ? (
              <p className="mt-1 text-[12.5px] leading-5 text-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 rounded-full p-1.5 text-muted transition-colors hover:bg-ink/[0.07] hover:text-ink"
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>
        {children ? <div className="px-5 py-2">{children}</div> : null}
        {footer ? <div className="flex justify-end gap-2 px-5 pb-4 pt-3">{footer}</div> : null}
      </div>
    </div>
  );
}
