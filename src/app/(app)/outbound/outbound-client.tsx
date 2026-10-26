"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpFromLine, ChevronRight, Loader2, Plus, Search } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import {
  DOC_STATUS_LABEL,
  DOC_STATUS_TONE,
  type OutboundDocView,
  type OutboundListResult,
} from "@/modules/outbound/outbound.types";

const PAGE_SIZE = 20;

type ListStatus = "all" | "draft" | "approved" | "pending";

export function OutboundClient({
  initial,
  initialStatus = "all",
}: {
  initial: OutboundListResult;
  initialStatus?: ListStatus;
}) {
  const toast = useToast();

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<ListStatus>(initialStatus);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OutboundListResult>(initial);
  const [loading, setLoading] = useState(false);
  const firstRun = useRef(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: debouncedQ,
        status,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      const result = await api<OutboundListResult>(`/api/outbound?${params.toString()}`);
      setData(result);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "加载失败，请重试");
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, status, page, toast]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">出库</h1>
          <p className="mt-1 text-[12.5px] text-muted">
            发货就开单。审核后库存自动扣减，草稿不影响库存。
          </p>
        </div>
        <Link href="/outbound/new" className="btn-primary btn-sm">
          <Plus size={14} />
          新建出库单
        </Link>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            className="input pl-9"
            placeholder="搜单号、淘宝订单号、物流单号、产品"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="flex rounded-lg border border-line p-0.5">
          {(
            [
              ["all", "全部", null],
              ["pending", "待发货", data.counts.pending],
              ["approved", "已生效", data.counts.approved],
              ["draft", "草稿", data.counts.draft],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setStatus(value);
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors ${
                status === value
                  ? value === "pending"
                    ? "bg-danger-soft font-medium text-danger"
                    : "bg-brand-soft font-medium text-brand-ink"
                  : "text-ink-2 hover:bg-sunken"
              }`}
            >
              {label}
              {count !== null && count > 0 ? (
                <span
                  className={`tnum ml-1 text-[11px] ${
                    value === "pending" && status !== "pending" ? "text-danger" : "text-muted"
                  }`}
                >
                  {count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* 待发货压着没发，是最该被看见的一件事，所以压在最上面 */}
      {data.counts.pending > 0 && status !== "pending" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">
          <b className="tnum text-[15px]">{data.counts.pendingPackages}</b> 个包裹还等着发出去
          <span className="text-danger">（{data.counts.pending} 张单）</span>
          ，库存还没扣。
          <button
            type="button"
            onClick={() => {
              setStatus("pending");
              setPage(1);
            }}
            className="font-medium underline underline-offset-2 hover:opacity-80"
          >
            去确认发货
          </button>
        </div>
      ) : null}

      {data.counts.draft > 0 && status !== "draft" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-warn/40 bg-warn-soft px-3.5 py-2.5 text-[12.5px] text-warn">
          有 <b className="tnum">{data.counts.draft}</b> 张草稿还没审核，这些货还没有从库存里扣掉。
          <button
            type="button"
            onClick={() => {
              setStatus("draft");
              setPage(1);
            }}
            className="underline underline-offset-2 hover:text-warn"
          >
            去处理草稿
          </button>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-muted">
            <Loader2 size={16} className="animate-spin" />
            加载中…
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState hasQuery={debouncedQ.length > 0 || status !== "all"} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead>
                <tr>
                  <th className="th w-[150px]">单号</th>
                  <th className="th w-[104px]">业务日期</th>
                  <th className="th">内容</th>
                  <th className="th w-[92px] text-right">数量</th>
                  <th className="th w-[168px]">收货地址</th>
                  <th className="th w-[92px]">状态</th>
                  <th className="th w-[92px]">制单</th>
                  <th className="th w-[32px]" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((doc) => (
                  <tr key={doc.id} className="group hover:bg-sunken">
                    <td className="td">
                      <Link
                        href={`/outbound/${doc.id}`}
                        className="tnum font-medium text-ink hover:text-brand-ink"
                      >
                        {doc.docNo}
                      </Link>
                    </td>
                    <td className="td tnum text-ink-2">{doc.bizDate}</td>
                    <td className="td">
                      <div className="truncate text-ink-2">{doc.preview || "—"}</div>
                    </td>
                    <td className="td tnum text-right font-medium">
                      {doc.totalQty}
                      <span className="ml-0.5 text-[11.5px] font-normal text-muted">
                        {doc.items[0]?.unit ?? "件"}
                      </span>
                      {doc.hasShipped ? (
                        <div className="text-[11px] font-normal text-muted">
                          已发 {doc.shippedCount}/{doc.itemCount}
                        </div>
                      ) : null}
                    </td>
                    {/* 一单多地址以后，这里显示「几个包裹 + 第一个地址」，
                        比原来单列淘宝订单号信息量大得多 */}
                    <td className="td">
                      {doc.itemCount > 1 ? (
                        <>
                          <div className="text-[12.5px] text-ink-2">
                            {doc.itemCount} 个地址
                          </div>
                          <div className="truncate text-[11.5px] text-muted">
                            {shortAddress(doc)}
                          </div>
                        </>
                      ) : (
                        <div className="truncate text-[12.5px] text-ink-2">
                          {shortAddress(doc) || "—"}
                        </div>
                      )}
                    </td>
                    <td className="td">
                      <StatusTag doc={doc} />
                    </td>
                    <td className="td text-[12.5px] text-muted">
                      {doc.pendingShip ? (
                        <>
                          {doc.submittedByName ?? "—"}
                          <span className="ml-0.5 text-[11px] text-muted">交</span>
                        </>
                      ) : (
                        (doc.createdByName ?? "—")
                      )}
                    </td>
                    <td className="td">
                      <Link
                        href={`/outbound/${doc.id}`}
                        className="text-muted transition-colors group-hover:text-brand-ink"
                        title="查看单据"
                      >
                        <ChevronRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data.total > PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t border-line-2 px-4 py-2.5 text-[12.5px] text-muted">
            <span className="tnum">
              共 {data.total} 张，第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                下一页
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 列表里地址只放得下一行，取第一行再压平空白 */
function shortAddress(doc: OutboundDocView): string {
  const raw = doc.items[0]?.receiverInfo;
  if (!raw) return "";
  const first = raw.split("\n").map((s) => s.trim()).filter(Boolean)[0] ?? "";
  return first.length > 24 ? `${first.slice(0, 24)}…` : first;
}

function StatusTag({ doc }: { doc: OutboundDocView }) {
  // 待发货单独一个标签：它虽然也是 draft，但对仓管来说它是「该干的活」，不是「别人没填完的单」
  if (doc.pendingShip) {
    const late = (doc.waitedDays ?? 0) > 0;
    return (
      <span className={`tag ${late ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand-ink"}`}>
        待发货
        {doc.hasShipped ? (
          <span className="tnum opacity-80">
            {" "}
            {doc.shippedCount}/{doc.itemCount}
          </span>
        ) : null}
        {late ? <span className="opacity-80">·等 {doc.waitedDays} 天</span> : null}
      </span>
    );
  }

  // 部分发出：既不是草稿也不该说「未扣库存」，盯着它的人关心的是还欠几个
  if (doc.status === "draft" && doc.hasShipped) {
    return (
      <span className="tag bg-brand-soft text-brand-ink">
        已发 {doc.shippedCount}/{doc.itemCount}
      </span>
    );
  }

  const status = doc.status;
  return (
    <span className={`tag ${DOC_STATUS_TONE[status]}`}>
      {DOC_STATUS_LABEL[status]}
      {status === "draft" ? <span className="opacity-60">·未扣库存</span> : null}
    </span>
  );
}

function EmptyState({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-sunken text-muted">
        <ArrowUpFromLine size={20} strokeWidth={1.6} />
      </div>
      {hasQuery ? (
        <>
          <p className="text-[13.5px] text-ink-2">没有找到匹配的出库单</p>
          <p className="text-[12.5px] text-muted">换个关键词，或看看别的状态</p>
        </>
      ) : (
        <>
          <p className="text-[13.5px] text-ink-2">还没有出库记录</p>
          <p className="text-[12.5px] text-muted">发货时开一张单，库存就减了</p>
          <Link href="/outbound/new" className="btn-primary btn-sm">
            <Plus size={14} />
            登记第一张出库单
          </Link>
        </>
      )}
    </div>
  );
}
