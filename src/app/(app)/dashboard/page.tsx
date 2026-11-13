import Link from "next/link";
import { ArrowRight, BellRing, Package, Trash2, TriangleAlert, Warehouse } from "lucide-react";
import { getSession } from "@/lib/session";
import { formatDateTime } from "@/lib/date";
import { dashboardService } from "@/modules/dashboard/dashboard.service";
import { outboundService } from "@/modules/outbound/outbound.service";
import { WorkbenchTiles } from "./workbench-tiles";

export const dynamic = "force-dynamic";

/**
 * 工作台 —— 三态里最深的一态。
 *
 * 整块深色画布 + 八个纯色磁贴。为什么深：这是"开始干活"的地方，
 * 和翻单据的浅色页面拉开距离，人一眼就知道自己在哪。
 *
 * 磁贴只做两件事：说清"这是干嘛的"，给一个"现在有多少"。
 * 不放图标底板、不放渐变、不放阴影——色块本身就是信息（类别），
 * 状态（青/赭/红/灰圆点）永远不进磁贴，两套色板不混用。
 */

/** 深色面上的数字格：标签在上、数字在下，靠 1px 竖线分格，不画卡片 */
function Cell({
  label,
  value,
  unit,
  href,
}: {
  label: string;
  value: number;
  unit: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="text-[11px] leading-tight text-deep-muted">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="tnum text-[21px] font-semibold leading-none tracking-[-0.02em] text-deep-fg">
          {value}
        </span>
        <span className="text-[10.5px] text-deep-muted">{unit}</span>
      </div>
    </>
  );
  return href ? (
    <Link href={href} className="block px-3 py-2.5 transition-colors hover:bg-white/[0.03]">
      {body}
    </Link>
  ) : (
    <div className="px-3 py-2.5">{body}</div>
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
    <div className="px-3 py-4 sm:px-5 sm:py-5">
      {/* 抬头：只留问候 + 日期，深色画布上再多一行字都是噪音 */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[21px] font-semibold leading-tight tracking-[-0.015em] text-deep-fg">
            {greet}，{user?.displayName ?? "你好"}
          </h1>
          <p className="mt-1 text-[11.5px] text-deep-muted">
            {today}
            {pending.packages > 0 ? ` · ${pending.packages} 个包裹等着发` : " · 暂时没有待发的包裹"}
          </p>
        </div>
        <Link
          href="/reports"
          className="flex items-center gap-1 text-[11.5px] text-deep-fg2 transition-colors hover:text-deep-fg"
        >
          看报表
          <ArrowRight size={12} strokeWidth={2.2} />
        </Link>
      </div>

      {/* 数据带：四个数字一行，竖线分格。数字是"盘子有多大"，磁贴是"能干什么" */}
      <div className="mb-2 grid grid-cols-2 divide-x divide-white/[0.07] overflow-hidden rounded-[6px] border border-white/[0.07] bg-deep-card sm:grid-cols-4 sm:divide-x">
        <Cell label="当前在库" value={data.stock.onHand} unit="件" href="/inventory" />
        <Cell label="本月入库" value={data.stock.inboundThisMonth} unit="件" />
        <Cell label="本月出库" value={data.stock.outboundThisMonth} unit="件" />
        <Cell label="本月退货" value={data.stock.returnedThisMonth} unit="件" />
      </div>

      {/* 待发货：整个工作台唯一带情绪的一条，只在真有活时出现 */}
      {pending.packages > 0 ? (
        <Link
          href="/outbound?status=pending"
          className="group mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[6px] border border-danger/35 bg-danger/[0.16] px-3 py-2.5 transition-colors hover:bg-danger/[0.22]"
        >
          <BellRing size={14} strokeWidth={2} className="shrink-0 text-[#E8907F]" />
          <span className="tnum text-[17px] font-semibold leading-none text-[#F0B4A8]">
            {pending.packages}
          </span>
          <span className="text-[11.5px] text-[#E3AFA4]">个包裹待发</span>
          <span className="text-[11px] text-white/45">
            {pending.total} 张单
            {pending.today > 0 ? ` · 今天提交 ${pending.today} 个` : ""}
            {pending.overdue > 0 ? ` · 隔天没发 ${pending.overdue} 个` : ""}
            {pending.oldestAt ? ` · 最早 ${formatDateTime(pending.oldestAt)}` : ""}
          </span>
          <span className="ml-auto flex items-center gap-1 text-[11.5px] text-[#F0B4A8]">
            去处理
            <ArrowRight size={12} strokeWidth={2.4} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      ) : null}

      {/* 八个磁贴（客户端组件：上排四个直接开抽屉，下排四个跳列表） */}
      <WorkbenchTiles
        pendingPackages={pending.packages}
        productsTotal={data.products.total}
        onHand={data.stock.onHand}
        defective={data.stock.defective}
      />

      {/* 下半区：最近操作 + 待打理的事 */}
      <div className="mt-2 grid gap-2 lg:grid-cols-[1.55fr_1fr]">
        <section className="overflow-hidden rounded-[6px] border border-white/[0.07] bg-deep-card">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
            <h2 className="text-[12px] font-medium text-deep-fg">最近操作</h2>
            <span className="text-[10.5px] text-deep-muted">{data.recent.length} 条</span>
          </div>
          {data.recent.length === 0 ? (
            <div className="px-3 py-10 text-center text-[11.5px] text-deep-muted">
              还没有操作记录。建一个产品、登一张入库单，这里就会开始记。
            </div>
          ) : (
            <ul>
              {data.recent.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-2.5 border-b border-white/[0.05] px-3 py-2 last:border-b-0"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/25" />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-deep-fg2">
                    {r.summary}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-deep-muted">
                    {r.actor} · {formatRelative(r.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="overflow-hidden rounded-[6px] border border-white/[0.07] bg-deep-card">
          <div className="border-b border-white/[0.06] px-3 py-2">
            <h2 className="text-[12px] font-medium text-deep-fg">待打理</h2>
          </div>
          <div className="divide-y divide-white/[0.05]">
            <Link
              href="/products?status=pending"
              className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
            >
              <Package size={13} strokeWidth={1.9} className="shrink-0 text-deep-muted" />
              <span className="min-w-0 flex-1 text-[11.5px] text-deep-fg2">档案待完善</span>
              <span className="tnum text-[12px] font-medium text-deep-fg">
                {data.products.pending}
              </span>
              <span className="text-[10.5px] text-deep-muted">款</span>
            </Link>
            <Link
              href="/defective"
              className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
            >
              <TriangleAlert size={13} strokeWidth={1.9} className="shrink-0 text-deep-muted" />
              <span className="min-w-0 flex-1 text-[11.5px] text-deep-fg2">次品待处置</span>
              <span className="tnum text-[12px] font-medium text-deep-fg">
                {data.stock.defective}
              </span>
              <span className="text-[10.5px] text-deep-muted">件</span>
            </Link>
            <Link
              href="/scraps"
              className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
            >
              <Trash2 size={13} strokeWidth={1.9} className="shrink-0 text-deep-muted" />
              <span className="min-w-0 flex-1 text-[11.5px] text-deep-fg2">报废处置</span>
              <ArrowRight size={12} className="text-deep-muted" />
            </Link>
            <Link
              href="/products"
              className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
            >
              <Warehouse size={13} strokeWidth={1.9} className="shrink-0 text-deep-muted" />
              <span className="min-w-0 flex-1 text-[11.5px] text-deep-fg2">颜色行（SKU）</span>
              <span className="tnum text-[12px] font-medium text-deep-fg">
                {data.products.skuTotal}
              </span>
              <span className="text-[10.5px] text-deep-muted">个</span>
            </Link>
          </div>
          {!data.flowReady ? (
            <div className="border-t border-white/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-deep-muted">
              出入库流水还没接入时，上面这些数字都会是 0，属正常。
            </div>
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
