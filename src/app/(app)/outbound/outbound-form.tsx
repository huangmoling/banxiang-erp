"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  PackageMinus,
  Search,
  Send,
  Trash2,
  Truck,
  Warehouse,
} from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { ProductThumb } from "@/components/product-thumb";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { todayDateOnly } from "@/lib/date";
import type { ProductView } from "@/modules/product/product.types";
import {
  colorText,
  type AvailabilityResult,
  type OutboundDocView,
  type OutboundMeta,
  type SkuAvailability,
} from "@/modules/outbound/outbound.types";

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
  /** 可售在库 */
  stock: number;
  qty: number;
  /** "" = 自动按生产日期先后扣 */
  batchNo: string;
  /** 定制款：勾选的件 id。qty 始终等于它的长度 */
  instanceIds: string[];
  avail: SkuAvailability | null;
  availLoading: boolean;
  /** 定制款：是否展开选件面板 */
  picking: boolean;
};

type SkuOption = Pick<
  Line,
  "skuId" | "productId" | "productName" | "imageUrl" | "colorName" | "variantType" | "unit" | "stock"
>;

let lineSeq = 0;
const newKey = () => `o${++lineSeq}`;

export function OutboundForm({ meta, role }: { meta: OutboundMeta; role: string }) {
  const router = useRouter();
  const toast = useToast();
  const today = meta.today || todayDateOnly();
  const isClerk = role === "clerk";

  const [bizDate, setBizDate] = useState(today);
  const [locationId, setLocationId] = useState(meta.locations[0]?.id ?? "");
  const [externalNo, setExternalNo] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  const [remark, setRemark] = useState("");

  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState<"draft" | "submit" | "approve" | null>(null);
  /** 二次确认：点保存不直接提交，先把「要扣掉的货」摆出来让人对一眼 */
  const [confirm, setConfirm] = useState<null | { mode: "draft" | "submit" | "approve" }>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [products, setProducts] = useState<ProductView[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  const boxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});

  /** 搜索结果摊平成「产品 + 颜色」：一色一行，点一下就加一行 */
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

  async function loadAvailability(key: string, skuId: string) {
    try {
      const res = await api<AvailabilityResult>(
        `/api/outbound/available?skuIds=${encodeURIComponent(skuId)}`,
      );
      setLines((prev) =>
        prev.map((l) => (l.key === key ? { ...l, avail: res[skuId] ?? null, availLoading: false } : l)),
      );
    } catch {
      setLines((prev) => prev.map((l) => (l.key === key ? { ...l, availLoading: false } : l)));
    }
  }

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
      // 定制款按件出，一件就是一行里的一个勾选项，不能叠数量
      if (option.variantType === "custom") {
        toast.info("这一款已经在单里了，去那一行勾选要出的件");
        return;
      }
      setLines((prev) =>
        prev.map((l) => (l.key === existing.key ? { ...l, qty: l.qty + qty } : l)),
      );
      focusQty(existing.key);
      return;
    }

    const key = newKey();
    const line: Line = {
      ...option,
      key,
      qty: option.variantType === "custom" ? 0 : qty,
      batchNo: "",
      instanceIds: [],
      avail: null,
      availLoading: true,
      picking: option.variantType === "custom",
    };

    setLines((prev) => [...prev, line]);
    void loadAvailability(key, option.skuId);

    if (option.variantType === "custom") {
      toast.info("定制款按件出库，请在下方勾选具体哪一件");
    } else {
      focusQty(key);
    }
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

  function toggleInstance(key: string, instanceId: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const has = l.instanceIds.includes(instanceId);
        const next = has
          ? l.instanceIds.filter((id) => id !== instanceId)
          : [...l.instanceIds, instanceId];
        // 勾几件就是几件，数量不让人手填，避免「勾了 1 件填了 3 件」
        return { ...l, instanceIds: next, qty: next.length };
      }),
    );
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

  function validate(mode: "draft" | "submit" | "approve"): string {
    if (lines.length === 0) return "先搜一个款、加一行货，再保存";

    // 发货工单是给仓库照着发的，没有收货信息仓管发不出去
    if (mode === "submit" && !receiverName.trim()) {
      return "发货工单要填收货信息（姓名、电话、地址），不然后面发不出去";
    }

    for (const line of lines) {
      const label = `${line.productName} · ${colorText(line.colorName)}`;

      if (line.variantType === "custom") {
        if (line.instanceIds.length === 0) {
          return `「${label}」是定制款，请勾选要出的那一件`;
        }
        continue;
      }

      if (!Number.isFinite(line.qty) || line.qty < 1) {
        return `「${label}」的数量没填，或者填了 0`;
      }
      if (line.qty > line.stock) {
        return `「${label}」在库只有 ${line.stock} ${line.unit}，出不了 ${line.qty}`;
      }
    }

    return "";
  }

  /**
   * 点「保存」的第一下：只校验 + 弹确认框，不提交。
   * 出库扣的是真实在库，多发一件当月就少一件，所以金额之外最该复核的是
   * 「发的哪一款、几件、发到哪个订单」——这些在弹窗里逐行列出来。
   */
  function requestSubmit(mode: "draft" | "submit" | "approve") {
    if (submitting) return;

    const message = validate(mode);
    if (message) {
      setError(message);
      return;
    }

    setError("");
    setConfirm({ mode });
  }

  async function doSubmit() {
    if (!confirm || submitting) return;
    const mode = confirm.mode;
    const approveNow = mode === "approve";

    setSubmitting(mode);

    try {
      const doc = await api<OutboundDocView>("/api/outbound", {
        method: "POST",
        json: {
          bizDate,
          locationId: locationId || null,
          externalNo: externalNo.trim() || null,
          receiverName: receiverName.trim() || null,
          trackingNo: trackingNo.trim() || null,
          remark: remark.trim() || null,
          items: lines.map((l) => ({
            skuId: l.skuId,
            qty: l.qty,
            batchNo: l.variantType === "custom" ? null : l.batchNo || null,
            instanceIds: l.variantType === "custom" ? l.instanceIds : [],
          })),
          approveNow,
          submitAfterSave: mode === "submit",
        },
      });

      toast.success(
        mode === "approve"
          ? `已出库，单号 ${doc.docNo}`
          : mode === "submit"
            ? `工单已提交：${doc.docNo}，等仓管确认`
            : `草稿已保存：${doc.docNo}`,
      );
      setConfirm(null);
      if (mode === "submit") window.dispatchEvent(new Event("suteng:pending-changed"));
      router.push(`/outbound/${doc.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败，请重试");
      setSubmitting(null);
      setConfirm(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href="/outbound"
          className="rounded-md p-1.5 text-muted hover:bg-line-2 hover:text-ink"
          title="返回出库列表"
        >
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-ink">
            {isClerk ? "整理发货工单" : "新建出库单"}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {isClerk
              ? "选款 → 填收货信息和数量 → 提交给仓管。提交后库存不动，等仓管点了确认才扣。"
              : "搜名称或拼音首字母选款 → 填数量 → 保存。审核后库存立即扣减。"}
          </p>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-card border border-[#f3cfc9] bg-danger-soft px-3.5 py-2.5 text-[12.5px] leading-5 text-danger">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <div className="space-y-4">
          <section className="card p-4 sm:p-5">
            <h2 className="mb-1 text-[13.5px] font-semibold text-ink">登记发货</h2>
            <p className="mb-3 text-[11.5px] leading-5 text-muted">
              常规款填数量就行；定制款一件一个编号，要勾选具体发走的那一件。
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
                <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-card border border-line bg-white">
                  {searching ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-[12.5px] text-muted">
                      <Loader2 size={14} className="animate-spin" />
                      搜索中…
                    </div>
                  ) : options.length === 0 ? (
                    <div className="px-3.5 py-5 text-center text-[12.5px] text-ink-2">
                      没有匹配的产品。出库只能选已经建过档的款，新货请先走入库。
                    </div>
                  ) : (
                    <ul className="max-h-[320px] overflow-y-auto py-1">
                      {options.map((o, i) => {
                        const out = o.stock <= 0;
                        return (
                          <li key={o.skuId}>
                            <button
                              type="button"
                              onMouseEnter={() => setActiveIdx(i)}
                              onClick={() => pick(o)}
                              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                                i === activeIdx ? "bg-brand-soft" : "hover:bg-[#f7f8fa]"
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
                                  <span className="tag ml-1.5 bg-[#fdf4e8] text-[#a15f12]">
                                    定制·按件
                                  </span>
                                ) : null}
                              </span>
                              <span
                                className={`tnum shrink-0 text-[11.5px] ${
                                  out ? "text-[#c0553f]" : "text-muted"
                                }`}
                              >
                                {out ? "无在库" : `在库 ${o.stock} ${o.unit}`}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <div className="flex items-center justify-between border-t border-line-2 bg-[#fbfcfd] px-3 py-2 text-[11.5px] text-muted">
                    <span>↑↓ 选择 · 回车加入 · 数量处回车继续搜下一个</span>
                  </div>
                </div>
              ) : null}
            </div>

            {/* 已加的行 */}
            <div className="mt-3.5 space-y-2">
              {lines.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[#d6dae1] bg-[#fcfcfd] py-8 text-center">
                  <PackageMinus size={20} strokeWidth={1.6} className="text-[#c2c8d2]" />
                  <p className="text-[12.5px] text-muted">还没有货。上面搜一个款，回车就加进来</p>
                </div>
              ) : (
                lines.map((line, index) => {
                  const over = line.variantType === "normal" && line.qty > line.stock;
                  const noStock = line.stock <= 0;

                  return (
                    <div
                      key={line.key}
                      className={`rounded-lg border bg-[#fcfcfd] ${
                        over || noStock ? "border-[#f3cfc9]" : "border-line-2"
                      }`}
                    >
                      <div className="grid grid-cols-[1fr_84px_32px] items-center gap-2 p-2.5 sm:grid-cols-[1fr_78px_150px_32px]">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <ProductThumb url={line.imageUrl} name={line.productName} size={34} />
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-medium text-ink">
                              <span className="tnum mr-1 text-[11.5px] font-normal text-muted">
                                {index + 1}
                              </span>
                              {line.productName}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11.5px] text-muted">
                              <span className={line.colorName ? "text-ink-2" : ""}>
                                {colorText(line.colorName)}
                              </span>
                              {line.variantType === "custom" ? (
                                <span className="tag bg-[#fdf4e8] text-[#a15f12]">定制·按件</span>
                              ) : null}
                              <span className={`tnum ${noStock ? "text-[#c0553f]" : ""}`}>
                                在库 {line.stock} {line.unit}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* 数量：常规款可填，定制款跟着勾选件数走 */}
                        <div className="flex items-center gap-1">
                          {line.variantType === "custom" ? (
                            <span
                              className={`input flex items-center justify-center px-1.5 py-1.5 text-[13px] tnum ${
                                line.qty > 0 ? "text-ink" : "text-muted"
                              }`}
                              title="数量跟着勾选的件数走"
                            >
                              {line.qty}
                            </span>
                          ) : (
                            <input
                              ref={(el) => {
                                qtyRefs.current[line.key] = el;
                              }}
                              type="number"
                              min={1}
                              max={Math.max(1, line.stock)}
                              inputMode="numeric"
                              className={`input px-1.5 py-1.5 text-center text-[13px] tnum ${
                                over ? "border-[#e0a99e] text-danger" : ""
                              }`}
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
                              title={`数量（${line.unit}），在库 ${line.stock}`}
                            />
                          )}
                          <span className="text-[11.5px] text-muted">{line.unit}</span>
                        </div>

                        {/* 批次 / 选件 */}
                        <div className="col-span-2 sm:col-span-1">
                          {line.variantType === "custom" ? (
                            <button
                              type="button"
                              onClick={() => updateLine(line.key, { picking: !line.picking })}
                              disabled={line.availLoading}
                              className={`flex w-full items-center justify-between gap-1 rounded-md border px-2 py-1.5 text-[12px] transition-colors ${
                                line.instanceIds.length > 0
                                  ? "border-[#c9d3f5] bg-brand-soft text-brand"
                                  : "border-line bg-white text-ink-2 hover:border-[#d6dae1]"
                              }`}
                            >
                              <span className="truncate">
                                {line.availLoading
                                  ? "读取在库件…"
                                  : line.instanceIds.length > 0
                                    ? `已选 ${line.instanceIds.length} 件`
                                    : "选择在库件"}
                              </span>
                              {line.picking ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                          ) : (
                            <select
                              className="input py-1.5 text-[12px]"
                              value={line.batchNo}
                              onChange={(e) => updateLine(line.key, { batchNo: e.target.value })}
                              title="批次（默认自动按生产日期先后扣）"
                            >
                              <option value="">自动扣批次</option>
                              {(line.avail?.batches ?? []).map((b) => (
                                <option key={b.batchNo} value={b.batchNo}>
                                  {b.batchNo}（剩 {b.qty}）
                                </option>
                              ))}
                            </select>
                          )}
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

                      {/* 定制款：在库件列表 */}
                      {line.variantType === "custom" && line.picking ? (
                        <div className="border-t border-line-2 bg-white px-2.5 py-2.5">
                          {line.availLoading ? (
                            <div className="flex items-center gap-2 py-2 text-[12px] text-muted">
                              <Loader2 size={13} className="animate-spin" />
                              正在读取这一款的在库件…
                            </div>
                          ) : (line.avail?.instances.length ?? 0) === 0 ? (
                            <p className="py-1.5 text-[12px] text-[#c0553f]">
                              这一款现在没有在库的单件，出不了。等入库审核后再来。
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-[11.5px] text-muted">
                                <span>勾选要发走的件（勾几件就是几件）</span>
                                <span className="tnum">
                                  在库 {line.avail?.instances.length ?? 0} 件
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {line.avail!.instances.map((inst) => {
                                  const selected = line.instanceIds.includes(inst.id);
                                  const locked = !!inst.reservedBy;
                                  return (
                                    <button
                                      key={inst.id}
                                      type="button"
                                      disabled={locked}
                                      onClick={() => toggleInstance(line.key, inst.id)}
                                      title={
                                        locked
                                          ? `已被 ${inst.reservedBy} 占用`
                                          : inst.inboundDocNo
                                            ? `入库单 ${inst.inboundDocNo}`
                                            : undefined
                                      }
                                      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] transition-colors ${
                                        locked
                                          ? "cursor-not-allowed border-line-2 bg-[#f7f8fa] text-[#b9bfc9]"
                                          : selected
                                            ? "border-[#c9d3f5] bg-brand-soft text-brand"
                                            : "border-line bg-white text-ink-2 hover:border-[#c9d3f5]"
                                      }`}
                                    >
                                      {selected ? <Check size={11} /> : null}
                                      <span className="tnum">{inst.code}</span>
                                      <span className="text-[10.5px] opacity-70">
                                        {locked
                                          ? `已被 ${inst.reservedBy} 占用`
                                          : (inst.productionDate ?? "无生产日期")}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>

            {lines.some((l) => l.variantType === "normal") ? (
              <p className="mt-2 text-[11.5px] leading-5 text-muted">
                批次默认「自动」：按生产日期先后从最早的批次扣，不用手选。要指定某批就下拉选它。
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
                <p className="mt-1 text-[11.5px] text-muted">补录昨天的发货就改成昨天，账记在那一天。</p>
              </div>

              <div>
                <label className="label" htmlFor="location">
                  发货仓位
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
                <p className="mt-1 text-[11.5px] text-muted">次品区、报废区不走销售出库。</p>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="label" htmlFor="externalNo">
                    淘宝订单号
                  </label>
                  <input
                    id="externalNo"
                    className="input tnum"
                    value={externalNo}
                    onChange={(e) => setExternalNo(e.target.value)}
                    placeholder="选填，退货时靠它找回这张单"
                    maxLength={60}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="trackingNo">
                    物流单号
                  </label>
                  <input
                    id="trackingNo"
                    className="input tnum"
                    value={trackingNo}
                    onChange={(e) => setTrackingNo(e.target.value)}
                    placeholder="选填，发出去之后再补"
                    maxLength={60}
                  />
                </div>
              </div>

              {/* 收货信息整段粘进来就行：从淘宝后台复制的那串正好是「姓名，电话，地址」 */}
              <div>
                <label className="label" htmlFor="receiverName">
                  收货信息
                  <span className="ml-1 font-normal text-muted">（姓名、电话、地址）</span>
                </label>
                <textarea
                  id="receiverName"
                  className="input min-h-[78px] resize-y leading-[1.7]"
                  value={receiverName}
                  onChange={(e) => setReceiverName(e.target.value)}
                  placeholder={"张伟，13812345678\n浙江省杭州市余杭区仓前街道文一西路 969 号 3 幢 1 单元 502"}
                  maxLength={300}
                />
                <p className="mt-1 text-[11.5px] text-muted">
                  从淘宝后台复制过来整段贴上即可，不用分开填。系统只当一段文字存，不拆分。
                </p>
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
                  placeholder="选填：打包情况、随货配件说明等"
                  maxLength={500}
                />
              </div>
            </div>
          </section>

          <section className="card bg-[#fbfcfd] p-4 text-[12px] leading-[1.85] text-ink-2 sm:p-5">
            <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <Truck size={14} strokeWidth={1.8} className="text-brand" />
              {isClerk ? "提交后会发生什么" : "审核后会发生什么"}
            </div>
            <ul className="space-y-1.5">
              <li className="flex gap-1.5">
                <Check size={13} className="mt-1 shrink-0 text-ok" />
                {isClerk
                  ? "仓库的仪表台和出库页会立刻出现这张待发货工单"
                  : "每个颜色行生成出库流水，主仓库存随之减少"}
              </li>
              <li className="flex gap-1.5">
                <Check size={13} className="mt-1 shrink-0 text-ok" />
                {isClerk
                  ? "仓管照着收货信息打包，点确认才算真正发出，库存那时候才减"
                  : "库存不够的单审核不过，会告诉你哪一行差多少"}
              </li>
              <li className="flex gap-1.5">
                <Check size={13} className="mt-1 shrink-0 text-ok" />
                定制款按件出库，发走后编号状态变为「已出库」
              </li>
              <li className="flex gap-1.5">
                <Check size={13} className="mt-1 shrink-0 text-ok" />
                草稿不产生任何流水，库存数字不会动
              </li>
            </ul>
            <div className="mt-2.5 flex items-start gap-1.5 border-t border-line-2 pt-2.5 text-[11.5px] text-muted">
              <Warehouse size={13} className="mt-0.5 shrink-0" />
              次品区的货不计入可售库存，出不了淘宝订单，只能走线下出售或报废。
            </div>
          </section>
        </div>
      </div>

      {/* 底部操作 */}
      <div className="sticky bottom-0 -mx-4 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="tnum text-[12px] text-muted">
            {lines.length} 行 · 合计 <b className="text-[14px] text-ink">{totalQty}</b> {totalUnit}
            {customQty > 0 ? ` · 其中 ${customQty} 件按件出库` : ""}
          </span>
          <div className="flex flex-wrap justify-end gap-2">
            <Link href="/outbound" className="btn-ghost">
              取消
            </Link>
            {isClerk ? (
              // 内勤只有一个动作：把单子交给仓管。没有「存草稿」也没有「审核」，
              // 免得他存了一张自己忘了交，仓库那边永远等不到
              <button
                type="button"
                className="btn-primary"
                onClick={() => requestSubmit("submit")}
                disabled={submitting !== null}
                title="提交给仓管，库存这时候不动"
              >
                {submitting === "submit" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                提交发货工单
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => requestSubmit("draft")}
                  disabled={submitting !== null}
                  title="只存草稿，不影响库存"
                >
                  {submitting === "draft" ? <Loader2 size={14} className="animate-spin" /> : null}
                  存为草稿
                </button>
                <button
                  type="button"
                  className="btn-ghost border-brand text-brand"
                  onClick={() => requestSubmit("submit")}
                  disabled={submitting !== null}
                  title="交给仓管去发，库存这时候不动"
                >
                  {submitting === "submit" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                  提交工单
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => requestSubmit("approve")}
                  disabled={submitting !== null}
                >
                  {submitting === "approve" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  保存并审核
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {/* 保存前的二次确认：把要扣掉的货原样摆一遍 */}
      <Modal
        open={!!confirm}
        title={
          confirm?.mode === "approve"
            ? "确认保存并审核出库？"
            : confirm?.mode === "submit"
              ? "确认提交给仓管发货？"
              : "确认存为草稿？"
        }
        description={
          confirm?.mode === "approve"
            ? "点确认后库存立刻扣减，这批货就算正式发出去了。"
            : confirm?.mode === "submit"
              ? "提交后仓库那边就会看到这张待发货工单，库存要等仓管点确认才扣。"
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
              className={confirm?.mode === "draft" ? "btn-ghost border-brand text-brand" : "btn-primary"}
              onClick={() => void doSubmit()}
              disabled={submitting !== null}
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {confirm?.mode === "approve"
                ? "确认，出库"
                : confirm?.mode === "submit"
                  ? "确认，提交工单"
                  : "确认，存草稿"}
            </button>
          </>
        }
      >
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-[#fbfcfd] px-3 py-2.5 text-[12.5px]">
            <div>
              <div className="text-[11.5px] text-muted">业务日期</div>
              <div className="tnum mt-0.5 font-medium text-ink">{bizDate}</div>
            </div>
            <div>
              <div className="text-[11.5px] text-muted">发货仓位</div>
              <div className="mt-0.5 font-medium text-ink">
                {meta.locations.find((l) => l.id === locationId)?.name ?? "默认仓位"}
              </div>
            </div>
            <div>
              <div className="text-[11.5px] text-muted">淘宝订单号</div>
              <div className="tnum mt-0.5 text-ink">{externalNo.trim() || "—"}</div>
            </div>
            <div className="col-span-2">
              <div className="text-[11.5px] text-muted">收货信息</div>
              <div className="mt-0.5 whitespace-pre-line leading-[1.7] text-ink">
                {receiverName.trim() || "—"}
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
                  {l.variantType === "custom" ? (
                    <span className="ml-1 text-[11px] text-[#a15f12]">
                      ·{l.instanceIds.length} 件指定编号
                    </span>
                  ) : null}
                </span>
                <span className={`tnum shrink-0 font-semibold ${l.qty >= 100 ? "text-[#c0553f]" : "text-ink"}`}>
                  ×{l.qty} {l.unit}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between border-t border-line-2 pt-2.5 text-[12.5px]">
            <span className="text-muted">
              共 {lines.length} 行
              {customQty > 0 ? ` · 其中 ${customQty} 件按件出库` : ""}
            </span>
            <span className="tnum font-semibold text-ink">
              合计 {totalQty} {totalUnit}
            </span>
          </div>

          {lines.some((l) => l.variantType === "normal" && l.qty >= 100) ? (
            <div className="flex items-start gap-1.5 rounded-lg bg-[#fdf4e8] px-3 py-2 text-[12px] leading-5 text-[#8a5a15]">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              有一行数量到了三位数，多打一个 0 是最常见的错。确认一下是不是真这么多。
            </div>
          ) : null}

          {!externalNo.trim() ? (
            <p className="text-[11.5px] leading-5 text-muted">
              没填淘宝订单号。以后这单要退货，得靠订单号找回原单——能填就填上。
            </p>
          ) : null}

          {confirm?.mode === "submit" ? (
            <div className="flex items-start gap-1.5 rounded-lg bg-brand-soft px-3 py-2 text-[12px] leading-5 text-brand">
              <Send size={13} className="mt-0.5 shrink-0" />
              提交只是把单子交给仓管，库存一点不动。仓管点「确认」之后才会扣。
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
