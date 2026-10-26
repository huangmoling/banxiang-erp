"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError, api } from "@/lib/api-client";
import { DOC_STATUS_LABEL, DOC_STATUS_TONE, type ScrapListResult } from "@/modules/scrap/scrap.types";

type StatusFilter = "all" | "draft" | "approved" | "voided";

const TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "draft", label: "草稿" },
  { key: "approved", label: "已生效" },
  { key: "voided", label: "已红冲" },
];

export function ScrapsClient({
  initial,
  initialStatus,
}: {
  initial: ScrapListResult;
  initialStatus: StatusFilter;
}) {
  const [data, setData] = useState(initial);
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (next: { status: StatusFilter; q: string; page: number }) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          status: next.status,
          q: next.q,
          page: String(next.page),
          pageSize: "20",
        });
        const res = await api<ScrapListResult>(`/api/scraps?${params.toString()}`);
        setData(res);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载失败，请重试");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // 搜索输入防抖：一边打字一边请求会打得后台抬不起头
  useEffect(() => {
    const timer = setTimeout(() => {
      void load({ status, q: q.trim(), page });
    }, 280);
    return () => clearTimeout(timer);
  }, [status, q, page, load]);

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="space-y-4">
      <PageHeader
        title="报废与处置"
        description="次品区的货从这里走出去：转报废、线下出售、自行处理。系统不记价格，只记数量与去向。"
        actions={
          <Link href="/scraps/new" className="btn-primary btn-sm">
            <Plus size={14} />
            新建处置单
          </Link>
        }
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setStatus(tab.key);
                  setPage(1);
                }}
                className={`rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
                  status === tab.key
                    ? "bg-brand-soft font-medium text-brand-ink"
                    : "text-muted hover:bg-line-2 hover:text-ink"
                }`}
              >
                {tab.label}
                {tab.key === "draft" && data.counts.draft > 0 ? (
                  <span className="ml-1 text-[11.5px]">({data.counts.draft})</span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="relative ml-auto w-[240px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="input py-1.5 pl-8 text-[13px]"
              placeholder="搜单号 / 商品名 / 备注"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
            {loading ? (
              <Loader2
                size={14}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted"
              />
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="px-4 py-8 text-center text-[13px] text-danger">{error}</div>
        ) : data.items.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <p className="text-[13.5px] text-muted">还没有处置记录</p>
            <p className="mt-1.5 text-[12.5px] text-muted">
              次品区有货要清走时，从「新建处置单」开始；从次品区页面进去会自动带上那个仓位。
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="th w-[150px]">单号</th>
                <th className="th w-[110px]">业务日期</th>
                <th className="th w-[110px]">源仓位</th>
                <th className="th">内容</th>
                <th className="th w-[80px] text-right">件数</th>
                <th className="th w-[90px]">状态</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((doc) => (
                <tr key={doc.id} className="transition-colors hover:bg-sunken">
                  <td className="td">
                    <Link href={`/scraps/${doc.id}`} className="font-medium text-brand-ink hover:underline">
                      {doc.docNo}
                    </Link>
                  </td>
                  <td className="td tnum text-ink-2">{doc.bizDate}</td>
                  <td className="td text-ink-2">{doc.sourceLocationName ?? "—"}</td>
                  <td className="td text-ink-2">{doc.preview}</td>
                  <td className="td tnum text-right font-medium">{doc.totalQty}</td>
                  <td className="td">
                    <span className={`tag ${DOC_STATUS_TONE[doc.status]}`}>
                      {DOC_STATUS_LABEL[doc.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {totalPages > 1 ? (
          <div className="flex items-center justify-between px-4 py-3 text-[12.5px] text-muted">
            <span>
              共 {data.total} 张，第 {data.page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
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
