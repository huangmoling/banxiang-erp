import Link from "next/link";
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, BellRing, Package, Trash2, TriangleAlert, Undo2, Warehouse } from "lucide-react";
import { getSession } from "@/lib/session";
import { formatDateTime } from "@/lib/date";
import { dashboardService } from "@/modules/dashboard/dashboard.service";
import { outboundService } from "@/modules/outbound/outbound.service";
import { WorkbenchTiles } from "./workbench-tiles";
import { WeatherBar } from "./weather-bar";

export const dynamic = "force-dynamic";

/* 工作台 —— 金蝶式：浅灰画布 + 白色 KPI 卡 + 快捷入口 + 待办/动态双栏 */

function Kpi({ label, value, unit, href, icon: Icon, accent }: {
  label: string; value: number; unit: string; href?: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  accent: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
}) {
  const body = (
    <>
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px]"
        style={{ background: `rgb(var(--c-a${accent}) / 0.1)`, color: `rgb(var(--c-a${accent}))` }}
      >
        <Icon size={19} strokeWidth={1.9} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] leading-tight text-muted">{label}</span>
        <span className="mt-1 flex items-baseline gap-1">
          <span className="tnum text-[22px] font-semibold leading-none tracking-[-0.02em] text-ink">{value}</span>
          <span className="text-[11px] text-muted">{unit}</span>
        </span>
      </span>
    </>
  );
  const cls = "card flex items-center gap-3 px-4 py-3.5 transition-all hover:border-brand/50 hover:shadow-pop";
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
    <div>
      {/* 抬头渐变卡：左问候 / 中天气 / 右报表入口 */}
      <div className="grad-card mb-3 grid grid-cols-1 items-center gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="min-w-0">
          <h1 className="text-[19px] font-bold leading-tight tracking-[-0.01em] text-white">{greet}，{user?.displayName ?? "你好"} 👋</h1>
          <p className="mt-1 text-[12.5px] text-white/85">
            {today}
            {pending.packages > 0 ? ` · ${pending.packages} 个包裹等着发` : " · 暂时没有待发的包裹，今天可以轻松点"}
          </p>
        </div>
        <div className="justify-self-start md:justify-self-center">
          <WeatherBar />
        </div>
        <Link href="/reports" className="inline-flex items-center gap-1 justify-self-start rounded-full bg-white px-4 py-2 text-[12.5px] font-semibold text-brand-ink transition-transform hover:scale-[1.03] md:justify-self-end">
          查看报表中心 <ArrowRight size={13} strokeWidth={2.4} />
        </Link>
      </div>

      {/* KPI 四卡 */}
      <div className="mb-2.5 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <Kpi label="当前在库" value={data.stock.onHand} unit="件" href="/inventory" icon={Warehouse} accent={1} />
        <Kpi label="本月入库" value={data.stock.inboundThisMonth} unit="件" icon={ArrowDownToLine} accent={5} />
        <Kpi label="本月出库" value={data.stock.outboundThisMonth} unit="件" icon={ArrowUpFromLine} accent={2} />
        <Kpi label="本月退货" value={data.stock.returnedThisMonth} unit="件" icon={Undo2} accent={3} />
      </div>

      {pending.packages > 0 ? (
        <Link href="/outbound?status=pending" className="group mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3 transition-colors hover:border-danger/60">
          <BellRing size={15} strokeWidth={2} className="shrink-0 text-danger" />
          <span className="tnum text-[18px] font-semibold leading-none text-danger">{pending.packages}</span>
          <span className="text-[12.5px] font-medium text-danger">个包裹待发</span>
          <span className="text-[11.5px] text-ink-2">
            {pending.total} 张单
            {pending.today > 0 ? ` · 今天提交 ${pending.today} 个` : ""}
            {pending.overdue > 0 ? ` · 隔天没发 ${pending.overdue} 个` : ""}
            {pending.oldestAt ? ` · 最早 ${formatDateTime(pending.oldestAt)}` : ""}
          </span>
          <span className="ml-auto flex items-center gap-1 text-[12.5px] font-medium text-danger">
            去处理 <ArrowRight size={13} strokeWidth={2.4} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      ) : null}

      {/* 快捷入口 */}
      <div className="mb-2 flex items-center justify-between px-0.5">
        <h2 className="kd-section-title">快捷入口</h2>
        <span className="text-[11.5px] text-muted">上排开单 · 下排查询</span>
      </div>
      <WorkbenchTiles pendingPackages={pending.packages} productsTotal={data.products.total} onHand={data.stock.onHand} defective={data.stock.defective} />

      {/* 下半区 */}
      <div className="mt-2.5 grid gap-2.5 lg:grid-cols-[1.55fr_1fr]">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="kd-section-title">最近操作</h2>
            <span className="text-[11px] text-muted">{data.recent.length} 条</span>
          </div>
          {data.recent.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12px] text-muted">还没有操作记录。建一个产品、登一张入库单，这里就会开始记。</div>
          ) : (
            <ul>
              {data.recent.map((r) => (
                <li key={r.id} className="flex items-center gap-2.5 border-b border-line-2 px-4 py-2.5 last:border-b-0 hover:bg-sunken/60">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{r.summary}</span>
                  <span className="shrink-0 text-[11px] text-muted">{r.actor} · {formatRelative(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-line px-4 py-2.5"><h2 className="kd-section-title">待办事项</h2></div>
          <div className="divide-y divide-line-2">
            <Link href="/products?status=pending" className="flex items-center gap-2 px-4 py-3 transition-colors hover:bg-sunken/60">
              <Package size={14} strokeWidth={1.9} className="shrink-0 text-brand" />
              <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">档案待完善</span>
              <span className="tnum text-[13px] font-semibold text-ink">{data.products.pending}</span>
              <span className="text-[11px] text-muted">款</span>
            </Link>
            <Link href="/defective" className="flex items-center gap-2 px-4 py-3 transition-colors hover:bg-sunken/60">
              <TriangleAlert size={14} strokeWidth={1.9} className="shrink-0 text-danger" />
              <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">次品待处置</span>
              <span className="tnum text-[13px] font-semibold text-ink">{data.stock.defective}</span>
              <span className="text-[11px] text-muted">件</span>
            </Link>
            <Link href="/scraps" className="flex items-center gap-2 px-4 py-3 transition-colors hover:bg-sunken/60">
              <Trash2 size={14} strokeWidth={1.9} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">报废处置</span>
              <ArrowRight size={13} className="text-muted" />
            </Link>
            <Link href="/products" className="flex items-center gap-2 px-4 py-3 transition-colors hover:bg-sunken/60">
              <Warehouse size={14} strokeWidth={1.9} className="shrink-0 text-brand" />
              <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">颜色行（SKU）</span>
              <span className="tnum text-[13px] font-semibold text-ink">{data.products.skuTotal}</span>
              <span className="text-[11px] text-muted">个</span>
            </Link>
          </div>
          {!data.flowReady ? (
            <div className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-muted">出入库流水还没接入时，上面这些数字都会是 0，属正常。</div>
          ) : null}
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
