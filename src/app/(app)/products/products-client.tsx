"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { ProductThumb } from "@/components/product-thumb";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { colorLabel, type ProductListResult, type ProductView } from "@/modules/product/product.types";

const PAGE_SIZE = 20;

export function ProductsClient({
  initial,
  initialStatus = "all",
}: {
  initial: ProductListResult;
  initialStatus?: "all" | "pending" | "complete";
}) {
  const router = useRouter();
  const toast = useToast();

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<"all" | "pending" | "complete">(initialStatus);
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

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">商品</h1>
          <p className="mt-1 text-[12.5px] text-muted">
            一个产品下按颜色分行，一色一个 SKU。入库前先把档案建好，仓管现场只选款和填数量。
            <span className="text-ink-2">　鼠标移到图片上可看大图。</span>
          </p>
        </div>
        <Link href="/products/new" className="btn-primary btn-sm">
          <Plus size={14} />
          新建产品
        </Link>
      </div>

      {/* 筛选条 */}
      <div className="card flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="input pl-9"
            placeholder="搜产品名称、拼音首字母（如 boby）"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="flex rounded-lg border border-line p-0.5">
          {(
            [
              ["all", "全部"],
              ["pending", "待完善"],
              ["complete", "已完善"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setStatus(value);
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors ${
                status === value ? "bg-brand-soft font-medium text-brand" : "text-ink-2 hover:bg-[#f4f6f8]"
              }`}
            >
              {label}
              {value === "pending" && data.pendingCount > 0 ? (
                <span className="tnum ml-1 text-[11px] text-warn">{data.pendingCount}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {data.pendingCount > 0 && status !== "pending" ? (
        <div className="flex items-center gap-2 rounded-card border border-[#f0e2c8] bg-warn-soft px-3.5 py-2.5 text-[12.5px] text-[#8a5a15]">
          有 <b className="tnum">{data.pendingCount}</b> 款产品还没传图，找货时不好认。
          <button
            type="button"
            onClick={() => {
              setStatus("pending");
              setPage(1);
            }}
            className="underline underline-offset-2 hover:text-[#6d4610]"
          >
            只看待完善
          </button>
        </div>
      ) : null}

      {/* 列表 */}
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
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <th className="th">产品</th>
                  <th className="th">颜色（一色一行）</th>
                  <th className="th w-[86px] text-right">在库</th>
                  <th className="th w-[70px]">单位</th>
                  <th className="th w-[92px]">状态</th>
                  <th className="th w-[96px] text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className="group hover:bg-[#fafbfc]">
                    <td className="td">
                      <div className="flex items-center gap-3">
                        <ProductThumb url={p.imageUrl} name={p.name} size={36} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink">{p.name}</div>
                          <div className="text-[11.5px] text-muted">
                            {p.category ?? "未分类"} · {p.colorCount} 个颜色
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1">
                        {p.colors.slice(0, 4).map((c) => (
                          <span
                            key={c.id}
                            className={`tag ${
                              c.variantType === "custom"
                                ? "bg-[#fdf4e8] text-[#a15f12]"
                                : "bg-[#f2f4f7] text-ink-2"
                            }`}
                            title={
                              c.variantType === "custom"
                                ? `${colorLabel(c)} · 在库 ${c.stock} · 定制款（按件追踪，退货不可回良品）`
                                : `${colorLabel(c)} · 在库 ${c.stock} · 常规款（按数量追踪）`
                            }
                          >
                            {colorLabel(c)}
                            {c.variantType === "custom" ? <span className="opacity-70">·定制</span> : null}
                          </span>
                        ))}
                        {p.colors.length > 4 ? (
                          <span className="tag bg-[#f2f4f7] text-muted">+{p.colors.length - 4}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="td tnum text-right font-medium">
                      {p.totalStock}
                      <span className="ml-0.5 text-[11.5px] font-normal text-muted">{p.unit}</span>
                    </td>
                    <td className="td text-ink-2">{p.unit}</td>
                    <td className="td">
                      {p.profileStatus === "pending" ? (
                        <span className="tag bg-warn-soft text-[#8a5a15]">待完善</span>
                      ) : (
                        <span className="tag bg-ok-soft text-ok">已完善</span>
                      )}
                    </td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/products/${p.id}/edit`}
                          className="rounded-md p-1.5 text-muted transition-colors hover:bg-line-2 hover:text-brand"
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
              </tbody>
            </table>
          </div>
        )}

        {/* 分页 */}
        {data.total > PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t border-line-2 px-4 py-2.5 text-[12.5px] text-muted">
            <span className="tnum">
              共 {data.total} 款，第 {page} / {totalPages} 页
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

function EmptyState({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f4f6f8] text-[#c2c8d2]">
        <Package size={20} strokeWidth={1.6} />
      </div>
      {hasQuery ? (
        <>
          <p className="text-[13.5px] text-ink-2">没有找到匹配的产品</p>
          <p className="text-[12.5px] text-muted">换个关键词试试，或者直接新建</p>
          <Link href="/products/new" className="btn-ghost btn-sm">
            <Plus size={14} />
            新建产品
          </Link>
        </>
      ) : (
        <>
          <p className="text-[13.5px] text-ink-2">还没有产品</p>
          <p className="text-[12.5px] text-muted">先把常卖的款建进来，入库时就能直接选</p>
          <Link href="/products/new" className="btn-primary btn-sm">
            <Plus size={14} />
            新建第一个产品
          </Link>
        </>
      )}
    </div>
  );
}
