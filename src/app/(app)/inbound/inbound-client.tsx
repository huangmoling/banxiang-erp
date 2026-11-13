"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ChevronRight } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { NewDocButton } from "@/components/new-doc";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/ui/data-table";
import { DocStatusBadge } from "@/components/ui/doc-status";
import { SkeletonTable } from "@/components/ui/skeleton";
import { ListToolbar, NoticeBar, Pagination, SearchBox, SegmentedFilter } from "@/components/ui/list";
import type { InboundListResult } from "@/modules/inbound/inbound.types";

const PAGE_SIZE = 20;

type ListStatus = "all" | "draft" | "approved";

export function InboundClient({
  initial,
  initialStatus = "all",
}: {
  initial: InboundListResult;
  initialStatus?: ListStatus;
}) {
  const toast = useToast();

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<ListStatus>(initialStatus);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<InboundListResult>(initial);
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
      const result = await api<InboundListResult>(`/api/inbound?${params.toString()}`);
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
        title="入库"
        meta={data.total > 0 ? `共 ${data.total} 张` : undefined}
        description={
          <>
            工厂到货就开单。
            <span className="text-ink-2">审核后库存自动增加，草稿不影响库存。</span>
          </>
        }
        actions={
          <NewDocButton kind="inbound" label="新建入库单" />
        }
      />

      <ListToolbar
        search={<SearchBox value={q} onChange={setQ} placeholder="搜单号、产品或备注" />}
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
          有 <b className="tnum">{data.counts.draft}</b> 张草稿还没审核，这些货还没进库存。
        </NoticeBar>
      ) : null}

      {loading ? (
        <SkeletonTable rows={7} cols={6} />
      ) : (
        <DataTable
          minWidth="880px"
          isEmpty={data.items.length === 0}
          empty={
            hasQuery ? (
              <EmptyState
                compact
                icon={<ArrowDownToLine size={19} strokeWidth={1.6} />}
                title="没有找到匹配的入库单"
                description="换个关键词，或看看别的状态"
              />
            ) : (
              <EmptyState
                icon={<ArrowDownToLine size={19} strokeWidth={1.6} />}
                title="还没有入库记录"
                description="工厂到货时开一张单，库存就有了"
                action={
                  <NewDocButton kind="inbound" label="登记第一张入库单" />
                }
              />
            )
          }
          head={
            <tr>
              <th className="th w-[156px]">单号</th>
              <th className="th w-[124px]">日期 · 仓位</th>
              <th className="th">内容</th>
              <th className="th w-[92px] text-right">数量</th>
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
                  href={`/inbound/${doc.id}`}
                  className="tnum whitespace-nowrap font-medium text-ink hover:text-brand-ink"
                >
                  {doc.docNo}
                </Link>
              </td>

              {/* 仓位挂在日期下面：进货进到哪个仓，比日期更常被追问 */}
              <td className="td">
                <div className="tnum whitespace-nowrap text-[12.5px] text-ink-2">{doc.bizDate}</div>
                <div className="text-[11.5px] text-muted">{doc.locationName ?? "未指定仓位"}</div>
              </td>

              <td className="td">
                <div className="truncate text-ink-2" title={doc.preview}>
                  {doc.preview || "—"}
                </div>
                {doc.remark ? (
                  <div className="truncate text-[11.5px] text-muted" title={doc.remark}>
                    备注：{doc.remark}
                  </div>
                ) : null}
              </td>

              <td className="td text-right">
                <span className="tnum font-medium">{doc.totalQty}</span>
                <span className="ml-1 text-[11.5px] font-normal text-muted">
                  {doc.items[0]?.unit ?? "件"}
                </span>
              </td>

              <td className="td">
                <DocStatusBadge
                  status={doc.status}
                  hint={doc.status === "draft" ? "未入账" : undefined}
                />
              </td>

              <td className="td whitespace-nowrap text-[12.5px] text-muted">{doc.createdByName ?? "—"}</td>

              <td className="td">
                <Link
                  href={`/inbound/${doc.id}`}
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
