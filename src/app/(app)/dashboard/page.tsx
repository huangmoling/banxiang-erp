import Link from "next/link";
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, BellRing, Package, Trash2, TriangleAlert, Undo2, Warehouse } from "lucide-react";
import { getSession } from "@/lib/session";
import { formatDateTime } from "@/lib/date";
import { dashboardService } from "@/modules/dashboard/dashboard.service";
import { outboundService } from "@/modules/outbound/outbound.service";
import { WorkbenchTiles } from "./workbench-tiles";

export const dynamic = "force-dynamic";

function Kpi({ label, value, unit, href, icon: Icon, accent }: {
  label: string; value: number; unit: string; href?: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  accent: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
}) {
  const body = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ background: `rgb(var(--c-a${accent}) / 0.1)`, color: `rgb(var(--c-a${accent}))` }}>
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] text-muted">{label}</span>
        <span className="mt-1 flex items-baseline gap-1.5">
          <span className="tnum text-[25px] font-semibold leading-none tracking-[-0.04em] text-ink">{value}</span>
          <span className="text-[11px] text-muted">{unit}</span>
        </span>
      </span>
    </>
  );
  const cls = "card flex min-w-0 items-center gap-3 px-4 py-4 transition-colors hover:border-brand/40";
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export default async function DashboardPage() {
  const [user, data, pending] = await Promise.all([
    getSession(),
    dashboardService.overview(),
    outboundService.pendingSummary(),
  ]);

  const today = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  const hour = new Date().getHours();
  const greet = hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 text-[12px] font-medium text-muted">{today}</div>
          <h1 className="text-[24px] font-semibold tracking-[-0.035em] text-ink">{greet}，{user?.displayName ?? "你好"}</h1>
        </div>
        <Link href="/reports" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-card px-3 text-[13px] font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand-ink">
          报表中心 <ArrowRight size={14} />
        </Link>
      </div>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="库存经营概览">
        <Kpi label="当前在库" value={data.stock.onHand} unit="件" href="/inventory" icon={Warehouse} accent={1} />
        <Kpi label="本月入库" value={data.stock.inboundThisMonth} unit="件" icon={ArrowDownToLine} accent={5} />
        <Kpi label="本月出库" value={data.stock.outboundThisMonth} unit="件" icon={ArrowUpFromLine} accent={2} />
        <Kpi label="本月退货" value={data.stock.returnedThisMonth} unit="件" icon={Undo2} accent={3} />
      </section>

      {pending.packages > 0 ? (
        <Link href="/outbound?status=pending" className="group flex flex-wrap items-center gap-3 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 transition-colors hover:border-danger/50">
          <BellRing size={17} className="shrink-0 text-danger" />
          <span className="tnum text-xl font-semibold text-danger">{pending.packages}</span>
          <span className="text-[13px] font-medium text-ink">个包裹待发</span>
          <span className="text-[12px] text-muted">{pending.total} 张单{pending.overdue > 0 ? ` · ${pending.overdue} 个已超一天` : ""}{pending.oldestAt ? ` · 最早 ${formatDateTime(pending.oldestAt)}` : ""}</span>
          <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-danger">处理出库 <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
        </Link>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-ink">快捷操作</h2>
        </div>
        <WorkbenchTiles pendingPackages={pending.packages} productsTotal={data.products.total} onHand={data.stock.onHand} defective={data.stock.defective} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)]">
        <section className="card overflow-hidden">
          <div className="flex h-12 items-center justify-between border-b border-line-2 px-4">
            <h2 className="text-[14px] font-semibold text-ink">最近操作</h2>
            <span className="tnum text-[12px] text-muted">{data.recent.length}</span>
          </div>
          {data.recent.length === 0 ? (
            <div className="px-4 py-12 text-center text-[13px] text-muted">暂无操作记录</div>
          ) : (
            <ul>
              {data.recent.map((r) => (
                <li key={r.id} className="flex min-w-0 items-center gap-3 border-b border-line-2 px-4 py-3 last:border-0 hover:bg-sunken/50">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-brand/70" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{r.summary}</span>
                  <span className="shrink-0 text-[11px] text-muted">{r.actor} · {formatRelative(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="flex h-12 items-center border-b border-line-2 px-4">
            <h2 className="text-[14px] font-semibold text-ink">需要关注</h2>
          </div>
          <div className="divide-y divide-line-2">
            <Link href="/products?status=pending" className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-sunken/50">
              <Package size={16} className="text-brand" />
              <span className="min-w-0 flex-1 text-[13px] text-ink-2">待完善商品</span>
              <span className="tnum text-[14px] font-semibold text-ink">{data.products.pending}</span>
            </Link>
            <Link href="/defective" className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-sunken/50">
              <TriangleAlert size={16} className="text-danger" />
              <span className="min-w-0 flex-1 text-[13px] text-ink-2">次品待处置</span>
              <span className="tnum text-[14px] font-semibold text-ink">{data.stock.defective}</span>
            </Link>
            <Link href="/scraps" className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-sunken/50">
              <Trash2 size={16} className="text-muted" />
              <span className="min-w-0 flex-1 text-[13px] text-ink-2">报废处置</span>
              <ArrowRight size={14} className="text-muted" />
            </Link>
            <Link href="/products" className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-sunken/50">
              <Warehouse size={16} className="text-brand" />
              <span className="min-w-0 flex-1 text-[13px] text-ink-2">颜色 SKU</span>
              <span className="tnum text-[14px] font-semibold text-ink">{data.products.skuTotal}</span>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}
