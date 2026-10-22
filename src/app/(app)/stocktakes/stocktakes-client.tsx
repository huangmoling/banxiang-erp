"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, ClipboardCheck, Loader2, Plus, Search } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/date";
import {
  DOC_STATUS_LABEL,
  DOC_STATUS_TONE,
  LOCATION_TYPE_TONE,
  type DocStatus,
  type StocktakeListResult,
} from "@/modules/stocktake/stocktake.types";

const PAGE_SIZE = 20;

export function StocktakesClient({
  initial,
  initialStatus = "all",
}: {
  initial: StocktakeListResult;
  initialStatus?: "all" | "draft" | "approved";
}) {
  const toast = useToast();

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<"all" | "draft" | "approved">(initialStatus);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<StocktakeListResult>(initial);
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
      const result = await api<StocktakeListResult>(`/api/stocktakes?${params.toString()}`);
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
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">盘点</h1>
          <p className="mt-1 text-[12.5px] text-muted">
            按仓位盘一次实物，系统拿账面数对差。盘点期间照常发货，不用停业。
          </p>
        </div>
        <Link href="/stocktakes/new" className="btn-primary btn-sm">
          <Plus size={14} />
          新建盘点单
        </Link>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          />
          <input
            className="input pl-9"
            placeholder="搜盘点单号、仓位、产品名、备注"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="flex rounded-lg border border-line p-0.5">
          {(
            [
              ["all", "全部", null],
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
                  ? "bg-brand-soft font-medium text-brand"
                  : "text-ink-2 hover:bg-[#f4f6f8]"
              }`}
            >
              {label}
              {count !== null && count > 0 ? (
                <span className="tnum ml-1 text-[11px] text-muted">{count}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {data.counts.draft > 0 && status !== "draft" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-[#f0e2c8] bg-warn-soft px-3.5 py-2.5 text-[12.5px] text-[#8a5a15]">
          有 <b className="tnum">{data.counts.draft}</b> 张盘点草稿还没审核，这些差异还没落到账上。
          <button
            type="button"
            onClick={() => {
              setStatus("draft");
              setPage(1);
            }}
            className="underline underline-offset-2 hover:text-[#6d4610]"
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
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr>
                  <th className="th w-[150px]">盘点单号</th>
                  <th className="th w-[132px]">截止时点</th>
                  <th className="th w-[124px]">仓位</th>
                  <th className="th">盘点结果</th>
                  <th className="th w-[96px] text-right">差异</th>
                  <th className="th w-[86px]">状态</th>
                  <th className="th w-[92px]">制单</th>
                  <th className="th w-[32px]" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((doc) => (
                  <tr key={doc.id} className="group hover:bg-[#fafbfc]">
                    <td className="td">
                      <Link
                        href={`/stocktakes/${doc.id}`}
                        className="tnum font-medium text-ink hover:text-brand"
                      >
                        {doc.docNo}
                      </Link>
                    </td>
                    <td className="td tnum text-[12.5px] text-ink-2">
                      {doc.snapshotAt ? formatDateTime(doc.snapshotAt) : doc.bizDate}
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-1.5">
                        <span className="text-ink-2">{doc.locationName ?? "—"}</span>
                        <span className={`tag ${LOCATION_TYPE_TONE[doc.locationType]}`}>
                          {doc.isSellable ? "可售" : "不可售"}
                        </span>
                      </div>
                    </td>
                    <td className="td">
                      <div className="truncate text-ink-2">{doc.preview || "—"}</div>
                    </td>
                    <td className="td tnum text-right">
                      {doc.diffLines === 0 ? (
                        <span className="text-[12.5px] text-muted">账实相符</span>
                      ) : (
                        <span className="text-[12.5px]">
                          {doc.gainQty > 0 ? <span className="text-ok">+{doc.gainQty}</span> : null}
                          {doc.gainQty > 0 && doc.lossQty > 0 ? (
                            <span className="text-muted"> / </span>
                          ) : null}
                          {doc.lossQty > 0 ? (
                            <span className="text-danger">-{doc.lossQty}</span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td className="td">
                      <StatusTag status={doc.status} />
                    </td>
                    <td className="td text-[12.5px] text-muted">{doc.createdByName ?? "—"}</td>
                    <td className="td">
                      <Link
                        href={`/stocktakes/${doc.id}`}
                        className="text-[#c8ccd4] transition-colors group-hover:text-brand"
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

function StatusTag({ status }: { status: DocStatus }) {
  return (
    <span className={`tag ${DOC_STATUS_TONE[status]}`}>
      {DOC_STATUS_LABEL[status]}
      {status === "draft" ? <span className="opacity-60">·未调账</span> : null}
    </span>
  );
}

function EmptyState({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f4f6f8] text-[#c2c8d2]">
        <ClipboardCheck size={20} strokeWidth={1.6} />
      </div>
      {hasQuery ? (
        <>
          <p className="text-[13.5px] text-ink-2">没有找到匹配的盘点单</p>
          <p className="text-[12.5px] text-muted">换个关键词，或看看别的状态</p>
        </>
      ) : (
        <>
          <p className="text-[13.5px] text-ink-2">还没有盘点记录</p>
          <p className="text-[12.5px] text-muted">
            建议每月盘一次；先把主仓盘清，再盘次品区
          </p>
          <Link href="/stocktakes/new" className="btn-primary btn-sm">
            <Plus size={14} />
            开一张盘点单
          </Link>
        </>
      )}
    </div>
  );
}
