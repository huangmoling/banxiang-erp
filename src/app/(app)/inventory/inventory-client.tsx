"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  Search,
  TriangleAlert,
  Warehouse,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/lib/api-client";
import type {
  InventoryBatch,
  InventoryInstance,
  InventoryMovementPage,
  InventorySummary,
} from "@/modules/inventory/inventory.types";
import { bizTypeLabel, INSTANCE_STATUS_LABEL } from "@/modules/inventory/inventory.types";

type Tab = "summary" | "batches" | "instances" | "movements";

const TABS: { key: Tab; label: string; exportKind: string }[] = [
  { key: "summary", label: "按款汇总", exportKind: "inventory" },
  { key: "batches", label: "批次明细", exportKind: "batches" },
  { key: "instances", label: "定制件台账", exportKind: "instances" },
  { key: "movements", label: "库存流水", exportKind: "movements" },
];

const BIZ_TYPES = [
  { value: "all", label: "全部类型" },
  { value: "inbound", label: "采购入库" },
  { value: "outbound", label: "销售出库" },
  { value: "return_in", label: "退货入库" },
  { value: "scrap", label: "报废处置" },
  { value: "stocktake_adjust", label: "盘点调整" },
];

const INSTANCE_STATUS_TONE: Record<string, string> = {
  in_stock: "bg-ok-soft text-ok",
  outbound: "bg-sunken text-muted",
  returned: "bg-warn-soft text-warn",
  defective: "bg-warn-soft text-warn",
  scrapped: "bg-danger-soft text-danger",
  sold_offline: "bg-brand-soft text-brand-ink",
  disposed: "bg-sunken text-muted",
  missing: "bg-danger-soft text-danger",
  voided: "bg-sunken text-muted",
};

function StatCard({
  label,
  value,
  unit,
  hint,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  unit: string;
  hint: string;
  tone?: "default" | "warn";
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between">
        <span className="text-[12.5px] text-muted">{label}</span>
        <Icon
          size={15}
          strokeWidth={1.7}
          className={tone === "warn" ? "text-warn" : "text-muted"}
        />
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span
          className={`tnum text-[28px] font-semibold leading-none tracking-tight ${
            tone === "warn" ? "text-warn" : "text-ink"
          }`}
        >
          {value}
        </span>
        <span className="text-[12px] text-muted">{unit}</span>
      </div>
      <p className="mt-2 text-[11.5px] leading-5 text-muted">{hint}</p>
    </div>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="td py-10 text-center text-[12.5px] text-muted">
        {text}
      </td>
    </tr>
  );
}

