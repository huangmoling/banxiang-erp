"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

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
      <div className="absolute inset-0 bg-ink/35" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={`relative w-full ${width} rounded-card border border-line bg-card`}
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
            {description ? <p className="mt-1 text-[12.5px] leading-5 text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted transition-colors hover:bg-line-2 hover:text-ink"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>
        {children ? <div className="px-5 py-2">{children}</div> : null}
        {footer ? <div className="flex justify-end gap-2 px-5 pb-4 pt-3">{footer}</div> : null}
      </div>
    </div>
  );
}
