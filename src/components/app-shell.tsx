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
import { CommandPalette } from "@/components/command-palette";
import { NewDocMenu } from "@/components/new-doc";
import { ThemeSwitcher } from "@/components/theme-switcher";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  /** 只有管理员能在导轨上看到（账号管理这类） */
  adminOnly?: boolean;
};

/**
 * 导轨分组。
 *
 * 12 个入口平铺时，新人对"入库"和"库存"、"次品区"和"报废处置"分不清——
 * 它们是不同阶段的事，不是同一层级。分组之后一眼就知道往哪类找。
 *
 * 组的顺序按日常动作走：先看盘子（概览），再开单据，再管货，最后是管理。
 * 颜色只有一种（青色），不再给每个图标上色：导轨是"骨架"，颜色留给工作台磁贴。
 */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "概览",
    items: [
      { href: "/dashboard", label: "工作台", icon: LayoutDashboard },
      { href: "/reports", label: "报表", icon: ChartColumnBig },
    ],
  },
  {
    label: "单据",
    items: [
      { href: "/inbound", label: "入库", icon: ArrowDownToLine },
      { href: "/outbound", label: "出库", icon: ArrowUpFromLine },
      { href: "/returns", label: "退货", icon: Undo2 },
      { href: "/stocktakes", label: "盘点", icon: ClipboardCheck },
    ],
  },
  {
    label: "货品",
    items: [
      { href: "/products", label: "商品档案", icon: Package },
      { href: "/inventory", label: "库存明细", icon: Warehouse },
      { href: "/defective", label: "次品区", icon: TriangleAlert },
      { href: "/scraps", label: "报废处置", icon: Trash2 },
    ],
  },
  {
    label: "管理",
    items: [
      { href: "/users", label: "账号", icon: Users, adminOnly: true },
      { href: "/backups", label: "备份", icon: DatabaseBackup, adminOnly: true },
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

/** 顶栏标题：按最长前缀匹配，/outbound/new 这种子页也能落到「出库」 */
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
  return label ? { group, label } : { group: "", label: "宿藤家居 ERP" };
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
  /**
   * 待发的**包裹数**：顶栏与导轨「出库」旁边的红点。
   * 一张单可能装几十个买家地址，用张数会严重低估工作量——仓管要跑几趟看的是这个数。
   * 拿不到就不显示，不能因为一个角标把页面搞挂。
   */
  const [pending, setPending] = useState(0);

  /** 工作台是一整块深色画布，其余页面是浅色纸——这是"三态"里最深的那一态 */
  const deep = pathname === "/dashboard";

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
      {groups.map((group) => (
        <div key={group.label}>
          <div className="nav-group">{group.label}</div>
          <div className="space-y-px">
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
                  <Icon size={15} strokeWidth={1.7} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {item.href === "/outbound" && pending > 0 ? (
                    <span
                      className="tnum ml-auto min-w-[17px] rounded-[3px] bg-danger-solid px-1 text-center text-[10px] font-semibold leading-[15px] text-white"
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

  // 品牌区在导轨与移动抽屉里复用
  const brandHead = (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-3.5 pb-3 pt-4">
      <div className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[6px] bg-brand-solid text-white">
        <Boxes size={15} strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold leading-tight tracking-[-0.01em] text-deep-fg">
          宿藤家居
        </div>
        <div className="text-[10.5px] leading-tight text-deep-muted">库房仓储管理</div>
      </div>
    </Link>
  );

  const userBlock = (
    <div className="nav-divide border-t px-2 py-2.5">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/20 text-[11.5px] font-semibold text-deep-fg ring-1 ring-inset ring-white/10">
          {user.displayName.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium leading-tight text-deep-fg">
            {user.displayName}
          </div>
          <div className="text-[10.5px] leading-tight text-deep-muted">
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

  const crumb = pageCrumb(pathname);

  return (
    <div className="relative min-h-screen">
      {/* 桌面端导轨：全站唯一的深色纵向面 */}
      <aside className="app-rail fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col md:flex">
        {brandHead}
        {nav}
        {userBlock}
      </aside>

      {/* 移动端抽屉 */}
      {menuOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="fade-in absolute inset-0 bg-[rgb(10_14_18/0.5)]"
            onClick={() => setMenuOpen(false)}
          />
          <div className="app-rail drawer-in absolute inset-y-0 left-0 flex w-[264px] flex-col">
            <div className="flex items-center justify-between px-3 pt-3">
              <span className="text-[10.5px] tracking-[0.06em] text-deep-muted">导航</span>
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
          顶栏：48px 深色细带。深色顶栏 + 浅色正文，是这套界面最容易被认出的
          "这是业务系统"的信号；它也把"看数据"和"干活"切成两种视线。
        */}
        <header className="app-topbar sticky top-0 z-20 flex h-12 items-center gap-2 px-3 sm:px-4">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="-ml-1 rounded-[5px] p-1.5 text-deep-fg2 transition-colors hover:bg-white/10 hover:text-deep-fg md:hidden"
            aria-label="打开菜单"
          >
            <Menu size={18} />
          </button>

          <div className="flex min-w-0 items-baseline gap-2">
            {crumb.group ? (
              <span className="hidden shrink-0 text-[11.5px] text-deep-muted sm:inline">
                {crumb.group}
              </span>
            ) : null}
            <h1 className="min-w-0 truncate text-[13.5px] font-medium text-deep-fg">{crumb.label}</h1>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {pending > 0 ? (
              <Link
                href="/outbound?status=pending"
                className="hidden items-center gap-1.5 rounded-[5px] bg-danger/20 px-2 py-1 text-[11.5px] font-medium text-[#F3B1A8] transition-colors hover:bg-danger/30 sm:flex"
                title={`${pending} 个包裹待发出`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#E0796A]" />
                {pending} 个包裹待发
              </Link>
            ) : null}

            <div className="hidden md:block">
              <CommandPalette variant="bar" />
            </div>
            <div className="md:hidden">
              <CommandPalette variant="icon" />
            </div>

            <NewDocMenu />
            <ThemeSwitcher />
          </div>
        </header>

        {deep ? (
          <main className="deep-canvas min-h-[calc(100vh-48px)]">{children}</main>
        ) : (
          <main className="mx-auto max-w-[1360px] px-3 py-4 sm:px-5 sm:py-5">{children}</main>
        )}
      </div>

      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}
