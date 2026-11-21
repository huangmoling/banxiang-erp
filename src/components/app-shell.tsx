"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Bell,
  Boxes,
  ChartColumnBig,
  ClipboardCheck,
  DatabaseBackup,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Trash2,
  TriangleAlert,
  Undo2,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { CommandPalette } from "@/components/command-palette";
import { NewDocMenu } from "@/components/new-doc";
import { ThemeSwitcher } from "@/components/theme-switcher";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  adminOnly?: boolean;
};

/* 分组与功能与原版一致，只是换成 SaaS 胶囊菜单的呈现 */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "概览",
    items: [
      { href: "/dashboard", label: "工作台", icon: LayoutDashboard },
      { href: "/reports", label: "报表中心", icon: ChartColumnBig },
    ],
  },
  {
    label: "单据处理",
    items: [
      { href: "/inbound", label: "入库单", icon: ArrowDownToLine },
      { href: "/outbound", label: "出库单", icon: ArrowUpFromLine },
      { href: "/returns", label: "退货单", icon: Undo2 },
      { href: "/stocktakes", label: "盘点单", icon: ClipboardCheck },
    ],
  },
  {
    label: "货品与库存",
    items: [
      { href: "/products", label: "商品档案", icon: Package },
      { href: "/inventory", label: "库存明细", icon: Warehouse },
      { href: "/defective", label: "次品区", icon: TriangleAlert },
      { href: "/scraps", label: "报废处置", icon: Trash2 },
    ],
  },
  {
    label: "系统管理",
    items: [
      { href: "/users", label: "账号管理", icon: Users, adminOnly: true },
      { href: "/backups", label: "数据备份", icon: DatabaseBackup, adminOnly: true },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  manager: "店长",
  keeper: "仓管",
  clerk: "内勤",
  viewer: "查看",
};

function pageCrumb(pathname: string): { group: string; label: string } {
  let best = "";
  let label = "";
  let group = "";
  for (const item of ALL_ITEMS) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (item.href.length > best.length) {
        best = item.href;
        label = item.label;
        group = item.group;
      }
    }
  }
  return label ? { group, label } : { group: "", label: "半巷设计 ERP" };
}

