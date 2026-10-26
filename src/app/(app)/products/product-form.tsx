"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowLeft, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { FormTitle, InlineError } from "@/components/ui/doc";
import { UNIT_OPTIONS, type ProductView } from "@/modules/product/product.types";

type ColorRow = {
  key: string;
  id?: string;
  colorName: string;
  variantType: "normal" | "custom";
  safetyStock: number;
};

type Meta = { categories: string[]; colors: string[] };

type ConflictInfo = {
  existing: { id: string; name: string; colors?: { colorName: string | null; variantType: string }[] };
  hint?: string;
};

let seq = 0;
const rowKey = () => `r${++seq}`;

/**
 * 商品档案表单。两种用法：
 * - 独立页面：/products/new、/products/:id/edit
 * - 内嵌：入库页「＋ 新建产品」弹窗（embedded + onSaved），
 *   两条路径用的是同一张表单、同一套校验，产出的档案完全一致。
 */
export function ProductForm({
  mode,
  initial,
  embedded = false,
  onSaved,
}: {
  mode: "create" | "edit";
  initial?: ProductView;
  embedded?: boolean;
  onSaved?: (product: ProductView) => void;
}) {
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "件");
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.imageUrl ?? null);
  const [description, setDescription] = useState(initial?.description ?? "");

  const [rows, setRows] = useState<ColorRow[]>(() =>
    initial && initial.colors.length > 0
      ? initial.colors.map((c) => ({
          key: rowKey(),
          id: c.id,
          colorName: c.colorName ?? "",
          variantType: c.variantType,
          safetyStock: c.safetyStock,
        }))
      : [{ key: rowKey(), colorName: "", variantType: "normal", safetyStock: 0 }],
  );

  const [meta, setMeta] = useState<Meta>({ categories: [], colors: [] });
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Meta>("/api/products/meta")
      .then(setMeta)
      .catch(() => {
        /* 补全数据拿不到不影响主流程 */
      });
  }, []);

  const customCount = rows.filter((r) => r.variantType === "custom").length;

  function updateRow(key: string, patch: Partial<ColorRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { key: rowKey(), colorName: "", variantType: "normal", safetyStock: 0 }]);
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
  }

  async function onPickFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api<{ url: string }>("/api/upload", { method: "POST", body: form });
      setImageUrl(res.url);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "图片上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function validate(): boolean {
    const fe: Record<string, string> = {};
    if (!name.trim()) fe.name = "请填写产品名称";
    if (name.trim().length > 60) fe.name = "产品名称最多 60 个字";

    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const key = `${r.colorName.trim()}__${r.variantType}`;
      if (seen.has(key)) {
        fe[`color-${i}`] = r.colorName.trim()
          ? `颜色「${r.colorName.trim()}」在同样的规格下重复了`
          : "「无颜色」的行重复了";
      }
      seen.add(key);
    });

    setFieldErrors(fe);
    if (Object.keys(fe).length > 0) {
      setError("有几处需要修改，已标红");
      return false;
    }
    setError("");
    return true;
  }

  async function submit(forceCreate = false) {
    if (submitting) return;
    if (!validate()) return;

    const payload = {
      name: name.trim(),
      category: category.trim() || null,
      unit,
      imageUrl,
      description: description.trim() || null,
      colors: rows.map((r) => ({
        ...(r.id ? { id: r.id } : {}),
        colorName: r.colorName.trim() || null,
        variantType: r.variantType,
        safetyStock: Number.isFinite(r.safetyStock) ? r.safetyStock : 0,
      })),
      forceCreate,
    };

    setSubmitting(true);
    try {
      const saved =
        mode === "create"
          ? await api<ProductView>("/api/products", { method: "POST", json: payload })
          : await api<ProductView>(`/api/products/${initial!.id}`, { method: "PUT", json: payload });

      toast.success(mode === "create" ? "产品已创建" : "已保存");

      if (onSaved) {
        onSaved(saved);
        return;
      }

      router.push("/products");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details) {
        setConflict(err.details as ConflictInfo);
      } else {
        setError(err instanceof ApiError ? err.message : "保存失败，请重试");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {embedded ? null : (
        <FormTitle
          backHref="/products"
          backTitle="返回商品列表"
          title={mode === "create" ? "新建产品" : "编辑产品"}
          description={
            mode === "create"
              ? "一个产品下按颜色分行。多数款只有一个颜色，那就只填一行。"
              : "改动会立即生效。历史单据里的名称与颜色不会跟着变，保证旧账可查。"
          }
        />
      )}

      {error ? <InlineError>{error}</InlineError> : null}

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* 主表单 */}
        <div className="space-y-4">
          <section className="card p-4 sm:p-5">
            <h2 className="mb-3.5 text-[13.5px] font-semibold text-ink">基本信息</h2>

            <div className="space-y-3.5">
              <div>
                <label className="label" htmlFor="name">
                  产品名称 <span className="text-danger">*</span>
                </label>
                <input
                  id="name"
                  className={`input ${fieldErrors.name ? "border-danger" : ""}`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如 北欧布艺三人沙发"
                  maxLength={60}
                  autoFocus
                />
                {fieldErrors.name ? (
                  <p className="mt-1 text-[11.5px] text-danger">{fieldErrors.name}</p>
                ) : (
                  <p className="mt-1 text-[11.5px] text-muted">
                    保存时会自动生成拼音索引，入库时输入首字母就能搜到
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="category">
                    分类
                  </label>
                  <input
                    id="category"
                    className="input"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="沙发 / 床 / 餐桌…"
                    list="category-list"
                    maxLength={20}
                  />
                  <datalist id="category-list">
                    {meta.categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="label">数量单位</label>
                  <div className="flex gap-1.5">
                    {UNIT_OPTIONS.map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setUnit(u)}
                        className={`flex-1 rounded-lg border px-2 py-2 text-[13px] transition-colors ${
                          unit === u
                            ? "border-brand bg-brand-soft font-medium text-brand-ink"
                            : "border-line bg-card text-ink-2 hover:border-line"
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="label" htmlFor="description">
                  备注
                </label>
                <textarea
                  id="description"
                  className="input min-h-[64px] resize-y"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="选填：尺寸、材质、注意事项等"
                  maxLength={500}
                />
              </div>
            </div>
          </section>

          {/* 颜色行 */}
          <section className="card p-4 sm:p-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-[13.5px] font-semibold text-ink">颜色与规格</h2>
              <span className="text-[11.5px] text-muted">一色一行 · 一色一个 SKU</span>
            </div>
            <p className="mb-3 text-[11.5px] leading-5 text-muted">
              不同颜色的库存各自独立计算，绝不会合并。选「定制」的那一行同时也是定制款：按件追踪、退货不能回良品架。
            </p>

            <div className="space-y-2">
              {rows.map((r, i) => {
                const err = fieldErrors[`color-${i}`];
                return (
                  <div
                    key={r.key}
                    className={`grid grid-cols-1 items-start gap-2 rounded-lg border p-2.5 sm:grid-cols-[1fr_150px_86px_32px] ${
                      err ? "border-danger bg-danger-soft/30" : "border-line-2 bg-sunken"
                    }`}
                  >
                    <div>
                      <input
                        className="input py-1.5 text-[13px]"
                        value={r.colorName}
                        onChange={(e) => updateRow(r.key, { colorName: e.target.value })}
                        placeholder={i === 0 ? "颜色名，例如 米白（可留空）" : "颜色名"}
                        list="color-list"
                        maxLength={30}
                      />
                      {err ? <p className="mt-1 text-[11px] text-danger">{err}</p> : null}
                    </div>

                    <div className="flex rounded-lg border border-line bg-card p-0.5">
                      {(
                        [
                          ["normal", "常规"],
                          ["custom", "定制"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => updateRow(r.key, { variantType: value })}
                          className={`flex-1 rounded-md px-1 py-1 text-[12px] transition-colors ${
                            r.variantType === value
                              ? value === "custom"
                                ? "bg-warn-soft font-medium text-warn"
                                : "bg-brand-soft font-medium text-brand-ink"
                              : "text-ink-2 hover:bg-sunken"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={999999}
                        className="input px-2 py-1.5 text-center text-[13px] tnum"
                        value={Number.isFinite(r.safetyStock) ? r.safetyStock : 0}
                        onChange={(e) => updateRow(r.key, { safetyStock: Number(e.target.value) })}
                        title="安全库存：低于这个数时列表会提示补货"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => removeRow(r.key)}
                      disabled={rows.length <= 1}
                      className="mt-0.5 flex h-[30px] w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
                      title={rows.length <= 1 ? "至少保留一行" : "删除这一行"}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-2.5 flex items-center justify-between">
              <button type="button" onClick={addRow} className="btn-ghost btn-sm">
                <Plus size={13} />
                再加一个颜色
              </button>
              <span className="tnum text-[11.5px] text-muted">
                共 {rows.length} 行
                {customCount > 0 ? ` · 其中 ${customCount} 个定制` : ""}
              </span>
            </div>

            <datalist id="color-list">
              {meta.colors.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </section>
        </div>

        {/* 右侧：图片 + 说明 */}
        <div className="space-y-4">
          <section className="card p-4 sm:p-5">
            <h2 className="mb-3 text-[13.5px] font-semibold text-ink">产品图片</h2>

            {imageUrl ? (
              <div className="relative overflow-hidden rounded-lg border border-line-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="产品图片" className="aspect-[4/3] w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setImageUrl(null)}
                  className="absolute right-2 top-2 rounded-md bg-card/90 p-1 text-ink-2 transition-colors hover:text-danger"
                  title="移除图片"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-sunken text-muted transition-colors hover:border-brand hover:text-brand-ink"
              >
                {uploading ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} strokeWidth={1.6} />}
                <span className="text-[12.5px]">{uploading ? "上传中…" : "上传图片"}</span>
                <span className="text-[11px] text-muted">JPG / PNG / WebP，≤ 5MB</span>
              </button>
            )}

            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
            />

            {imageUrl ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="btn-ghost btn-sm mt-2 w-full"
                disabled={uploading}
              >
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                换一张
              </button>
            ) : null}

            <p className="mt-2.5 text-[11.5px] leading-5 text-muted">
              没有图片也能保存，只是建档状态会标成「待完善」。图片只影响找货时的识别速度。
            </p>
          </section>

          <section className="card bg-sunken p-4 text-[12px] leading-[1.85] text-ink-2 sm:p-5">
            <h2 className="mb-2 text-[13px] font-semibold text-ink">保存后系统会做三件事</h2>
            <ol className="list-decimal space-y-1.5 pl-4">
              <li>按名称生成全拼与首字母索引（只读，改名自动重算）</li>
              <li>每个颜色行生成一个 SKU 与内部编码</li>
              <li>校验名称不与现有产品重复，重复会提示你直接加颜色</li>
            </ol>
          </section>
        </div>
      </div>

      {/* 底部操作 */}
      <div
        className={
          embedded
            ? "border-t border-line pt-3"
            : "sticky bottom-0 -mx-4 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
        }
      >
        <div className="flex items-center justify-between gap-3">
          <span className="tnum text-[12px] text-muted">
            {rows.length} 个颜色行
            {customCount > 0 ? ` · ${customCount} 个按件追踪` : ""}
          </span>
          <div className="flex gap-2">
            {embedded ? null : (
              <Link href="/products" className="btn-ghost">
                取消
              </Link>
            )}
            <button type="button" className="btn-primary" onClick={() => void submit(false)} disabled={submitting}>
              {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
              {mode === "create" ? "保存产品" : "保存修改"}
            </button>
          </div>
        </div>
      </div>

      {/* 同名冲突 */}
      <Modal
        open={!!conflict}
        title="已经有同名产品了"
        description={conflict?.hint ?? "可以先给已有产品加颜色，而不是新建一个同名的。"}
        onClose={() => setConflict(null)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setConflict(null)}>
              返回修改
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                const id = conflict?.existing.id;
                setConflict(null);
                if (id) router.push(`/products/${id}/edit`);
              }}
            >
              去给它加颜色
            </button>
          </>
        }
      >
        {conflict?.existing ? (
          <div className="rounded-lg border border-line-2 bg-sunken p-3">
            <div className="text-[13px] font-medium text-ink">{conflict.existing.name}</div>
            {conflict.existing.colors && conflict.existing.colors.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {conflict.existing.colors.map((c, i) => (
                  <span
                    key={i}
                    className={`tag ${
                      c.variantType === "custom" ? "bg-warn-soft text-warn" : "bg-sunken text-ink-2"
                    }`}
                  >
                    {c.colorName ?? "无颜色"}
                    {c.variantType === "custom" ? "·定制" : ""}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => {
            setConflict(null);
            void submit(true);
          }}
          className="mt-2 text-[12px] text-muted underline underline-offset-2 hover:text-ink-2"
        >
          确实需要单独建一个同名产品
        </button>
      </Modal>
    </div>
  );
}