export function InventoryClient({ initial }: { initial: InventorySummary }) {
  const [tab, setTab] = useState<Tab>("summary");
  const [q, setQ] = useState("");
  const [summary, setSummary] = useState<InventorySummary>(initial);
  const [batches, setBatches] = useState<InventoryBatch[] | null>(null);
  const [instances, setInstances] = useState<InventoryInstance[] | null>(null);
  const [movements, setMovements] = useState<InventoryMovementPage | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bizType, setBizType] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  /** 搜索防抖：每敲一个字就发请求，仓库里手机热点下会卡成幻灯片 */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQ, setDebouncedQ] = useState("");

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(q.trim()), 260);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (tab === "movements") {
      if (bizType !== "all") params.set("bizType", bizType);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    }
    return params.toString();
  }, [debouncedQ, tab, bizType, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "summary") {
        const data = await api<InventorySummary>(`/api/inventory${queryString ? `?${queryString}` : ""}`);
        setSummary(data);
      } else if (tab === "batches") {
        const data = await api<InventoryBatch[]>(`/api/inventory/batches${queryString ? `?${queryString}` : ""}`);
        setBatches(data);
      } else if (tab === "instances") {
        const data = await api<InventoryInstance[]>(
          `/api/inventory/instances${queryString ? `?${queryString}` : ""}`,
        );
        setInstances(data);
      } else {
        const params = new URLSearchParams(queryString);
        params.set("page", String(page));
        const data = await api<InventoryMovementPage>(`/api/inventory/movements?${params.toString()}`);
        setMovements(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [tab, queryString, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [bizType, from, to, debouncedQ]);

  const exportHref = useMemo(() => {
    const kind = TABS.find((t) => t.key === tab)?.exportKind ?? "inventory";
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (tab === "movements") {
      if (bizType !== "all") params.set("bizType", bizType);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    }
    return `/api/export/${kind}${params.toString() ? `?${params.toString()}` : ""}`;
  }, [tab, debouncedQ, bizType, from, to]);

  const stats = summary.stats;

  return (
    <div className="space-y-4">
      <PageHeader
        title="库存"
        description="库存数字全部由流水推导，没有任何地方可以直接改数。要改只能开单或红冲。"
        actions={
          <a className="btn-ghost btn-sm" href={exportHref} download>
            <Download size={14} strokeWidth={1.8} />
            导出当前表格
          </a>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="可售在库"
          value={stats.onHand}
          unit="件"
          hint="主仓可发货的件数，不含次品区与报废区"
          icon={Warehouse}
        />
        <StatCard
          label="次品区"
          value={stats.defective}
          unit="件"
          hint="不计入可售，需要用处置单消化"
          icon={TriangleAlert}
        />
        <StatCard
          label="报废区"
          value={stats.scrap}
          unit="件"
          hint="已判报废、等集中处理的件数"
          icon={ArrowDownToLine}
        />
        <StatCard
          label="有货的款"
          value={stats.stockedSku}
          unit="款"
          hint={
            stats.lowStock > 0 ? `其中 ${stats.lowStock} 款低于安全库存` : "没有低于安全库存的款"
          }
          tone={stats.lowStock > 0 ? "warn" : "default"}
          icon={stats.lowStock > 0 ? TriangleAlert : ArrowUpFromLine}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <div className="flex flex-wrap gap-1 rounded-lg bg-sunken p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                  tab === t.key ? "bg-card text-ink" : "text-ink-2 hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="relative ml-auto w-full sm:w-[220px]">
            <Search
              size={14}
              strokeWidth={1.8}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              className="input py-1.5 pl-8 text-[13px]"
              placeholder="搜索商品 / 颜色 / 单号 / 件号"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {tab === "movements" ? (
            <>
              <select
                className="input w-auto py-1.5 text-[13px]"
                value={bizType}
                onChange={(e) => setBizType(e.target.value)}
              >
                {BIZ_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className="input w-auto py-1.5 text-[13px]"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span className="text-[12px] text-muted">至</span>
              <input
                type="date"
                className="input w-auto py-1.5 text-[13px]"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </>
          ) : null}
        </div>

        {error ? (
          <div className="flex items-center gap-2 border-b border-danger/30 bg-danger-soft px-4 py-2.5 text-[12.5px] text-danger">
            <TriangleAlert size={14} strokeWidth={1.8} />
            {error}
          </div>
        ) : null}

        <div className={`overflow-x-auto ${loading ? "opacity-60" : ""}`}>
          {tab === "summary" ? (
            <table className="w-full min-w-[860px]">
              <thead>
                <tr>
                  <th className="th">商品</th>
                  <th className="th">颜色</th>
                  <th className="th">规格</th>
                  <th className="th text-right">可售在库</th>
                  <th className="th text-right">次品区</th>
                  <th className="th text-right">报废区</th>
                  <th className="th text-right">安全库存</th>
                  <th className="th text-right">在库批次</th>
                  <th className="th text-right">最近变动</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.length === 0 ? (
                  <EmptyRow colSpan={9} text="没有符合条件的款。换个搜索词，或先去入库建货。" />
                ) : (
                  summary.rows.map((row) => (
                    <tr key={row.skuId} className="hover:bg-sunken">
                      <td className="td">
                        <span className="flex items-center gap-1.5">
                          {row.productName}
                          {row.variantType === "custom" ? (
                            <span className="tag bg-custom-soft text-custom">定制</span>
                          ) : null}
                          {row.isLow ? (
                            <span className="tag bg-warn-soft text-warn">偏低</span>
                          ) : null}
                        </span>
                      </td>
                      <td className="td text-ink-2">{row.colorName ?? "无颜色"}</td>
                      <td className="td text-muted">{row.unit}</td>
                      <td className="td tnum text-right">
                        <span
                          className={
                            row.onHand > 0 ? "font-medium text-ink" : "text-muted"
                          }
                        >
                          {row.onHand}
                        </span>
                        {row.variantType === "custom" && row.customCount > 0 ? (
                          <span className="ml-1 text-[11.5px] text-muted">（{row.customCount} 件在库）</span>
                        ) : null}
                      </td>
                      <td className="td tnum text-right text-ink-2">
                        {row.defective > 0 ? row.defective : <span className="text-muted">—</span>}
                      </td>
                      <td className="td tnum text-right text-ink-2">
                        {row.scrap > 0 ? row.scrap : <span className="text-muted">—</span>}
                      </td>
                      <td className="td tnum text-right text-muted">
                        {row.safetyStock > 0 ? row.safetyStock : "—"}
                      </td>
                      <td className="td tnum text-right text-muted">
                        {row.batchCount > 0 ? row.batchCount : "—"}
                      </td>
                      <td className="td text-right text-[12.5px] text-muted">
                        {row.lastMovedOn ?? "从未动过"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : null}

          {tab === "batches" ? (
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className="th">批次号</th>
                  <th className="th">商品</th>
                  <th className="th">颜色</th>
                  <th className="th">生产日期</th>
                  <th className="th text-right">账龄</th>
                  <th className="th text-right">余量</th>
                </tr>
              </thead>
              <tbody>
                {!batches || batches.length === 0 ? (
                  <EmptyRow colSpan={6} text="没有还有余量的批次。批次是入库时按生产日期自动建的。" />
                ) : (
                  batches.map((b) => (
                    <tr key={b.id} className="hover:bg-sunken">
                      <td className="td font-medium">{b.batchNo}</td>
                      <td className="td">
                        {b.productName}
                        {b.variantType === "custom" ? (
                          <span className="ml-1.5 tag bg-custom-soft text-custom">定制</span>
                        ) : null}
                      </td>
                      <td className="td text-ink-2">{b.colorName ?? "无颜色"}</td>
                      <td className="td text-ink-2">{b.productionDate ?? "未记录"}</td>
                      <td className="td tnum text-right">
                        {b.ageDays === null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <span
                            className={
                              b.ageDays > 90
                                ? "text-danger"
                                : b.ageDays > 60
                                  ? "text-warn"
                                  : "text-ink-2"
                            }
                          >
                            {b.ageDays} 天
                          </span>
                        )}
                      </td>
                      <td className="td tnum text-right font-medium">
                        {b.quantity}
                        <span className="ml-1 text-[12px] font-normal text-muted">{b.unit}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : null}

          {tab === "instances" ? (
            <table className="w-full min-w-[960px]">
              <thead>
                <tr>
                  <th className="th">件号</th>
                  <th className="th">商品</th>
                  <th className="th">颜色</th>
                  <th className="th">状态</th>
                  <th className="th">所在仓位</th>
                  <th className="th">生产日期</th>
                  <th className="th">入库单</th>
                  <th className="th">出库单</th>
                </tr>
              </thead>
              <tbody>
                {!instances || instances.length === 0 ? (
                  <EmptyRow colSpan={8} text="还没有定制件。定制款每入库一件就自动生成一个编号。" />
                ) : (
                  instances.map((i) => (
                    <tr key={i.id} className="hover:bg-sunken">
                      <td className="td font-medium">{i.code}</td>
                      <td className="td">{i.productName}</td>
                      <td className="td text-ink-2">{i.colorName ?? "无颜色"}</td>
                      <td className="td">
                        <span className={`tag ${INSTANCE_STATUS_TONE[i.status] ?? "bg-sunken text-muted"}`}>
                          {INSTANCE_STATUS_LABEL[i.status] ?? i.status}
                        </span>
                      </td>
                      <td className="td text-ink-2">
                        {i.locationName ?? <span className="text-muted">已离仓</span>}
                      </td>
                      <td className="td text-ink-2">{i.productionDate ?? "—"}</td>
                      <td className="td text-[12.5px]">
                        {i.inboundDocNo ? (
                          <span>
                            {i.inboundDocNo}
                            <span className="ml-1 text-muted">{i.inboundDate}</span>
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="td text-[12.5px]">
                        {i.outboundDocNo ? (
                          <span>
                            {i.outboundDocNo}
                            <span className="ml-1 text-muted">{i.outboundDate}</span>
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : null}

          {tab === "movements" ? (
            <table className="w-full min-w-[980px]">
              <thead>
                <tr>
                  <th className="th">日期</th>
                  <th className="th">类型</th>
                  <th className="th">商品</th>
                  <th className="th">仓位</th>
                  <th className="th text-right">变动</th>
                  <th className="th">单据</th>
                  <th className="th">批次 / 件号</th>
                  <th className="th">备注</th>
                </tr>
              </thead>
              <tbody>
                {!movements || movements.items.length === 0 ? (
                  <EmptyRow colSpan={8} text="这个条件下没有流水。" />
                ) : (
                  movements.items.map((m) => (
                    <tr key={m.id} className="hover:bg-sunken">
                      <td className="td tnum text-[12.5px] text-ink-2">{m.occurredOn}</td>
                      <td className="td">
                        <span className="text-[12.5px]">{bizTypeLabel(m.bizType)}</span>
                        {m.reversal ? (
                          <span className="ml-1.5 tag bg-sunken text-muted">红冲</span>
                        ) : null}
                      </td>
                      <td className="td">
                        {m.productName}
                        <span className="ml-1.5 text-[12px] text-muted">{m.colorName ?? "无颜色"}</span>
                      </td>
                      <td className="td text-[12.5px] text-ink-2">{m.locationName}</td>
                      <td
                        className={`td tnum text-right font-medium ${
                          m.qtyDelta > 0 ? "text-ok" : "text-danger"
                        }`}
                      >
                        {m.qtyDelta > 0 ? `+${m.qtyDelta}` : m.qtyDelta}
                        <span className="ml-0.5 text-[11.5px] font-normal text-muted">{m.unit}</span>
                      </td>
                      <td className="td text-[12.5px]">
                        {m.docNo ? (
                          <span>
                            {m.docNo}
                            {m.docType ? (
                              <span className="ml-1 text-muted">{m.docType}</span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="td text-[12.5px] text-ink-2">
                        {m.batchNo ?? ""}
                        {m.instanceCode ? (
                          <span className={m.batchNo ? "ml-1.5" : ""}>{m.instanceCode}</span>
                        ) : null}
                        {!m.batchNo && !m.instanceCode ? <span className="text-muted">—</span> : null}
                      </td>
                      <td className="td max-w-[240px] truncate text-[12.5px] text-muted" title={m.note ?? ""}>
                        {m.note ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : null}
        </div>

        {tab === "movements" && movements && movements.total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
            <span className="text-[12px] text-muted">
              共 {movements.total} 条，第 {movements.page} / {Math.max(1, Math.ceil(movements.total / movements.pageSize))} 页
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={movements.page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={movements.page >= Math.ceil(movements.total / movements.pageSize) || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <p className="text-[11.5px] leading-5 text-muted">
        提示：一个颜色就是一个款，库存各算各的——「米白 3 把 + 胡桃木 0 把」不会被合并成 4 把。
        定制款按件追踪，件号可在「定制件台账」里查到它的来龙去脉。
      </p>
    </div>
  );
}
