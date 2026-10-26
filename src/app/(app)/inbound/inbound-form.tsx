"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Check,
  Loader2,
  PackagePlus,
  Plus,
  Search,
  Trash2,
  Warehouse,
} from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { ProductThumb } from "@/components/product-thumb";
import { Modal } from "@/components/ui/modal";
import { FormActionBar, FormTitle, InlineError, RuleCard } from "@/components/ui/doc";
import { useToast } from "@/components/ui/toast";
import { todayDateOnly } from "@/lib/date";
import { ProductForm } from "@/app/(app)/products/product-form";
import { colorText, type InboundDocView, type InboundMeta } from "@/modules/inbound/inbound.types";
import type { ProductView } from "@/modules/product/product.types";

type Line = {
  key: string;
  skuId: string;
  productId: string;
  productName: string;
  /** 商品主图，悬停可放大——仓管认货主要靠它 */
  imageUrl: string | null;
  colorName: string | null;
  variantType: "normal" | "custom";
  unit: string;
  stock: number;
  qty: number;
  productionDate: string;
};

type SkuOption = Omit<Line, "key" | "qty" | "productionDate">;

let lineSeq = 0;
const newKey = () => `l${++lineSeq}`;

export function InboundForm({ meta }: { meta: InboundMeta }) {
  const router = useRouter();
  const toast = useToast();
  const today = meta.today || todayDateOnly();

  const [bizDate, setBizDate] = useState(today);
  const [locationId, setLocationId] = useState(meta.locations[0]?.id ?? "");
  const [remark, setRemark] = useState("");

  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState<"draft" | "approve" | null>(null);
  /** 二次确认：点保存不直接提交，先把「要记进账的东西」摆出来让人对一眼 */
  const [confirm, setConfirm] = useState<null | { approveNow: boolean }>(null);

  // 选品搜索
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [products, setProducts] = useState<ProductView[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  const [newProductOpen, setNewProductOpen] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});

  /** 搜索结果摊平成「产品 + 颜色」行：一色一行，点一下就加一行 */
  const options = useMemo<SkuOption[]>(
    () =>
      products.flatMap((p) =>
        p.colors.map((c) => ({
          skuId: c.id,
          productId: p.id,
          productName: p.name,
          imageUrl: p.imageUrl,
          colorName: c.colorName,
          variantType: c.variantType,
          unit: p.unit,
          stock: c.stock,
        })),
      ),
    [products],
  );

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // 搜索：打开就加载常用款（按近 90 天使用频次），空词也返回结果
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const res = await api<{ items: ProductView[] }>(
          `/api/products/search?q=${encodeURIComponent(query.trim())}&limit=12`,
        );
        if (!cancelled) {
          setProducts(res.items);
          setActiveIdx(0);
        }
      } catch {
        if (!cancelled) setProducts([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  const totalQty = lines.reduce((sum, l) => sum + l.qty, 0);
  const units = new Set(lines.map((l) => l.unit));
  const totalUnit = units.size === 1 ? [...units][0] : "件";
  const customQty = lines
    .filter((l) => l.variantType === "custom")
    .reduce((sum, l) => sum + l.qty, 0);

  function focusQty(key: string) {
    requestAnimationFrame(() => {
      const el = qtyRefs.current[key];
      el?.focus();
      el?.select();
    });
  }

  function addLine(option: SkuOption, qty = 1) {
    const existing = lines.find((l) => l.skuId === option.skuId);

    if (existing) {
      setLines((prev) =>
        prev.map((l) => (l.key === existing.key ? { ...l, qty: l.qty + qty } : l)),
      );
      focusQty(existing.key);
      return;
    }

    const key = newKey();
    setLines((prev) => [...prev, { ...option, key, qty, productionDate: "" }]);
    focusQty(key);
  }

  function pick(option: SkuOption) {
    addLine(option);
    setQuery("");
    setProducts([]);
    setOpen(false);
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "Enter") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = options[activeIdx];
      if (option) pick(option);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function onProductCreated(product: ProductView) {
    setNewProductOpen(false);
    const first = product.colors[0];
    if (!first) return;
    addLine({
      skuId: first.id,
      productId: product.id,
      productName: product.name,
      imageUrl: product.imageUrl,
      colorName: first.colorName,
      variantType: first.variantType,
      unit: product.unit,
      stock: 0,
    });
    toast.success(`「${product.name}」已建档，并加进本单`);
  }

  /**
   * 点「保存」的第一下：只做校验 + 弹确认框，不提交。
   * 入库是最容易录错的一步（数量多打一个 0、颜色点错行），
   * 让人在弹窗里再看一遍日期、仓位、每行数量，比事后红冲省事得多。
   */
  function requestSubmit(approveNow: boolean) {
    if (submitting) return;

    if (lines.length === 0) {
      setError("先搜一个款、加一行货，再保存");
      searchRef.current?.focus();
      return;
    }
    if (lines.some((l) => !Number.isFinite(l.qty) || l.qty < 1)) {
      setError("有数量没填，或者填了 0。每行至少 1");
      return;
    }

    setError("");
    setConfirm({ approveNow });
  }

  async function doSubmit() {
    if (!confirm || submitting) return;
    const approveNow = confirm.approveNow;

    setSubmitting(approveNow ? "approve" : "draft");

    try {
      const doc = await api<InboundDocView>("/api/inbound", {
        method: "POST",
        json: {
          bizDate,
          locationId: locationId || null,
          remark: remark.trim() || null,
          items: lines.map((l) => ({
            skuId: l.skuId,
            qty: l.qty,
            productionDate: l.productionDate || null,
          })),
          approveNow,
        },
      });

      toast.success(approveNow ? `已入库，单号 ${doc.docNo}` : `草稿已保存：${doc.docNo}`);
      setConfirm(null);
      router.push(`/inbound/${doc.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败，请重试");
      setSubmitting(null);
      setConfirm(null);
    }
  }

  return (
    <div className="space-y-4">
      <FormTitle
        backHref="/inbound"
        backTitle="返回入库列表"
        title="新建入库单"
        description="搜名称或拼音首字母选款 → 填数量 → 保存。审核后库存立即增加。"
      />

      {error ? <InlineError>{error}</InlineError> : null}

      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <div className="space-y-4">
          {/* 录货 */}
          <section className="card p-4 sm:p-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-[13.5px] font-semibold text-ink">录入到货</h2>
              <button
                type="button"
                onClick={() => setNewProductOpen(true)}
                className="flex items-center gap-1 text-[12.5px] text-brand-ink hover:underline"
              >
                <Plus size={13} />
                新建产品
              </button>
            </div>
            <p className="mb-3 text-[11.5px] leading-5 text-muted">
              同一款不同颜色会分成不同的行，各算各的库存。找不到的款可以现场建档，不耽误卸货。
              <span className="text-ink-2">　商品图片鼠标移上去能看大图。</span>
            </p>

            <div className="relative" ref={boxRef}>
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted"
              />
              <input
                ref={searchRef}
                className="input pl-9"
                placeholder="输入名称或拼音首字母，如 boby"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={onSearchKeyDown}
                autoFocus
                autoComplete="off"
              />

              {open ? (
                <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-card border border-line bg-card">
                  {searching ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-[12.5px] text-muted">
                      <Loader2 size={14} className="animate-spin" />
                      搜索中…
                    </div>
                  ) : options.length === 0 ? (
                    <div className="px-3.5 py-5 text-center">
                      <p className="text-[12.5px] text-ink-2">没有匹配的产品</p>
                      <button
                        type="button"
                        onClick={() => setNewProductOpen(true)}
                        className="mt-2 text-[12.5px] text-brand-ink hover:underline"
                      >
                        ＋ 现在就给它建档
                      </button>
                    </div>
                  ) : (
                    <ul className="max-h-[320px] overflow-y-auto py-1">
                      {options.map((o, i) => (
                        <li key={o.skuId}>
                          <button
                            type="button"
                            onMouseEnter={() => setActiveIdx(i)}
                            onClick={() => pick(o)}
                            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                              i === activeIdx ? "bg-brand-soft" : "hover:bg-sunken"
                            }`}
                          >
                            <ProductThumb
                              url={o.imageUrl}
                              name={o.productName}
                              size={32}
                              clickToPreview={false}
                            />
                            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                              {o.productName}
                              <span className="ml-1.5 text-ink-2">{colorText(o.colorName)}</span>
                              {o.variantType === "custom" ? (
                                <span className="tag ml-1.5 bg-warn-soft text-warn">定制·按件</span>
                              ) : null}
                            </span>
                            <span className="tnum shrink-0 text-[11.5px] text-muted">
                              在库 {o.stock} {o.unit}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex items-center justify-between border-t border-line-2 bg-sunken px-3 py-2 text-[11.5px] text-muted">
                    <span>↑↓ 选择 · 回车加入 · 数字处回车继续搜下一个</span>
                    <button
                      type="button"
                      onClick={() => setNewProductOpen(true)}
                      className="text-brand-ink hover:underline"
                    >
                      找不到？新建产品
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* 已加的行 */}
            <div className="mt-3.5 space-y-2">
              {lines.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-sunken py-8 text-center">
                  <PackagePlus size={20} strokeWidth={1.6} className="text-muted" />
                  <p className="text-[12.5px] text-muted">还没有货。上面搜一个款，回车就加进来</p>
                </div>
              ) : (
                lines.map((line, index) => (
                  <div
                    key={line.key}
                    className="grid grid-cols-[1fr_84px_32px] items-center gap-2 rounded-lg border border-line-2 bg-sunken p-2.5 sm:grid-cols-[1fr_78px_142px_32px]"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ProductThumb url={line.imageUrl} name={line.productName} size={34} />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-ink">
                          <span className="tnum mr-1 text-[11.5px] font-normal text-muted">{index + 1}</span>
                          {line.productName}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11.5px] text-muted">
                          <span className={line.colorName ? "text-ink-2" : ""}>
                            {colorText(line.colorName)}
                          </span>
                          {line.variantType === "custom" ? (
                            <span className="tag bg-warn-soft text-warn">定制·按件</span>
                          ) : null}
                          <span className="tnum">当前在库 {line.stock}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <input
                        ref={(el) => {
                          qtyRefs.current[line.key] = el;
                        }}
                        type="number"
                        min={1}
                        max={99999}
                        inputMode="numeric"
                        className="input px-1.5 py-1.5 text-center text-[13px] tnum"
                        value={Number.isFinite(line.qty) && line.qty !== 0 ? line.qty : ""}
                        onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) })}
                        onFocus={(e) => e.currentTarget.select()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            setQuery("");
                            searchRef.current?.focus();
                          }
                        }}
                        title={`数量（${line.unit}）`}
                      />
                      <span className="text-[11.5px] text-muted">{line.unit}</span>
                    </div>

                    <div className="col-span-2 sm:col-span-1">
                      <div className="relative">
                        <CalendarDays
                          size={13}
                          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted"
                        />
                        <input
                          type="date"
                          max={today}
                          className="input py-1.5 pl-7 text-[12.5px] tnum"
                          value={line.productionDate}
                          onChange={(e) => updateLine(line.key, { productionDate: e.target.value })}
                          title="生产日期（选填，只用于追溯）"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      className="flex h-[30px] w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                      title="删掉这一行"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {lines.length > 0 ? (
              <p className="mt-2 text-[11.5px] leading-5 text-muted">
                生产日期选填。填了会按「颜色 + 生产日期」自动归批，以后能从批次倒查这批货；不填也能入库。
              </p>
            ) : null}
          </section>
        </div>

        {/* 右侧：单据信息 */}
        <div className="space-y-4">
          <section className="card p-4 sm:p-5">
            <h2 className="mb-3.5 text-[13.5px] font-semibold text-ink">单据信息</h2>

            <div className="space-y-3.5">
              <div>
                <label className="label" htmlFor="bizDate">
                  业务日期
                </label>
                <input
                  id="bizDate"
                  type="date"
                  max={today}
                  className="input tnum"
                  value={bizDate}
                  onChange={(e) => setBizDate(e.target.value)}
                />
                <p className="mt-1 text-[11.5px] text-muted">补录昨天的货就改成昨天，账会记在那一天。</p>
              </div>

              <div>
                <label className="label" htmlFor="location">
                  入库仓位
                </label>
                <select
                  id="location"
                  className="input"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  {meta.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11.5px] text-muted">次品区、报废区不能直接入库，只能由退货分流进去。</p>
              </div>

              <div>
                <label className="label" htmlFor="remark">
                  备注
                </label>
                <textarea
                  id="remark"
                  className="input min-h-[70px] resize-y"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="选填：物流单号、送货人、破损情况等"
                  maxLength={500}
                />
              </div>
            </div>
          </section>

          <RuleCard
            title="审核后会发生什么"
            items={[
              "每个颜色行生成入库流水，主仓库存随之增加",
              "填了生产日期的行自动归批，可按批次追溯",
              "定制款每一件生成唯一编号（一物一码，无需贴标）",
              "草稿不产生任何流水，库存数字不会动",
            ]}
          />
        </div>
      </div>

      {/* 底部操作 */}
      <FormActionBar
        summary={
          <>
            {lines.length} 行 · 合计 <b className="text-[14px] text-ink">{totalQty}</b> {totalUnit}
            {customQty > 0 ? ` · 其中 ${customQty} 件按件追踪` : ""}
          </>
        }
      >
        <Link href="/inbound" className="btn-ghost">
          取消
        </Link>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => requestSubmit(false)}
          disabled={submitting !== null}
          title="只存草稿，不影响库存"
        >
          {submitting === "draft" ? <Loader2 size={14} className="animate-spin" /> : null}
          存为草稿
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => requestSubmit(true)}
          disabled={submitting !== null}
        >
          {submitting === "approve" ? <Loader2 size={14} className="animate-spin" /> : (
            <Check size={14} />
          )}
          保存并审核
        </button>
      </FormActionBar>

      {/* 保存前的二次确认：把要记账的东西原样摆一遍 */}
      <Modal
        open={!!confirm}
        title={confirm?.approveNow ? "确认保存并审核入库？" : "确认存为草稿？"}
        description={
          confirm?.approveNow
            ? "点确认后库存立刻增加，这批货就算正式入账了。"
            : "草稿不产生任何库存流水，之后还能打开来改。"
        }
        onClose={() => (submitting ? undefined : setConfirm(null))}
        width="max-w-[520px]"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setConfirm(null)}
              disabled={submitting !== null}
            >
              再改一下
            </button>
            <button
              type="button"
              className={confirm?.approveNow ? "btn-primary" : "btn-ghost border-brand text-brand-ink"}
              onClick={() => void doSubmit()}
              disabled={submitting !== null}
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {confirm?.approveNow ? "确认，入库" : "确认，存草稿"}
            </button>
          </>
        }
      >
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-sunken px-3 py-2.5 text-[12.5px]">
            <div>
              <div className="text-[11.5px] text-muted">业务日期</div>
              <div className="tnum mt-0.5 font-medium text-ink">{bizDate}</div>
            </div>
            <div>
              <div className="text-[11.5px] text-muted">入库仓位</div>
              <div className="mt-0.5 font-medium text-ink">
                {meta.locations.find((l) => l.id === locationId)?.name ?? "默认仓位"}
              </div>
            </div>
          </div>

          <ul className="max-h-[230px] space-y-1.5 overflow-y-auto pr-1">
            {lines.map((l, i) => (
              <li key={l.key} className="flex items-center gap-2 text-[12.5px]">
                <span className="tnum w-4 shrink-0 text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-ink">
                  {l.productName}
                  <span className="ml-1 text-ink-2">{colorText(l.colorName)}</span>
                </span>
                <span className={`tnum shrink-0 font-semibold ${l.qty >= 100 ? "text-danger" : "text-ink"}`}>
                  ×{l.qty} {l.unit}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between border-t border-line-2 pt-2.5 text-[12.5px]">
            <span className="text-muted">
              共 {lines.length} 行
              {customQty > 0 ? ` · 其中 ${customQty} 件定制款按件生成编号` : ""}
            </span>
            <span className="tnum font-semibold text-ink">
              合计 {totalQty} {totalUnit}
            </span>
          </div>

          {lines.some((l) => l.qty >= 100) ? (
            <div className="flex items-start gap-1.5 rounded-lg bg-warn-soft px-3 py-2 text-[12px] leading-5 text-warn">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              有一行数量到了三位数，多打一个 0 是最常见的错。确认一下是不是真这么多。
            </div>
          ) : null}
        </div>
      </Modal>

      {/* 现场建档：与商品页同一张表单 */}
      <Modal
        open={newProductOpen}
        title="新建产品"
        description="建完会自动加进本单，不用再回去搜一遍。"
        onClose={() => setNewProductOpen(false)}
        width="max-w-[940px]"
      >
        <div className="max-h-[70vh] overflow-y-auto px-1 pb-2">
          {newProductOpen ? (
            <ProductForm mode="create" embedded onSaved={onProductCreated} />
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
