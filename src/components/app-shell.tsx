"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
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
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Wallpaper } from "@/components/wallpaper";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  ready: boolean;
  /** 只有管理员能在侧栏看到（账号管理这类） */
  adminOnly?: boolean;
};

/**
 * 侧栏分组。
 *
 * 12 个入口平铺时，新人对"入库"和"库存"、"次品区"和"报废处置"分不清——
 * 它们是不同阶段的事，不是同一层级的菜单。分组之后一眼就知道该往哪一类找。
 * 组的顺序按日常动作走：先看盘子（概览），再开单据，再管货，最后是管理。
 */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "概览",
    items: [
      { href: "/dashboard", label: "仪表台", icon: LayoutDashboard, ready: true },
      { href: "/reports", label: "报表", icon: ChartColumnBig, ready: true },
    ],
  },
  {
    label: "单据",
    items: [
      { href: "/inbound", label: "入库", icon: ArrowDownToLine, ready: true },
      { href: "/outbound", label: "出库", icon: ArrowUpFromLine, ready: true },
      { href: "/returns", label: "退货", icon: Undo2, ready: true },
      { href: "/stocktakes", label: "盘点", icon: ClipboardCheck, ready: true },
    ],
  },
  {
    label: "货品",
    items: [
      { href: "/products", label: "商品", icon: Package, ready: true },
      { href: "/inventory", label: "库存", icon: Warehouse, ready: true },
      { href: "/defective", label: "次品区", icon: TriangleAlert, ready: true },
      { href: "/scraps", label: "报废处置", icon: Trash2, ready: true },
    ],
  },
  {
    label: "管理",
    items: [
      { href: "/users", label: "账号", icon: Users, ready: true, adminOnly: true },
      { href: "/backups", label: "备份", icon: DatabaseBackup, ready: true, adminOnly: true },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  manager: "店长",
  keeper: "仓管",
  clerk: "内勤",
  viewer: "查看",
};

/** 顶栏标题：按最长前缀匹配，/outbound/new 这种子页也能落到「出库」 */
function pageTitle(pathname: string): string {
  let best = "";
  let label = "";
  for (const item of ALL_ITEMS) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (item.href.length > best.length) {
        best = item.href;
        label = item.label;
      }
    }
  }
  return label || "宿藤家居 ERP";
}