export function AppShell({
  user,
  children,
}: {
  user: { displayName: string; username: string; role: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const row = await api<{ packages: number }>("/api/outbound/pending-count");
        if (alive) setPending(row.packages);
      } catch {}
    }
    void load();
    const onChanged = () => void load();
    window.addEventListener("suteng:pending-changed", onChanged);
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("suteng:pending-changed", onChanged);
    };
  }, [pathname]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api("/api/auth/logout", { method: "POST", noAuthRedirect: true });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  const groups = NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((item) => !item.adminOnly || user.role === "admin"),
  })).filter((g) => g.items.length > 0);

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-3 px-5 pb-1 pt-5">
      <span className="grad-card flex h-11 w-11 shrink-0 items-center justify-center !rounded-full">
        <Boxes size={20} strokeWidth={2} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[15.5px] font-bold tracking-[-0.01em] text-ink">半巷设计</span>
        <span className="block text-[11px] text-muted">ERP · 仓储管理</span>
      </span>
    </Link>
  );

  const nav = (
    <nav className="flex-1 overflow-y-auto pb-3 pt-2">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="nav-group">{group.label}</div>
          <div className="space-y-1">
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={`nav-item ${active ? "nav-item-active" : ""}`}
                >
                  <Icon size={17} strokeWidth={1.9} className={`shrink-0 ${active ? "text-white" : "text-muted"}`} />
                  <span className="truncate">{item.label}</span>
                  {item.href === "/outbound" && pending > 0 ? (
                    <span className="tnum ml-auto min-w-[20px] rounded-full bg-[#FF8A00] px-1.5 text-center text-[10.5px] font-bold leading-[18px] text-white" title={`${pending} 个包裹待发出`}>
                      {pending}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const sideBottom = (
    <div className="space-y-2.5 px-4 pb-4">
      <div className="grad-card p-3.5">
        <div className="text-[13px] font-bold leading-snug">仓库动态</div>
        <p className="mt-0.5 text-[11.5px] leading-snug text-white/85">
          {pending > 0 ? `有 ${pending} 个包裹等着发出，别让买家等太久。` : "主仓 / 次品区 / 报废区都在正常运转，暂无待发包裹。"}
        </p>
        <Link
          href={pending > 0 ? "/outbound?status=pending" : "/inventory"}
          className="mt-2 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-brand-ink transition-transform hover:scale-[1.03]"
        >
          {pending > 0 ? "去处理" : "看库存"} <ArrowRight size={12} strokeWidth={2.4} />
        </Link>
      </div>
      <div className="flex items-center gap-2.5 px-1">
        <span className="grad-card flex h-9 w-9 shrink-0 items-center justify-center !rounded-full text-[12.5px] font-bold">
          {user.displayName.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-semibold text-ink">{user.displayName}</span>
          <span className="block text-[11px] text-muted">{ROLE_LABEL[user.role] ?? user.role} · {user.username}</span>
        </span>
        <button type="button" onClick={() => setPasswordOpen(true)} className="nav-btn" title="修改密码"><KeyRound size={15} /></button>
        <button type="button" onClick={logout} className="nav-btn" title="退出登录"><LogOut size={15} /></button>
      </div>
    </div>
  );

  const crumb = pageCrumb(pathname);
  const today = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());

  return (
    <div className="app-bg flex min-h-screen">
      {/* ===== 左侧白栏：渐变圆 Logo + 胶囊菜单 + 渐变动态卡 + 用户 ===== */}
      <aside className="app-rail sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col lg:flex">
        {brand}
        {nav}
        {sideBottom}
      </aside>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fade-in absolute inset-0 bg-[rgb(var(--c-deep-bg)/0.45)]" onClick={() => setMenuOpen(false)} />
          <div className="app-rail drawer-in absolute inset-y-0 left-0 flex w-[272px] flex-col shadow-pop">
            <div className="flex items-start justify-between pr-3">
              <div className="flex-1">{brand}</div>
              <button type="button" onClick={() => setMenuOpen(false)} className="nav-btn mt-6" aria-label="关闭菜单"><X size={16} /></button>
            </div>
            {nav}
            {sideBottom}
          </div>
        </div>
      ) : null}

      {/* ===== 主区域 ===== */}
      <div className="min-w-0 flex-1">
        <header className="app-topbar sticky top-0 z-20 flex h-[68px] items-center gap-3 px-4 sm:px-6">
          <button type="button" onClick={() => setMenuOpen(true)} className="-ml-1 rounded-full p-2 text-ink-2 transition-colors hover:bg-brand-soft hover:text-brand-ink lg:hidden" aria-label="打开菜单">
            <Menu size={19} />
          </button>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[16px] font-bold tracking-[-0.01em] text-ink">
              Hi {user.displayName}，欢迎回来
            </div>
            <div className="truncate text-[11.5px] text-muted">
              {crumb.group ? `${crumb.group} / ${crumb.label} · ` : ""}{today}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden md:block"><CommandPalette variant="bar" /></div>
            <div className="md:hidden"><CommandPalette variant="icon" /></div>
            <Link
              href="/outbound?status=pending"
              className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card text-ink-2 transition-colors hover:border-brand/40 hover:text-brand-ink"
              title={pending > 0 ? `${pending} 个包裹待发` : "待发包裹"}
              aria-label="待发包裹"
            >
              <Bell size={16} strokeWidth={1.9} />
              {pending > 0 ? (
                <span className="tnum absolute -right-1 -top-1 min-w-[18px] rounded-full bg-[#FF8A00] px-1 text-center text-[10px] font-bold leading-[18px] text-white">{pending}</span>
              ) : null}
            </Link>
            <NewDocMenu />
            <ThemeSwitcher tone="light" />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6">{children}</main>
      </div>

      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}
