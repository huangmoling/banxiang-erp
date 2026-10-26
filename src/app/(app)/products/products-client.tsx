"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { ProductThumb } from "@/components/product-thumb";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/ui/data-table";
import { SkeletonTable } from "@/components/ui/skeleton";
import { ListToolbar, NoticeBar, Pagination, SearchBox, SegmentedFilter } from "@/components/ui/list";
import { colorLabel, type ProductListResult, type ProductView } from "@/modules/product/product.types";

const PAGE_SIZE = 20;

type ListStatus = "all" | "pending" | "complete";

export function ProductsClient({
  initial,
  initialStatus = "all",
}: {
  initial: ProductListResult;
  initialStatus?: ListStatus;
}) {
  const router = useRouter();
  const toast = useToast();

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<ListStatus>(initialStatus);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ProductListResult>(initial);
  const [loading, setLoading] = useState(false);
  const [toDelete, setToDelete] = useState<ProductView | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      const result = await api<ProductListResult>(`/api/products?${params.toString()}`);
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

  async function confirmDelete() {
    if (!toDelete || deleting) return;
    setDeleting(true);
    try {
      await api(`/api/products/${toDelete.id}`, { method: "DELETE" });
      toast.success(`已删除「${toDelete.name}」`);
      setToDelete(null);
      await load();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  const hasQuery = debouncedQ.length > 0 || status !== "all";

  return (
    <div className="space-y-3">
      <PageHeader
        title="商品"
        meta={data.total > 0 ? `共 ${data.total} 款` : undefined}
        description={
          <>
            一个产品下按颜色分行，一色一个 SKU。
            <span className="text-ink-2">入库前先把档案建好，仓管现场只选款、填数量。</span>
          </>
        }
        actions={
          <Link href="/products/new" className="btn-primary btn-sm">
            <Plus size={14} />
            新建产品
          </Link>
        }
      />

      <ListToolbar
        search={
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="搜产品名称、拼音首字母（如 boby）"
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
              { value: "pending", label: "待完善", count: data.pendingCount },
              { value: "complete", label: "已完善" },
            ]}
          />
        }
      />

      {data.pendingCount > 0 && status !== "pending" ? (
        <NoticeBar
          action={
            <button
              type="button"
              onClick={() => {
                setStatus("pending");
                setPage(1);
              }}
              className="font-medium underline underline-offset-2 hover:opacity-80"
            >
              只看待完善
            </button>
          }
        >
          有 <b className="tnum">{data.pendingCount}</b> 款产品还没传图，找货时不好认。
        </NoticeBar>
      ) : null}

      {loading ? (
        <SkeletonTable rows={7} cols={5} />
      ) : (
        <DataTable
          minWidth="760px"
          isEmpty={data.items.length === 0}
          empty={
            hasQuery ? (
              <EmptyState
                compact
                icon={<Package size={19} strokeWidth={1.6} />}
                title="没有找到匹配的产品"
                description="换个关键词试试，或者直接新建一款"
                action={
                  <Link href="/products/new" className="btn-ghost btn-sm">
                    <Plus size={14} />
                    新建产品
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={<Package size={19} strokeWidth={1.6} />}
                title="还没有产品"
                description="先把常卖的款建进来，入库时就能直接选"
                action={
                  <Link href="/products/new" className="btn-primary btn-sm">
                    <Plus size={14} />
                    新建第一个产品
                  </Link>
                }
              />
            )
          }
          head={
            <tr>
              <th className="th">产品</th>
              <th className="th">颜色 · 各色在库（一色一行）</th>
              <th className="th w-[110px] text-right">在库合计</th>
              <th className="th w-[92px]">档案</th>
              <th className="th w-[88px] text-right">操作</th>
            </tr>
          }
          footer={
            <Pagination
              total={data.total}
              page={page}
              pageSize={PAGE_SIZE}
              onChange={setPage}
              unit="款"
            />
          }
        >
          {data.items.map((p) => (
            <tr key={p.id} className="group hover:bg-sunken/70">
              <td className="td">
                <div className="flex items-center gap-3">
                  <ProductThumb url={p.imageUrl} name={p.name} size={36} />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{p.name}</div>
                    <div className="text-[11.5px] text-muted">
                      {p.category ?? "未分类"} · {p.colorCount} 色 · {p.unit}
                    </div>
                  </div>
                </div>
              </td>

              {/*
                颜色标签里直接带在库数。原来这个数只写在 title 提示里，
                要拿鼠标悬一下才看得见——仓管扫货时不会去悬停。
              */}
              <td className="td">
                <div className="flex flex-wrap items-center gap-1">
                  {p.colors.slice(0, 5).map((c) => (
                    <span
                      key={c.id}
                      className={`tag ${
                        c.variantType === "custom"
                          ? "bg-custom-soft text-custom"
                          : "bg-sunken text-ink-2"
                      }`}
                      title={
                        c.variantType === "custom"
                          ? `${colorLabel(c)} · 定制款，按件追踪，退货不可回良品`
                          : `${colorLabel(c)} · 常规款，按数量追踪`
                      }
                    >
                      {colorLabel(c)}
                      <span
                        className={`tnum font-semibold ${
                          c.stock > 0 ? "" : "font-normal text-muted"
                        }`}
                      >
                        {c.stock}
                      </span>
                      {c.variantType === "custom" ? <span>定制</span> : null}
                    </span>
                  ))}
                  {p.colors.length > 5 ? (
                    <span className="tag bg-sunken text-muted">+{p.colors.length - 5}</span>
                  ) : null}
                </div>
              </td>

              <td className="td text-right">
                <span
                  className={`tnum text-[15px] font-semibold ${
                    p.totalStock > 0 ? "text-ink" : "text-muted"
                  }`}
                >
                  {p.totalStock}
                </span>
                <span className="ml-1 text-[11.5px] text-muted">{p.unit}</span>
              </td>

              <td className="td">
                {p.profileStatus === "pending" ? (
                  <Badge tone="warn">待完善</Badge>
                ) : (
                  <Badge tone="ok">已完善</Badge>
                )}
              </td>

              <td className="td">
                <div className="flex items-center justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                  <Link
                    href={`/products/${p.id}/edit`}
                    className="rounded-md p-1.5 text-muted transition-colors hover:bg-line-2 hover:text-brand-ink"
                    title="编辑"
                  >
                    <Pencil size={14} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => setToDelete(p)}
                    className="rounded-md p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      <Modal
        open={!!toDelete}
        title="删除这个产品？"
        description={
          toDelete
            ? `「${toDelete.name}」将被移出商品列表。历史单据不受影响，但以后入库选不到它。`
            : undefined
        }
        onClose={() => setToDelete(null)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setToDelete(null)}>
              取消
            </button>
            <button type="button" className="btn-danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Loader2 size={14} className="animate-spin" /> : null}
              确认删除
            </button>
          </>
        }
      />
    </div>
  );
}
