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

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  ready: boolean;
  /** 只有管理员能在侧栏看到（账号管理这类） */
  adminOnly?: boolean;
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "仪表台", icon: LayoutDashboard, ready: true },
  { href: "/reports", label: "报表", icon: ChartColumnBig, ready: true },
  { href: "/products", label: "商品", icon: Package, ready: true },
  { href: "/inbound", label: "入库", icon: ArrowDownToLine, ready: true },
  { href: "/outbound", label: "出库", icon: ArrowUpFromLine, ready: true },
  { href: "/stocktakes", label: "盘点", icon: ClipboardCheck, ready: true },
  { href: "/returns", label: "退货", icon: Undo2, ready: true },
  { href: "/defective", label: "次品区", icon: TriangleAlert, ready: true },
  { href: "/scraps", label: "报废处置", icon: Trash2, ready: true },
  { href: "/inventory", label: "库存", icon: Warehouse, ready: true },
  { href: "/users", label: "账号", icon: Users, ready: true, adminOnly: true },
  { href: "/backups", label: "备份", icon: DatabaseBackup, ready: true, adminOnly: true },
];

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  manager: "店长",
  keeper: "仓管",
  viewer: "查看",
};

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

  const visibleNav = NAV.filter((item) => !item.adminOnly || user.role === "admin");

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

  const nav = (
    <nav className="space-y-0.5">
      {visibleNav.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        if (!item.ready) {
          return (
            <div
              key={item.href}
              className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] text-[#b9bfc9]"
              title="后续阶段开放"
            >
              <Icon size={16} strokeWidth={1.7} />
              <span>{item.label}</span>
              <span className="ml-auto text-[10.5px] tracking-wide text-[#c8ccd4]">待开放</span>
            </div>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMenuOpen(false)}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors ${
              active
                ? "bg-brand-soft font-medium text-brand"
                : "text-ink-2 hover:bg-[#f4f6f8] hover:text-ink"
            }`}
          >
            <Icon size={16} strokeWidth={1.7} />
            <span>{item.label}</span>
            {item.href === "/outbound" && pending > 0 ? (
              <span
                className="ml-auto min-w-[17px] rounded-full bg-danger px-1.5 text-center text-[10.5px] font-semibold leading-[17px] text-white"
                title={`${pending} 个包裹待发出`}
              >
                {pending}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  const userBlock = (
    <div className="border-t border-line px-2.5 py-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-soft text-[11.5px] font-semibold text-brand">
          {user.displayName.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-ink">{user.displayName}</div>
          <div className="text-[11px] text-muted">{ROLE_LABEL[user.role] ?? user.role}</div>
        </div>
        <button
          type="button"
          onClick={() => setPasswordOpen(true)}
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-line-2 hover:text-ink"
          title="修改密码"
        >
          <KeyRound size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={logout}
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-line-2 hover:text-danger"
          title="退出登录"
        >
          <LogOut size={15} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* 桌面端侧栏 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[212px] flex-col border-r border-line bg-white md:flex">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
            <Boxes size={17} strokeWidth={1.8} />
          </div>
          <div>
            <div className="text-[14px] font-semibold tracking-tight text-ink">宿藤家居 ERP</div>
            <div className="text-[10.5px] text-muted">库房仓储管理</div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2.5 py-2">{nav}</div>
        {userBlock}
      </aside>

      {/* 移动端抽屉 */}
      {menuOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-[#1f2430]/30" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[240px] flex-col bg-white">
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
                  <Boxes size={17} strokeWidth={1.8} />
                </div>
                <div className="text-[14px] font-semibold text-ink">宿藤家居 ERP</div>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded-md p-1.5 text-muted hover:bg-line-2"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2.5 py-2">{nav}</div>
            {userBlock}
          </div>
        </div>
      ) : null}

      {/* 主区域 */}
      <div className="md:pl-[212px]">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="rounded-md p-1.5 text-ink-2 hover:bg-line-2"
            aria-label="打开菜单"
          >
            <Menu size={18} />
          </button>
          <span className="text-[13.5px] font-medium text-ink">宿藤家居 ERP</span>
        </header>

        <main className="mx-auto max-w-[1120px] px-4 py-5 sm:px-6 sm:py-7">{children}</main>
      </div>

      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}
