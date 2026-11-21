"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChartColumnBig,
  ClipboardCheck,
  Command,
  DatabaseBackup,
  LayoutDashboard,
  Package,
  Search,
  Trash2,
  TriangleAlert,
  Undo2,
  Users,
  Warehouse,
} from "lucide-react";
import { DOC_SPECS, useNewDoc } from "@/components/new-doc";

/**
 * 命令面板（⌘K / Ctrl+K）。
 *
 * 导航从 12 项缩成 6 项之后，剩下的入口全在这里——但更好的用法不是"找页面"，
 * 而是"直接开一张单"：输入"入"回车，抽屉就出来了，不用先想它在哪个菜单下面。
 *
 * 只做本地过滤，不发请求：一共 17 条，全部在内存里。
 */

type Item = {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  run: () => void;
};

const PAGES: { href: string; label: string; hint: string; keywords: string; icon: Item["icon"] }[] = [
  { href: "/dashboard", label: "工作台", hint: "今天该干什么", keywords: "gzt dashboard 首页 概览", icon: LayoutDashboard },
  { href: "/inbound", label: "入库", hint: "工厂到货", keywords: "rk inbound 进货", icon: ArrowDownToLine },
  { href: "/outbound", label: "出库", hint: "发货、包裹", keywords: "ck outbound 发货", icon: ArrowUpFromLine },
  { href: "/returns", label: "退货", hint: "退回的货", keywords: "th returns 退", icon: Undo2 },
  { href: "/stocktakes", label: "盘点", hint: "数一遍", keywords: "pd stocktake 盘库", icon: ClipboardCheck },
  { href: "/products", label: "商品档案", hint: "产品与颜色", keywords: "sp products 商品 款", icon: Package },
  { href: "/inventory", label: "库存明细", hint: "现在有多少", keywords: "kc inventory 库存", icon: Warehouse },
  { href: "/defective", label: "次品区", hint: "退回来的瑕疵品", keywords: "cp defective 次品", icon: TriangleAlert },
  { href: "/scraps", label: "报废处置", hint: "次品的出路", keywords: "bf scrap 报废", icon: Trash2 },
  { href: "/reports", label: "报表", hint: "出入库统计", keywords: "bb reports 报表", icon: ChartColumnBig },
  { href: "/users", label: "账号管理", hint: "谁能用这个系统", keywords: "zh users 账号 用户", icon: Users },
  { href: "/backups", label: "备份", hint: "备份与恢复", keywords: "bf backups 备份", icon: DatabaseBackup },
];

export function CommandPalette({ variant = "bar" }: { variant?: "bar" | "icon" }) {
  const router = useRouter();
  const newDoc = useNewDoc();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const actions: Item[] = DOC_SPECS.map((s) => ({
      id: `new-${s.kind}`,
      label: `新建${s.label.replace("新建", "")}`,
      hint: "打开建单抽屉",
      keywords: `新建 ${s.label} new`,
      icon: s.icon,
      run: () => {
        setOpen(false);
        newDoc.start(s.kind);
      },
    }));
    const pages: Item[] = PAGES.map((p) => ({
      id: p.href,
      label: p.label,
      hint: p.hint,
      keywords: p.keywords,
      icon: p.icon,
      run: () => {
        setOpen(false);
        router.push(p.href);
      },
    }));
    return [...actions, ...pages];
  }, [router, newDoc]);

  const filtered = useMemo(() => {
    const key = q.trim().toLowerCase();
    if (!key) return items;
    return items.filter(
      (it) =>
        it.label.toLowerCase().includes(key) ||
        it.keywords.toLowerCase().includes(key) ||
        it.hint.includes(key)
    );
  }, [items, q]);

  const active = Math.min(idx, Math.max(0, filtered.length - 1));

  return (
    <>
      {variant === "bar" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-9 w-[210px] items-center justify-start gap-2 rounded-full border border-line bg-sunken pl-3.5 pr-2 text-muted transition-colors hover:border-brand/40 hover:text-ink"
        >
          <Search size={13} strokeWidth={2} />
          <span className="text-[12px] opacity-80">搜索或开单</span>
          <span className="ml-auto flex items-center gap-0.5 rounded-full border border-line bg-card px-1.5 py-0.5 text-[10px] opacity-70">
            <Command size={9} strokeWidth={2.4} />K
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="搜索"
          title="搜索或开单（⌘K）"
          className="top-btn px-2"
        >
          <Search size={15} strokeWidth={2} />
        </button>
      )}

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
          <div
            className="fade-in absolute inset-0 bg-[rgb(10_14_18/0.45)]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="搜索或开单"
            className="sheet-in relative w-full max-w-[560px] overflow-hidden rounded-card border border-line bg-card shadow-pop"
          >
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search size={15} strokeWidth={2} className="shrink-0 text-muted" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setIdx((i) => Math.min(i + 1, filtered.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setIdx((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    filtered[active]?.run();
                  }
                }}
                placeholder="跳转页面，或直接开一张单：入 / 出 / 退 / 盘"
                className="h-11 w-full border-0 bg-transparent px-0 text-[13.5px] text-ink outline-none placeholder:text-muted focus:ring-0"
              />
              <kbd className="shrink-0 rounded-[4px] border border-line px-1 py-0.5 text-[10px] text-muted">
                Esc
              </kbd>
            </div>

            <div className="max-h-[52vh] overflow-y-auto p-1.5">
              {filtered.length === 0 ? (
                <div className="px-3 py-8 text-center text-[12px] text-muted">
                  没有匹配的页面或动作
                </div>
              ) : (
                filtered.map((it, i) => {
                  const Icon = it.icon;
                  const on = i === active;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onMouseEnter={() => setIdx(i)}
                      onClick={it.run}
                      className={`flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-left transition-colors ${
                        on ? "bg-brand/10 text-ink" : "text-ink-2 hover:bg-sunken"
                      }`}
                    >
                      <Icon
                        size={14}
                        strokeWidth={1.9}
                        className={on ? "shrink-0 text-brand-ink" : "shrink-0 text-muted"}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{it.label}</span>
                      <span className="shrink-0 text-[11px] text-muted">{it.hint}</span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[10.5px] text-muted">
              <span>↑↓ 选择</span>
              <span>回车打开</span>
              <span className="ml-auto">⌘K 随时呼出</span>
            </div>
          </div>
        </div>
      ) : null}

      {newDoc.drawer}
    </>
  );
}
