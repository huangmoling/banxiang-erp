"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import { DEFAULT_THEME, THEMES, applyTheme, isThemeId, type ThemeId } from "@/lib/theme";

/**
 * 主题切换器。
 *
 * 点是直接改 <html data-theme>，不刷新页面、不重新取数——切主题不该
 * 打断用户正在干的事。选择写 cookie + localStorage，下次进来首帧就是对的。
 *
 * 默认值先取 DEFAULT_THEME 再在 useEffect 里同步真实值：
 * 服务端不知道用户选了哪套，直接读 document 会导致 hydration mismatch。
 */
export function ThemeSwitcher({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ThemeId>(DEFAULT_THEME);
  const boxRef = useRef<HTMLDivElement>(null);

  // 同步首帧脚本已经设好的值
  useEffect(() => {
    const cur = document.documentElement.getAttribute("data-theme");
    if (isThemeId(cur)) setCurrent(cur);
  }, []);

  // 点外面 / 按 Esc 关掉
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(id: ThemeId) {
    setCurrent(id);
    applyTheme(id);
    setOpen(false);
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="切换主题"
        title="切换主题"
        className={`flex h-7 w-7 items-center justify-center rounded-[5px] transition-colors ${
          tone === "dark"
            ? open
              ? "bg-white/10 text-deep-fg"
              : "text-deep-fg2 hover:bg-white/10 hover:text-deep-fg"
            : open
              ? "bg-ink/[0.07] text-ink"
              : "text-muted hover:bg-ink/[0.06] hover:text-ink"
        }`}
      >
        <Palette size={15} strokeWidth={1.9} />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="主题"
          className="sheet-in absolute right-0 top-9 z-50 w-[236px] overflow-hidden rounded-card border border-line bg-card p-1.5 shadow-pop"
        >
          <div className="px-2 pb-1.5 pt-1 text-[10px] font-semibold tracking-[0.08em] text-muted">
            界面主题
          </div>
          {THEMES.map((t) => {
            const active = t.id === current;
            return (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(t.id)}
                className={`flex w-full items-center gap-2.5 rounded-[5px] px-2 py-[7px] text-left transition-colors ${
                  active ? "bg-brand/10" : "hover:bg-sunken"
                }`}
              >
                <span className="flex shrink-0 overflow-hidden rounded-[3px] shadow-[0_0_0_1px_rgba(0,0,0,0.12)]">
                  {t.swatch.map((c) => (
                    <span key={c} className="h-5 w-[7px]" style={{ background: c }} />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[12.5px] leading-tight ${
                      active ? "font-medium text-brand-ink" : "text-ink"
                    }`}
                  >
                    {t.label}
                  </span>
                  <span className="block truncate text-[10.5px] leading-tight text-muted">
                    {t.hint}
                  </span>
                </span>
                {active ? (
                  <Check size={13} strokeWidth={2.6} className="shrink-0 text-brand-ink" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
