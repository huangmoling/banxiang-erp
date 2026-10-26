"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import { DEFAULT_THEME, THEMES, applyTheme, type ThemeId } from "@/lib/theme";

/**
 * 主题切换器。
 *
 * 点是直接改 <html data-theme>，不刷新页面、不重新取数——切主题不该
 * 打断用户正在干的事。选择写 cookie + localStorage，下次进来首帧就是对的。
 *
 * 默认值先取 DEFAULT_THEME 再在 useEffect 里同步真实值：
 * 服务端不知道用户选了哪套，直接读 document 会导致 hydration mismatch。
 */
export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ThemeId>(DEFAULT_THEME);
  const boxRef = useRef<HTMLDivElement>(null);

  // 同步首帧脚本已经设好的值
  useEffect(() => {
    const cur = document.documentElement.getAttribute("data-theme");
    if (cur === "graphite" || cur === "lumen" || cur === "obsidian") setCurrent(cur);
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
        className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
          open
            ? "border-brand/50 bg-brand-soft text-brand-ink"
            : "border-transparent text-muted hover:border-line hover:bg-sunken hover:text-ink"
        }`}
      >
        <Palette size={16} strokeWidth={1.75} />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="主题"
          className="absolute right-0 top-10 z-50 w-[232px] overflow-hidden rounded-xl border border-line bg-card p-1.5 shadow-pop"
        >
          <div className="px-2 pb-1.5 pt-1 text-[10.5px] font-semibold tracking-[0.08em] text-muted">
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
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors ${
                  active ? "bg-brand-soft" : "hover:bg-sunken"
                }`}
              >
                <span className="flex shrink-0 overflow-hidden rounded-[5px] border border-line">
                  {t.swatch.map((c) => (
                    <span key={c} className="h-5 w-2" style={{ background: c }} />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[13px] leading-tight ${
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
                  <Check size={14} strokeWidth={2.4} className="shrink-0 text-brand-ink" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
