"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Plus, Undo2 } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/ui/data-table";
import { DocStatusBadge } from "@/components/ui/doc-status";
import { SkeletonTable } from "@/components/ui/skeleton";
import { ListToolbar, NoticeBar, Pagination, SearchBox, SegmentedFilter } from "@/components/ui/list";
import type { ReturnDocView, ReturnListResult } from "@/modules/returns/return.types";

const PAGE_SIZE = 20;

type ListStatus = "all" | "draft" | "approved";

export function ReturnsClient({
  initial,
  initialStatus = "all",
}: {
  initial: ReturnListResult;
  initialStatus?: ListStatus;
}) {
  const toast = useToast();

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<ListStatus>(initialStatus);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReturnListResult>(initial);
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
      const result = await api<ReturnListResult>(`/api/returns?${params.toString()}`);
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
        title="退货"
        meta={data.total > 0 ? `共 ${data.total} 张` : undefined}
        description={
          <>
            退货必须挂在原出库单上。
            <span className="text-ink-2">收到货先验，再决定回良品架、进次品区还是报废。</span>
          </>
        }
        actions={
          <Link href="/returns/new" className="btn-primary btn-sm">
            <Plus size={14} />
            新建退货单
          </Link>
        }
      />

      <ListToolbar
        search={
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="搜退货单号、原出库单号、淘宝单号、物流单号、产品"
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
          有 <b className="tnum">{data.counts.draft}</b> 张退货草稿还没审核，这些货还没回到账上。
        </NoticeBar>
      ) : null}

      {loading ? (
        <SkeletonTable rows={7} cols={6} />
      ) : (
        <DataTable
          minWidth="940px"
          isEmpty={data.items.length === 0}
          empty={
            hasQuery ? (
              <EmptyState
                compact
                icon={<Undo2 size={19} strokeWidth={1.6} />}
                title="没有找到匹配的退货单"
                description="换个关键词，或看看别的状态"
              />
            ) : (
              <EmptyState
                icon={<Undo2 size={19} strokeWidth={1.6} />}
                title="还没有退货记录"
                description="客户退回货时开一张单，先选原出库单"
                action={
                  <Link href="/returns/new" className="btn-primary btn-sm">
                    <Plus size={14} />
                    登记第一张退货单
                  </Link>
                }
              />
            )
          }
          head={
            <tr>
              <th className="th w-[156px]">退货单号</th>
              <th className="th w-[112px]">退货日期</th>
              <th className="th w-[150px]">原出库单</th>
              <th className="th">退的是什么</th>
              <th className="th w-[132px] text-right">数量 · 去向</th>
              <th className="th w-[136px]">状态</th>
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
                  href={`/returns/${doc.id}`}
                  className="tnum whitespace-nowrap font-medium text-ink hover:text-brand-ink"
                >
                  {doc.docNo}
                </Link>
                {doc.trackingNo ? (
                  <div className="tnum truncate text-[11.5px] text-muted" title={doc.trackingNo}>
                    退回 {doc.trackingNo}
                  </div>
                ) : null}
              </td>

              <td className="td tnum whitespace-nowrap text-ink-2">{doc.bizDate}</td>

              <td className="td">
                {doc.originDocumentId && doc.originDocNo ? (
                  <Link
                    href={`/outbound/${doc.originDocumentId}`}
                    className="tnum whitespace-nowrap text-[12.5px] text-ink-2 hover:text-brand-ink"
                    title="查看原出库单"
                  >
                    {doc.originDocNo}
                  </Link>
                ) : (
                  <span className="text-[12.5px] text-muted">—</span>
                )}
                {doc.originBizDate ? (
                  <div className="tnum text-[11.5px] text-muted">发于 {doc.originBizDate}</div>
                ) : null}
              </td>

              <td className="td">
                <div className="truncate text-ink-2" title={doc.preview}>
                  {doc.preview || "—"}
                </div>
              </td>

              {/*
                退货最该看清的是"退回来的货去哪了"——回良品架是可售库存 +，
                进次品区不是。原来这个信息只在详情页有，列表里看不见。
              */}
              <td className="td text-right">
                <div>
                  <span className="tnum font-medium">{doc.totalQty}</span>
                  <span className="ml-1 text-[11.5px] font-normal text-muted">
                    {doc.items[0]?.unit ?? "件"}
                  </span>
                </div>
                <DestinationLine doc={doc} />
              </td>

              <td className="td">
                <DocStatusBadge
                  status={doc.status}
                  hint={doc.status === "draft" ? "未回库存" : undefined}
                />
              </td>

              <td className="td whitespace-nowrap text-[12.5px] text-muted">{doc.createdByName ?? "—"}</td>

              <td className="td">
                <Link
                  href={`/returns/${doc.id}`}
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

/** 去向汇总：只显示非零项，全 0 时不出声 */
function DestinationLine({ doc }: { doc: ReturnDocView }) {
  const parts: { key: string; label: string; qty: number; cls: string }[] = [
    { key: "good", label: "回架", qty: doc.destinationQty.good ?? 0, cls: "text-ok" },
    { key: "defective", label: "次品", qty: doc.destinationQty.defective ?? 0, cls: "text-warn" },
    { key: "scrap", label: "报废", qty: doc.destinationQty.scrap ?? 0, cls: "text-ink-2" },
  ].filter((p) => p.qty > 0);

  if (parts.length === 0) return null;

  return (
    <div className="tnum flex items-center justify-end gap-1.5 text-[11px]">
      {parts.map((p) => (
        <span key={p.key} className={p.cls}>
          {p.label} {p.qty}
        </span>
      ))}
    </div>
  );
}
