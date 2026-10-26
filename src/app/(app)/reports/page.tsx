import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleAlert,
  Download,
  Layers,
  Recycle,
  Trash2,
  Undo2,
} from "lucide-react";
import { reportService } from "@/modules/report/report.service";
import { BATCH_AGE_LEVEL_TONE, type ReportOverview } from "@/modules/report/report.types";

export const dynamic = "force-dynamic";

function DeltaTag({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-[11.5px] text-muted">上月同期无数据</span>;
  if (delta === 0) return <span className="text-[11.5px] text-muted">与上月同期持平</span>;
  const up = delta > 0;
  return (
    <span className="inline-flex items-center gap-0.5 text-[11.5px] text-ink-2">
      <span className="text-[10px]">{up ? "▲" : "▼"}</span>
      <span className="tnum">{Math.abs(delta)}</span>
      <span className="text-muted">较上月同期</span>
    </span>
  );
}

function BigStat({
  label,
  value,
  delta,
  hint,
  icon: Icon,
}: {
  label: string;
  value: number;
  delta: number | null;
  hint: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between">
        <span className="text-[12.5px] text-muted">{label}</span>
        <Icon size={15} strokeWidth={1.7} className="text-muted" />
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="tnum text-[30px] font-semibold leading-none tracking-tight text-ink">{value}</span>
        <span className="text-[12px] text-muted">件</span>
      </div>
      <div className="mt-2">
        <DeltaTag delta={delta} />
      </div>
      <p className="mt-1 text-[11.5px] leading-5 text-muted">{hint}</p>
    </div>
  );
}

/** 近 12 个月趋势：入库 / 出库两根柱并排。手绘柱状图，不为一张图引一个图表库 */
function TrendChart({ months }: { months: ReportOverview["months"] }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.inbound, m.outbound]));

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-[11.5px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-solid" />
          入库
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-line" />
          出库
        </span>
        <span className="ml-auto">单位：件</span>
      </div>

      <div className="flex items-end gap-2 sm:gap-3">
        {months.map((m) => {
          const inPct = Math.round((m.inbound / max) * 100);
          const outPct = Math.round((m.outbound / max) * 100);
          return (
            <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div className="flex h-[150px] w-full items-end justify-center gap-[3px]">
                <div
                  className="w-2.5 rounded-t-[2px] bg-brand-solid sm:w-3"
                  style={{ height: `${m.inbound === 0 ? 0 : Math.max(3, inPct)}%` }}
                  title={`${m.month} 入库 ${m.inbound} 件`}
                />
                <div
                  className="w-2.5 rounded-t-[2px] bg-line sm:w-3"
                  style={{ height: `${m.outbound === 0 ? 0 : Math.max(3, outPct)}%` }}
                  title={`${m.month} 出库 ${m.outbound} 件`}
                />
              </div>
              <span className="text-[11px] text-muted">{m.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionCard({
  title,
  desc,
  action,
  children,
}: {
  title: string;
  desc?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
          {desc ? <p className="mt-0.5 text-[11.5px] leading-5 text-muted">{desc}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="py-6 text-center text-[12.5px] text-muted">{text}</p>;
}

export default async function ReportsPage() {
  const report = await reportService.overview();

  const { inbound, outbound, returned, disposed } = report.stats;
  const ageTotal = report.batchAging.reduce((s, b) => s + b.qty, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">报表</h1>
          <p className="mt-1 text-[13px] text-muted">
            统计区间：{report.range.label} · {report.range.from} 至 {report.range.to}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-ghost btn-sm" href="/api/export/documents" download>
            <Download size={14} strokeWidth={1.8} />
            单据清单
          </a>
          <a className="btn-ghost btn-sm" href="/api/export/loss" download>
            <Download size={14} strokeWidth={1.8} />
            损耗台账
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BigStat
          label={inbound.label}
          value={inbound.value}
          delta={inbound.delta}
          hint={inbound.hint}
          icon={ArrowDownToLine}
        />
        <BigStat
          label={outbound.label}
          value={outbound.value}
          delta={outbound.delta}
          hint={outbound.hint}
          icon={ArrowUpFromLine}
        />
        <BigStat
          label={returned.label}
          value={returned.value}
          delta={returned.delta}
          hint={returned.hint}
          icon={Undo2}
        />
        <BigStat
          label={disposed.label}
          value={disposed.value}
          delta={disposed.delta}
          hint={disposed.hint}
          icon={Trash2}
        />
      </div>

      <SectionCard
        title="近 12 个月出入库"
        desc="按业务日期归月。作业量统计的是「当月发生过多少」，红冲不会把已经发生过的量抹掉。"
      >
        <TrendChart months={report.months} />
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <SectionCard
            title="本月损耗按款"
            desc="只有「报废处置」单会进这张表：转报废、线下出售、自行处理都算损耗，被红冲的单不计。"
          >
            {report.lossBySku.length === 0 ? (
              <EmptyHint text="本月还没有处置记录" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px]">
                  <thead>
                    <tr>
                      <th className="th">商品</th>
                      <th className="th">颜色</th>
                      <th className="th text-right">件数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.lossBySku.map((row) => (
                      <tr key={row.skuId}>
                        <td className="td">
                          <span className="flex items-center gap-1.5">
                            {row.productName}
                            {row.variantType === "custom" ? (
                              <span className="tag bg-custom-soft text-custom">定制</span>
                            ) : null}
                          </span>
                        </td>
                        <td className="td text-ink-2">{row.colorName ?? "无颜色"}</td>
                        <td className="td tnum text-right font-medium">
                          {row.qty}
                          <span className="ml-1 text-[12px] font-normal text-muted">{row.unit}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard title="低库存预警" desc="只提醒设了安全库存的款。没设安全库存的不打扰。">
            {report.lowStock.length === 0 ? (
              <EmptyHint text="没有低于安全库存的款" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[460px]">
                  <thead>
                    <tr>
                      <th className="th">商品</th>
                      <th className="th">颜色</th>
                      <th className="th text-right">可售在库</th>
                      <th className="th text-right">安全库存</th>
                      <th className="th text-right">还差</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.lowStock.map((row) => (
                      <tr key={row.skuId}>
                        <td className="td">{row.productName}</td>
                        <td className="td text-ink-2">{row.colorName ?? "无颜色"}</td>
                        <td className="td tnum text-right text-danger">{row.onHand}</td>
                        <td className="td tnum text-right text-muted">{row.safetyStock}</td>
                        <td className="td tnum text-right font-medium">
                          {row.gap}
                          <span className="ml-1 text-[12px] font-normal text-muted">{row.unit}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="次品区消化" desc="积压不是问题，出不去才是问题。" >
            <dl className="space-y-2.5">
              <div className="flex items-baseline justify-between">
                <dt className="text-[12.5px] text-muted">当前在区</dt>
                <dd className="tnum text-[20px] font-semibold text-ink">{report.defective.onHand}</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-[12.5px] text-muted">本月流入</dt>
                <dd className="tnum text-[14px] text-ink-2">+{report.defective.inbound}</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-[12.5px] text-muted">本月处置</dt>
                <dd className="tnum text-[14px] text-ink-2">−{report.defective.disposed}</dd>
              </div>
            </dl>

            <div className="mt-3 rounded-lg bg-sunken px-3 py-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[12.5px] text-ink-2">本月消化率</span>
                <span className="tnum text-[16px] font-semibold text-ink">
                  {report.defective.rate === null ? "—" : `${report.defective.rate}%`}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                本月处置 ÷（期初 + 本月流入）。低于 30% 说明次品区在堆。
              </p>
            </div>

            <div className="mt-3 space-y-2">
              {report.lossByDisposition.map((row) => (
                <div key={row.key}>
                  <div className="mb-1 flex items-baseline justify-between text-[12px]">
                    <span className="text-ink-2">{row.label}</span>
                    <span className="tnum text-muted">
                      {row.qty} 件 · {row.percent}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                    <div className="h-full rounded-full bg-brand-solid" style={{ width: `${row.percent}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="批次账龄" desc="按生产日期算。压得久的先想办法动销。">
            {ageTotal === 0 ? (
              <EmptyHint text="还没有在库批次" />
            ) : (
              <ul className="space-y-2">
                {report.batchAging.map((b) => (
                  <li key={b.key} className="flex items-center justify-between gap-2">
                    <span className={`tag ${BATCH_AGE_LEVEL_TONE[b.level]}`}>{b.label}</span>
                    <span className="tnum text-[12.5px] text-ink-2">
                      {b.qty} 件
                      <span className="ml-1.5 text-[11.5px] text-muted">/ {b.batches} 批</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="单据作业量" desc="累计各类型单据张数，红冲过的单另计。">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">类型</th>
                <th className="th text-right">已生效</th>
                <th className="th text-right">草稿</th>
                <th className="th text-right">已作废</th>
              </tr>
            </thead>
            <tbody>
              {report.docs.map((d) => (
                <tr key={d.type}>
                  <td className="td">{d.label}</td>
                  <td className="td tnum text-right">{d.approved}</td>
                  <td className="td tnum text-right text-muted">{d.draft}</td>
                  <td className="td tnum text-right text-muted">{d.voided}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>

        <SectionCard
          title="次品区存量按款"
          desc="这些货不能再当可售发出去，只能处置。"
          action={
            <Link href="/defective" className="text-[12px] text-brand-ink hover:underline">
              去处理
            </Link>
          }
        >
          {report.defective.bySku.length === 0 ? (
            <EmptyHint text="次品区是空的" />
          ) : (
            <ul className="divide-y divide-line">
              {report.defective.bySku.map((row) => (
                <li key={row.skuId} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <span className="min-w-0 truncate text-[13px] text-ink">
                    {row.productName}
                    <span className="ml-1.5 text-[12px] text-muted">{row.colorName ?? "无颜色"}</span>
                  </span>
                  <span className="tnum shrink-0 text-[13px] font-medium text-ink-2">{row.qty}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="这些数字怎么来的" desc="报表出错多半是口径没对齐，先把话说清楚。">
          <ul className="space-y-2 text-[12px] leading-6 text-ink-2">
            <li className="flex gap-2">
              <CircleAlert size={13} className="mt-1 shrink-0 text-muted" />
              出入库数量来自库存流水，只统计主仓，次品区和报废区不算「可售」。
            </li>
            <li className="flex gap-2">
              <Layers size={13} className="mt-1 shrink-0 text-muted" />
              损耗只看报废处置单，被红冲的单不计入；红冲不会取消已经发生过的出入库作业量。
            </li>
            <li className="flex gap-2">
              <Recycle size={13} className="mt-1 shrink-0 text-muted" />
              定制款按件追踪，统计里也按件计，与常规款的「把 / 张 / 套」各自用各自的单位。
            </li>
            <li className="flex gap-2">
              <ArrowDownToLine size={13} className="mt-1 shrink-0 text-muted" />
              同比一律跟「上月同期」比，不跟上月整月比——月初看整月比永远像暴跌。
            </li>
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
