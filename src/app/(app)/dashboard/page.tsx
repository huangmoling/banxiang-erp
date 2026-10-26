import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  BellRing,
  Boxes,
  CircleAlert,
  Package,
  Palette,
  Tags,
  Undo2,
} from "lucide-react";
import { getSession } from "@/lib/session";
import { formatDateTime } from "@/lib/date";
import { dashboardService } from "@/modules/dashboard/dashboard.service";
import { outboundService } from "@/modules/outbound/outbound.service";

export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  hint,
}: {
  label: string;
  value: number;
  unit: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between">
        <span className="text-[12.5px] text-muted">{label}</span>
        <Icon size={15} strokeWidth={1.7} className="text-muted" />
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="tnum text-[30px] font-semibold leading-none tracking-tight text-ink">{value}</span>
        <span className="text-[12px] text-muted">{unit}</span>
      </div>
      <div className="mt-1.5 text-[11.5px] text-muted">{hint ?? "\u00a0"}</div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  unit,
  icon: Icon,
  href,
}: {
  label: string;
  value: number;
  unit: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  href?: string;
}) {
  const inner = (
    <div className="flex items-center gap-3 rounded-lg border border-line-2 px-3 py-2.5 transition-colors hover:border-line">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sunken text-ink-2">
        <Icon size={15} strokeWidth={1.7} />
      </div>
      <div className="min-w-0">
        <div className="text-[11.5px] text-muted">{label}</div>
        <div className="tnum text-[15px] font-semibold text-ink">
          {value}
          <span className="ml-0.5 text-[11px] font-normal text-muted">{unit}</span>
        </div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default async function DashboardPage() {
  const [user, data, pending] = await Promise.all([
    getSession(),
    dashboardService.overview(),
    outboundService.pendingSummary(),
  ]);

  const today = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());

  const hour = new Date().getHours();
  const greet = hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">
            {greet}，{user?.displayName ?? "你好"}
          </h1>
          <p className="mt-1 text-[12.5px] text-muted">今天是 {today}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/inbound/new" className="btn-ghost btn-sm">
            登记入库
          </Link>
          <Link href="/outbound/new" className="btn-primary btn-sm">
            登记出库
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      {/* 待发货工单：整个首页最该被看见的一件事，所以压在最上面、红底、带箭头。
          一单可能装几十个买家地址，所以数字用「包裹数」——那才是仓管要跑的量 */}
      {pending.packages > 0 ? (
        <Link href="/outbound?status=pending" className="group block">
          <div className="flex items-center gap-3 rounded-card border border-danger/30 border-l-[3px] border-l-danger bg-danger-soft px-3.5 py-3">
            <BellRing size={18} strokeWidth={1.8} className="shrink-0 text-danger" />
            <div className="tnum shrink-0 text-[26px] font-bold leading-none text-danger">
              {pending.packages}
              <span className="ml-0.5 text-[12px] font-medium">个</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-danger">
                {pending.overdue > 0
                  ? `还有 ${pending.packages} 个包裹没发出去`
                  : `今天还有 ${pending.packages} 个包裹没发出去`}
              </div>
              <div className="mt-0.5 text-[11.5px] text-danger">
                共 {pending.total} 张单 · 今天提交 {pending.today} 个
                {pending.overdue > 0 ? ` · 隔天没发 ${pending.overdue} 个` : ""}
                {pending.oldestAt ? ` · 最早一张 ${formatDateTime(pending.oldestAt)}` : ""}
              </div>
            </div>
            <span className="shrink-0 text-[12px] font-semibold text-danger group-hover:opacity-70">
              去处理 →
            </span>
          </div>
        </Link>
      ) : null}

      {/* 四个核心数字 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="当前在库"
          value={data.stock.onHand}
          unit="件"
          icon={Boxes}
          hint={data.stock.defective > 0 ? `不含次品区（次品区 ${data.stock.defective} 件）` : "不含次品区"}
        />
        <StatCard label="本月入库" value={data.stock.inboundThisMonth} unit="件" icon={ArrowDownToLine} />
        <StatCard label="本月出库" value={data.stock.outboundThisMonth} unit="件" icon={ArrowUpFromLine} />
        <StatCard label="本月退货" value={data.stock.returnedThisMonth} unit="件" icon={Undo2} />
      </div>

      {!data.flowReady ? (
        <div className="flex items-start gap-2.5 rounded-card border border-warn/40 bg-warn-soft px-3.5 py-3 text-[12.5px] leading-5 text-warn">
          <CircleAlert size={15} className="mt-0.5 shrink-0" />
          <div>
            上面四个数字目前都是 0 —— 出入库流水还没接入，这是第一阶段的正常状态。
            <span className="text-warn"> 入库功能上线后，这里会自动开始统计。</span>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* 商品概况 */}
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-ink">商品概况</h2>
            <Link href="/products" className="flex items-center gap-1 text-[12.5px] text-brand-ink hover:underline">
              查看全部 <ArrowRight size={13} />
            </Link>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2">
            <MiniStat label="产品数" value={data.products.total} unit="款" icon={Package} href="/products" />
            <MiniStat label="颜色行（SKU）" value={data.products.skuTotal} unit="个" icon={Palette} />
            <MiniStat label="分类" value={data.products.categories} unit="个" icon={Tags} />
            <MiniStat
              label="待完善"
              value={data.products.pending}
              unit="款"
              icon={CircleAlert}
              href="/products?status=pending"
            />
          </div>

          {data.products.pending > 0 ? (
            <div className="mt-3 rounded-lg bg-warn-soft px-3 py-2.5 text-[12.5px] leading-5 text-ink-2">
              有 <b className="tnum text-warn">{data.products.pending}</b> 款产品还没传图片。
              图片只影响找货时的识别速度，不影响入库，有空再补即可。
            </div>
          ) : (
            <div className="mt-3 rounded-lg bg-ok-soft px-3 py-2.5 text-[12.5px] leading-5 text-ink-2">
              产品档案都齐了。接下来可以开始登记入库。
            </div>
          )}
        </section>

        {/* 最近操作 */}
        <section className="card p-4">
          <h2 className="text-[14px] font-semibold text-ink">最近操作</h2>
          {data.recent.length === 0 ? (
            <div className="mt-6 flex flex-col items-center gap-2 py-6 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sunken text-muted">
                <Boxes size={17} strokeWidth={1.7} />
              </div>
              <p className="text-[12.5px] text-muted">还没有操作记录</p>
              <Link href="/products/new" className="text-[12.5px] text-brand-ink hover:underline">
                先建一个产品
              </Link>
            </div>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {data.recent.map((r) => (
                <li key={r.id} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] text-ink">{r.summary}</div>
                    <div className="text-[11px] text-muted">
                      {r.actor} · {formatRelative(r.at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
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