/**
 * 壁纸。毛玻璃必须有东西可以模糊，否则就是一块灰。
 * 三团雾斑固定在最底层、不随页面滚动，见 components/wallpaper.tsx。
 */

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
  /**
   * 待发的**包裹数**：侧栏「出库」旁边那个红点。
   * 一张单可能装几十个买家地址，用张数会严重低估工作量——仓管要跑几趟看的是这个数。
   * 拿不到就不显示，不能因为一个角标把页面搞挂。
   */
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const row = await api<{ packages: number }>("/api/outbound/pending-count");
        if (alive) setPending(row.packages);
      } catch {
        /* 静默失败：角标只是提示，不该弹错误 */
      }
    }
    void load();
    // 确认发货之后角标要立刻减，别让人等 60 秒
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

  const nav = (
    <nav className="flex-1 overflow-y-auto px-2 pb-2">
      {groups.map((group, index) => (
        <div key={group.label}>
          <div className={`nav-group ${index === 0 ? "!pt-2" : ""}`}>{group.label}</div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              if (!item.ready) {
                return (
                  <div
                    key={item.href}
                    className="flex h-8 cursor-not-allowed items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] text-sidebar-muted opacity-60"
                    title="后续阶段开放"
                  >
                    <Icon size={15} strokeWidth={1.7} />
                    <span>{item.label}</span>
                    <span className="ml-auto text-[10.5px] tracking-wide">待开放</span>
                  </div>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={`nav-item ${active ? "nav-item-active" : ""}`}
                >
                  <Icon size={15} strokeWidth={1.7} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {item.href === "/outbound" && pending > 0 ? (
                    <span
                      className="ml-auto min-w-[18px] rounded-full bg-danger-solid px-1.5 text-center text-[10.5px] font-semibold leading-[17px] text-white shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                      title={`${pending} 个包裹待发出`}
                    >
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

  // 品牌区在侧栏与移动抽屉里复用
  const brandHead = (
    <div className="flex items-center gap-2.5 px-4 pb-3 pt-1">
      <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-brand-solid text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_6px_-1px_rgba(0,60,160,0.45)]">
        <Boxes size={16} strokeWidth={1.9} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold leading-tight tracking-[-0.01em] text-sidebar-strong">
          宿藤家居
        </div>
        <div className="text-[10.5px] leading-tight text-sidebar-muted">库房仓储管理</div>
      </div>
    </div>
  );

  const userBlock = (
    <div className="nav-divide border-t px-2 py-2.5">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/20 text-[11.5px] font-semibold text-sidebar-strong ring-1 ring-inset ring-white/10">
          {user.displayName.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium leading-tight text-sidebar-strong">
            {user.displayName}
          </div>
          <div className="text-[10.5px] leading-tight text-sidebar-muted">
            {ROLE_LABEL[user.role] ?? user.role}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPasswordOpen(true)}
          className="nav-btn"
          title="修改密码"
        >
          <KeyRound size={14} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={logout}
          className="nav-btn hover:!text-danger"
          title="退出登录"
        >
          <LogOut size={14} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-screen">
      <Wallpaper />

      {/* 桌面端侧栏：玻璃 + 交通灯，这是整套 mac 语言的门面 */}
      <aside className="app-sidebar glass-bar fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col md:flex">
        <div className="flex items-center gap-[7px] px-4 pb-4 pt-4">
          <span className="traffic-light tl-close" />
          <span className="traffic-light tl-min" />
          <span className="traffic-light tl-max" />
        </div>
        {brandHead}
        {nav}
        {userBlock}
      </aside>

      {/* 移动端抽屉 */}
      {menuOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="fade-in absolute inset-0 bg-ink/25 backdrop-blur-[3px]"
            onClick={() => setMenuOpen(false)}
          />
          <div className="sheet-in glass-bar absolute inset-y-0 left-0 flex w-[264px] flex-col shadow-pop">
            <div className="flex items-center justify-between px-4 pb-4 pt-4">
              <div className="flex items-center gap-[7px]">
                <span className="traffic-light tl-close" />
                <span className="traffic-light tl-min" />
                <span className="traffic-light tl-max" />
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="nav-btn"
                aria-label="关闭菜单"
              >
                <X size={15} />
              </button>
            </div>
            {brandHead}
            {nav}
            {userBlock}
          </div>
        </div>
      ) : null}

      {/* 主区域 */}
      <div className="relative z-10 md:pl-[232px]">
        {/*
          顶栏：mac 的工具栏。粘性 + 浅玻璃，滚到表格底部还知道自己在哪个页面。
          底部那条线用 border-line/60 —— 全不透明会在玻璃上割出一道灰边。
        */}
        <header className="glass-head sticky top-0 z-20 flex h-[48px] items-center gap-2 border-b border-line/60 px-3 sm:px-6">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="-ml-1 rounded-[8px] p-1.5 text-ink-2 transition-colors hover:bg-ink/[0.06] hover:text-ink md:hidden"
            aria-label="打开菜单"
          >
            <Menu size={18} />
          </button>
          <h1 className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.01em] text-ink">
            {pageTitle(pathname)}
          </h1>

          <div className="ml-auto flex items-center gap-1.5">
            {pending > 0 ? (
              <Link
                href="/outbound?status=pending"
                className="hidden items-center gap-1.5 rounded-full bg-danger/12 px-2.5 py-1 text-[11.5px] font-medium text-danger transition-colors hover:bg-danger/20 sm:flex"
                title={`${pending} 个包裹待发出`}
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-danger" />
                </span>
                {pending} 个包裹待发
              </Link>
            ) : null}
            <ThemeSwitcher />
          </div>
        </header>

        <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 sm:py-7">{children}</main>
      </div>

      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}
