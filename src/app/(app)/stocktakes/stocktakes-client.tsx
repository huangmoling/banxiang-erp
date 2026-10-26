"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, ClipboardCheck, Plus } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/ui/data-table";
import { DocStatusBadge } from "@/components/ui/doc-status";
import { SkeletonTable } from "@/components/ui/skeleton";
import { ListToolbar, NoticeBar, Pagination, SearchBox, SegmentedFilter } from "@/components/ui/list";
import { formatDateTime } from "@/lib/date";
import type { StocktakeListResult } from "@/modules/stocktake/stocktake.types";

const PAGE_SIZE = 20;

type ListStatus = "all" | "draft" | "approved";

export function StocktakesClient({
  initial,
  initialStatus = "all",
}: {
  initial: StocktakeListResult;
  initialStatus?: ListStatus;
}) {
  const toast = useToast();

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<ListStatus>(initialStatus);
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

  const hasQuery = debouncedQ.length > 0 || status !== "all";

  return (
    <div className="space-y-3">
      <PageHeader
        title="盘点"
        meta={data.total > 0 ? `共 ${data.total} 张` : undefined}
        description={
          <>
            按仓位盘一次实物，系统拿账面数对差。
            <span className="text-ink-2">盘点期间照常发货，不用停业。</span>
          </>
        }
        actions={
          <Link href="/stocktakes/new" className="btn-primary btn-sm">
            <Plus size={14} />
            新建盘点单
          </Link>
        }
      />

      <ListToolbar
        search={
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="搜盘点单号、仓位、产品名、备注"
          />
        }
        filters={
          <SegmentedFilter<ListStatus>
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={[
              { value: "all", label: "全部" },
              { value: "approved", label: "已生效", count: data.counts.approved },
              { value: "draft", label: "草稿", count: data.counts.draft },
            ]}
          />
        }
      />

      {data.counts.draft > 0 && status !== "draft" ? (
        <NoticeBar
          action={
            <button
              type="button"
              onClick={() => {
                setStatus("draft");
                setPage(1);
              }}
              className="font-medium underline underline-offset-2 hover:opacity-80"
            >
              去处理草稿
            </button>
          }
        >
          有 <b className="tnum">{data.counts.draft}</b> 张盘点草稿还没审核，这些差异还没落到账上。
        </NoticeBar>
      ) : null}

      {loading ? (
        <SkeletonTable rows={7} cols={6} />
      ) : (
        <DataTable
          minWidth="980px"
          isEmpty={data.items.length === 0}
          empty={
            hasQuery ? (
              <EmptyState
                compact
                icon={<ClipboardCheck size={19} strokeWidth={1.6} />}
                title="没有找到匹配的盘点单"
                description="换个关键词，或看看别的状态"
              />
            ) : (
              <EmptyState
                icon={<ClipboardCheck size={19} strokeWidth={1.6} />}
                title="还没有盘点记录"
                description="建议每月盘一次；先把主仓盘清，再盘次品区"
                action={
                  <Link href="/stocktakes/new" className="btn-primary btn-sm">
                    <Plus size={14} />
                    开一张盘点单
                  </Link>
                }
              />
            )
          }
          head={
            <tr>
              <th className="th w-[152px]">盘点单号</th>
              <th className="th w-[136px]">截止时点</th>
              <th className="th w-[136px]">仓位</th>
              <th className="th">盘点结果</th>
              <th className="th w-[124px] text-right">差异</th>
              <th className="th w-[132px]">状态</th>
              <th className="th w-[104px]">制单</th>
              <th className="th w-[36px]" />
            </tr>
          }
          footer={
            <Pagination
              total={data.total}
              page={page}
              pageSize={PAGE_SIZE}
              onChange={setPage}
              unit="张"
            />
          }
        >
          {data.items.map((doc) => (
            <tr key={doc.id} className="group hover:bg-sunken/70">
              <td className="td">
                <Link
                  href={`/stocktakes/${doc.id}`}
                  className="tnum whitespace-nowrap font-medium text-ink hover:text-brand-ink"
                >
                  {doc.docNo}
                </Link>
              </td>

              {/* 截止时点：盘点锁的是某一个瞬间，只写日期会让人误以为盘了一整天 */}
              <td className="td">
                <div className="tnum whitespace-nowrap text-[12.5px] text-ink-2">
                  {doc.snapshotAt ? formatDateTime(doc.snapshotAt) : doc.bizDate}
                </div>
              </td>

              <td className="td">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-ink-2">{doc.locationName ?? "—"}</span>
                  {doc.isSellable ? (
                    <Badge tone="brand">可售</Badge>
                  ) : (
                    <Badge tone="warn">不可售</Badge>
                  )}
                </div>
              </td>

              <td className="td">
                <div className="truncate text-ink-2" title={doc.preview}>
                  {doc.preview || "—"}
                </div>
              </td>

              <td className="td text-right">
                {doc.diffLines === 0 ? (
                  <span className="text-[12.5px] text-muted">账实相符</span>
                ) : (
                  <>
                    <div className="tnum flex items-center justify-end gap-1.5 text-[12.5px] font-medium">
                      {doc.gainQty > 0 ? <span className="text-ok">+{doc.gainQty}</span> : null}
                      {doc.lossQty > 0 ? <span className="text-danger">-{doc.lossQty}</span> : null}
                    </div>
                    <div className="tnum text-[11px] text-muted">{doc.diffLines} 行不符</div>
                  </>
                )}
              </td>

              <td className="td">
                <DocStatusBadge
                  status={doc.status}
                  hint={doc.status === "draft" ? "未调账" : undefined}
                />
              </td>

              <td className="td whitespace-nowrap text-[12.5px] text-muted">{doc.createdByName ?? "—"}</td>

              <td className="td">
                <Link
                  href={`/stocktakes/${doc.id}`}
                  className="text-muted transition-colors group-hover:text-brand-ink"
                  title="查看单据"
                >
                  <ChevronRight size={15} />
                </Link>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
