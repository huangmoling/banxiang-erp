"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; text: string };

type ToastApi = {
  success: (text: string) => void;
  error: (text: string) => void;
  /** 中性提示：不是出错，但需要让人知道一下（比如「这一款已经在单里了」） */
  info: (text: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, kind === "error" ? 5000 : 2600);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (text) => push("success", text),
      error: (text) => push("error", text),
      info: (text) => push("info", text),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-[92vw] items-start gap-2 rounded-lg border px-3.5 py-2.5 text-[13.5px] ${
              t.kind === "success"
                ? "border-ok/40 bg-ok-soft text-ok"
                : t.kind === "info"
                  ? "border-brand/30 bg-brand-soft text-brand-ink"
                  : "border-danger/30 bg-danger-soft text-danger"
            }`}
          >
            {t.kind === "success" ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            ) : t.kind === "info" ? (
              <Info size={16} className="mt-0.5 shrink-0" />
            ) : (
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
            )}
            <span className="leading-5">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // 没有 Provider 时退化为控制台提示，避免组件直接崩
    return {
      success: (t) => console.info(t),
      error: (t) => console.error(t),
      info: (t) => console.info(t),
    };
  }
  return ctx;
}

/** 关闭按钮在弹窗里复用 */
export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md p-1 text-muted transition-colors hover:bg-line-2 hover:text-ink"
      aria-label="关闭"
    >
      <X size={16} />
    </button>
  );
}
