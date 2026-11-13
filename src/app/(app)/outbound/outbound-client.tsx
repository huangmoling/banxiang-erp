"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpFromLine, ChevronRight } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { NewDocButton } from "@/components/new-doc";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/ui/data-table";
import { SkeletonTable } from "@/components/ui/skeleton";
import { ListToolbar, NoticeBar, Pagination, SearchBox, SegmentedFilter } from "@/components/ui/list";
import type { OutboundDocView, OutboundListResult } from "@/modules/outbound/outbound.types";

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

  const hasQuery = debouncedQ.length > 0 || status !== "all";

  return (
    <div className="space-y-3">
      <PageHeader
        title="出库"
        meta={data.total > 0 ? `共 ${data.total} 张` : undefined}
        description={
          <>
            发货就开单。
            <span className="text-ink-2">一行 = 一个包裹 = 一个买家，全部发出后库存才扣。</span>
          </>
        }
        actions={
          <NewDocButton kind="outbound" label="新建出库单" />
        }
      />

      <ListToolbar
        search={
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="搜单号、淘宝订单号、物流单号、产品"
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
              {
                value: "pending",
                label: "待发货",
                count: data.counts.pending,
                tone: "danger",
              },
              { value: "approved", label: "已生效", count: data.counts.approved },
              { value: "draft", label: "草稿", count: data.counts.draft },
            ]}
          />
        }
      />

      {/* 待发货压着没发，是最该被看见的一件事，所以压在最上面 */}
      {data.counts.pending > 0 && status !== "pending" ? (
        <NoticeBar
          tone="danger"
          action={
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
          }
        >
          <b className="tnum text-[15px]">{data.counts.pendingPackages}</b> 个包裹还等着发出去
          <span className="font-normal">（{data.counts.pending} 张单，库存还没扣）</span>
        </NoticeBar>
      ) : null}

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
          有 <b className="tnum">{data.counts.draft}</b> 张草稿还没审核，这些货还没有从库存里扣掉。
        </NoticeBar>
      ) : null}

      {loading ? (
        <SkeletonTable rows={7} cols={7} />
      ) : (
        <DataTable
          minWidth="980px"
          isEmpty={data.items.length === 0}
          empty={
            hasQuery ? (
              <EmptyState
                compact
                icon={<ArrowUpFromLine size={19} strokeWidth={1.6} />}
                title="没有找到匹配的出库单"
                description="换个关键词，或看看别的状态"
              />
            ) : (
              <EmptyState
                icon={<ArrowUpFromLine size={19} strokeWidth={1.6} />}
                title="还没有出库记录"
                description="发货时开一张单，库存就减了"
                action={
                  <NewDocButton kind="outbound" label="登记第一张出库单" />
                }
              />
            )
          }
          head={
            <tr>
              <th className="th w-[170px]">单号 · 淘宝单</th>
              <th className="th w-[112px]">业务日期</th>
              <th className="th">内容</th>
              <th className="th w-[96px] text-right">数量</th>
              <th className="th w-[176px]">收货（一行一个包裹）</th>
              <th className="th w-[150px]">状态</th>
              <th className="th w-[104px]">制单/提交</th>
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
                  href={`/outbound/${doc.id}`}
                  className="tnum whitespace-nowrap font-medium text-ink hover:text-brand-ink"
                >
                  {doc.docNo}
                </Link>
                {doc.externalNo ? (
                  <div className="tnum truncate text-[11.5px] text-muted" title={doc.externalNo}>
                    淘宝 {doc.externalNo}
                  </div>
                ) : null}
              </td>

              <td className="td tnum whitespace-nowrap text-ink-2">{doc.bizDate}</td>

              <td className="td">
                <div className="truncate text-ink-2" title={doc.preview}>
                  {doc.preview || "—"}
                </div>
              </td>

              <td className="td text-right">
                <span className="tnum font-medium">{doc.totalQty}</span>
                <span className="ml-1 text-[11.5px] font-normal text-muted">
                  {doc.items[0]?.unit ?? "件"}
                </span>
              </td>

              {/* 一单多地址以后，这里显示「几个包裹 + 第一个地址」 */}
              <td className="td">
                {doc.itemCount > 1 ? (
                  <>
                    <div className="flex items-baseline gap-1 text-[12.5px] text-ink-2">
                      <span className="tnum font-medium text-ink">{doc.itemCount}</span>
                      个包裹
                      {doc.hasShipped ? (
                        <span className="tnum text-[11px] text-muted">
                          ·已发 {doc.shippedCount}
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-[11.5px] text-muted" title={fullAddress(doc)}>
                      {shortAddress(doc)}
                    </div>
                  </>
                ) : (
                  <div className="truncate text-[12.5px] text-ink-2" title={fullAddress(doc)}>
                    {shortAddress(doc) || "—"}
                  </div>
                )}
              </td>

              <td className="td">
                <StatusBadge doc={doc} />
              </td>

              <td className="td whitespace-nowrap text-[12.5px] text-muted">
                {/* 待发货的单显示"谁提交的"——仓管要找的是那个内勤，不是制单人 */}
                {doc.pendingShip ? (doc.submittedByName ?? "—") : (doc.createdByName ?? "—")}
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
        </DataTable>
      )}
    </div>
  );
}

function firstAddressLine(doc: OutboundDocView): string {
  const raw = doc.items[0]?.receiverInfo;
  if (!raw) return "";
  return raw.split("\n").map((s) => s.trim()).filter(Boolean)[0] ?? "";
}

/** 列表里地址只放得下一行，取第一行再压平空白 */
function shortAddress(doc: OutboundDocView): string {
  const first = firstAddressLine(doc);
  return first.length > 26 ? `${first.slice(0, 26)}…` : first;
}

/** 悬停时给全文，地址被截断时还能核对完整信息 */
function fullAddress(doc: OutboundDocView): string {
  return doc.items
    .map((it) => it.receiverInfo?.trim())
    .filter(Boolean)
    .join("\n———\n");
}

function StatusBadge({ doc }: { doc: OutboundDocView }) {
  // 待发货单独一个标签：它虽然也是 draft，但对仓管来说它是「该干的活」，
  // 不是「别人没填完的单」
  if (doc.pendingShip) {
    const late = (doc.waitedDays ?? 0) > 0;
    return (
      <Badge tone={late ? "danger" : "brand"} dot>
        待发货
        {doc.hasShipped ? (
          <span className="tnum font-normal">
            {doc.shippedCount}/{doc.itemCount}
          </span>
        ) : null}
        {late ? <span className="font-normal">·等 {doc.waitedDays} 天</span> : null}
      </Badge>
    );
  }

  // 部分发出：既不是草稿也不该说「未扣库存」，盯着它的人关心的是还欠几个
  if (doc.status === "draft" && doc.hasShipped) {
    return (
      <Badge tone="brand">
        已发 <span className="tnum">{doc.shippedCount}</span>/
        <span className="tnum">{doc.itemCount}</span>
      </Badge>
    );
  }

  if (doc.status === "approved") return <Badge tone="ok">已生效</Badge>;
  if (doc.status === "voided") return <Badge tone="neutral">已作废</Badge>;
  return <Badge tone="warn">草稿<span className="font-normal">· 未扣库存</span></Badge>;
}
