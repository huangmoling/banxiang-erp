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
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

/**
 * 商品概况里的小格。
 *
 * 在玻璃卡片里再放四块小玻璃会糊成一片，所以这里用"井"（.well）：
 * 比卡片沉一层、更透、不模糊。mac 的偏好面板就是这么分层的。
 */
function MiniStat({
  label,
  value,
  unit,
  icon: Icon,
  href,
  tone = "neutral",
}: {
  label: string;
  value: number;
  unit: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  href?: string;
  tone?: "neutral" | "warn";
}) {
  const inner = (
    <div className="well flex items-center gap-2.5 rounded-[11px] px-3 py-2.5 transition-colors hover:border-line">
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] ${
          tone === "warn" ? "bg-warn/14 text-warn" : "bg-ink/[0.06] text-ink-2"
        }`}
      >
        <Icon size={14} strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11px] leading-tight text-muted">{label}</div>
        <div className="tnum mt-0.5 text-[15px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {value}
          <span className="ml-0.5 text-[10.5px] font-normal text-muted">{unit}</span>
        </div>
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
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
  const greet =
    hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${greet}，${user?.displayName ?? "你好"}`}
        meta={today}
        actions={
          <>
            <Link href="/inbound/new" className="btn-ghost">
              <ArrowDownToLine size={14} strokeWidth={2} />
              登记入库
            </Link>
            <Link href="/outbound/new" className="btn-primary">
              登记出库
              <ArrowRight size={14} strokeWidth={2.2} />
            </Link>
          </>
        }
      />

      {/*
        待发货：整个首页最该被看见的一件事。
        做成一块"染了红的玻璃"——不是alert条、不是红色卡片阵列，
        是整页唯一带情绪的表面。数字 30px 当主角，其余全是注脚。
        用包裹数而不是张数：一单可能装几十个买家地址，张数会严重低估工作量。
      */}
      {pending.packages > 0 ? (
        <Link href="/outbound?status=pending" className="group block">
          <div className="card relative overflow-hidden border-danger/25 bg-danger/[0.07] px-4 py-3.5 transition-all duration-200 hover:bg-danger/[0.1]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-danger/14 text-danger">
                <BellRing size={17} strokeWidth={1.9} />
              </div>

              <div className="flex shrink-0 items-baseline gap-1.5">
                <span className="tnum text-[30px] font-semibold leading-none tracking-[-0.03em] text-danger">
                  {pending.packages}
                </span>
                <span className="text-[12px] font-medium text-danger/90">个包裹待发</span>
              </div>

              <div className="h-8 w-px shrink-0 bg-danger/20" />

              <div className="min-w-[160px] flex-1 text-[11.5px] leading-relaxed text-ink-2">
                共 {pending.total} 张单 · 今天提交 {pending.today} 个
                {pending.overdue > 0 ? (
                  <span className="ml-1 font-medium text-danger">
                    隔天没发 {pending.overdue} 个
                  </span>
                ) : null}
                {pending.oldestAt ? ` · 最早一张 ${formatDateTime(pending.oldestAt)}` : ""}
              </div>

              <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-danger">
                去处理
                <ArrowRight
                  size={13}
                  strokeWidth={2.4}
                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                />
              </span>
            </div>
          </div>
        </Link>
      ) : null}

      {/* 四个核心数字 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="当前在库"
          value={data.stock.onHand}
          unit="件"
          icon={<Boxes size={14} strokeWidth={1.9} />}
          hint={
            data.stock.defective > 0
              ? `不含次品区（次品区 ${data.stock.defective} 件）`
              : "不含次品区"
          }
          href="/inventory"
        />
        <StatTile
          label="本月入库"
          value={data.stock.inboundThisMonth}
          unit="件"
          icon={<ArrowDownToLine size={14} strokeWidth={1.9} />}
          hint="按业务日期统计到本月"
        />
        <StatTile
          label="本月出库"
          value={data.stock.outboundThisMonth}
          unit="件"
          icon={<ArrowUpFromLine size={14} strokeWidth={1.9} />}
          hint="已审核的出库单"
        />
        <StatTile
          label="本月退货"
          value={data.stock.returnedThisMonth}
          unit="件"
          icon={<Undo2 size={14} strokeWidth={1.9} />}
          hint="含次品区与报废"
        />
      </div>

      {!data.flowReady ? (
        <div className="card flex items-start gap-2.5 border-warn/30 bg-warn/[0.08] px-3.5 py-3 text-[12px] leading-5 text-warn">
          <CircleAlert size={15} strokeWidth={2} className="mt-0.5 shrink-0" />
          <div>
            上面四个数字目前都是 0 —— 出入库流水还没接入，这是第一阶段的正常状态。
            入库功能上线后，这里会自动开始统计。
          </div>
        </div>
      ) : null}

      <div className="grid items-start gap-3.5 lg:grid-cols-[1.34fr_1fr]">
        <Card>
          <CardHeader
            title="商品概况"
            description="一个产品下按颜色分行，一色一个 SKU"
            actions={
              <Link
                href="/products"
                className="flex items-center gap-1 text-[12px] font-medium text-brand-ink hover:underline"
              >
                查看全部 <ArrowRight size={12} strokeWidth={2.2} />
              </Link>
            }
          />
          <div className="p-3.5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
              <MiniStat
                label="产品数"
                value={data.products.total}
                unit="款"
                icon={Package}
                href="/products"
              />
              <MiniStat
                label="颜色行（SKU）"
                value={data.products.skuTotal}
                unit="个"
                icon={Palette}
              />
              <MiniStat label="分类" value={data.products.categories} unit="个" icon={Tags} />
              <MiniStat
                label="待完善"
                value={data.products.pending}
                unit="款"
                icon={CircleAlert}
                href="/products?status=pending"
                tone={data.products.pending > 0 ? "warn" : "neutral"}
              />
            </div>

            {data.products.pending > 0 ? (
              <div className="mt-2.5 rounded-[11px] bg-warn/[0.1] px-3 py-2.5 text-[11.5px] leading-5 text-ink-2">
                有 <b className="tnum text-warn">{data.products.pending}</b> 款产品还没传图片。
                图片只影响找货时的识别速度，不影响入库，有空再补即可。
              </div>
            ) : (
              <div className="mt-2.5 rounded-[11px] bg-ok/[0.1] px-3 py-2.5 text-[11.5px] leading-5 text-ink-2">
                产品档案都齐了。接下来可以开始登记入库。
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="最近操作"
            actions={<Badge tone="neutral">{data.recent.length} 条</Badge>}
          />
          {data.recent.length === 0 ? (
            <EmptyState
              compact
              icon={<Boxes size={18} strokeWidth={1.7} />}
              title="还没有操作记录"
              description="建一个产品、登一张入库单，这里就会开始记录。"
              action={
                <Link href="/products/new" className="btn-ghost btn-sm">
                  新建产品
                </Link>
              }
            />
          ) : (
            <ul className="px-3.5 py-2.5">
              {data.recent.map((r, i) => (
                <li key={r.id} className="relative flex gap-2.5 pb-2.5 last:pb-0">
                  {/* 时间轴：竖线 + 点，比一列孤立的圆点更像"发生过什么" */}
                  {i < data.recent.length - 1 ? (
                    <span className="absolute left-[2.5px] top-3 h-full w-px bg-line" />
                  ) : null}
                  <span className="relative mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted/50 ring-2 ring-card/0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] leading-snug text-ink">{r.summary}</div>
                    <div className="mt-0.5 text-[10.5px] text-muted">
                      {r.actor} · {formatRelative(r.at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
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
