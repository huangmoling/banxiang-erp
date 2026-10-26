"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ClipboardCheck,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Warehouse,
} from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { FormTitle } from "@/components/ui/doc";
import type { ProductView } from "@/modules/product/product.types";
import {
  LOCATION_TYPE_LABEL,
  LOCATION_TYPE_TONE,
  colorText,
  type StocktakeMeta,
  type StocktakeSheet,
  type StocktakeSheetRow,
} from "@/modules/stocktake/stocktake.types";

type RowState = {
  sku: StocktakeSheetRow;
  /** 实盘数：字符串保留「没填」和「填了 0」的区别；0 是有意义的（整批没了） */
  counted: string;
  /** 定制款盘亏：勾选少的是哪几件 */
  missingIds: string[];
  /** 表里原本没有、手动补进来的款 */
  added?: boolean;
};

export function StocktakeForm({ meta }: { meta: StocktakeMeta }) {
  const router = useRouter();
  const toast = useToast();

  const defaultLocation =
    meta.locations.find((l) => l.type === "normal") ?? meta.locations[0] ?? null;

  const [locationId, setLocationId] = useState(defaultLocation?.id ?? "");
  const [snapshotInput, setSnapshotInput] = useState(meta.now);
  /** 生成盘点表用的时点：只有点「重新生成」才跟着变，避免填到一半账面被刷掉 */
  const [loadedSnapshot, setLoadedSnapshot] = useState(meta.now);

  const [rows, setRows] = useState<RowState[]>([]);
  const [bookTotal, setBookTotal] = useState(0);
  const [afterTotal, setAfterTotal] = useState(0);
  // 首屏直接按「加载中」渲染：否则会先闪一下「这个仓位一件货都没有」，再跳出真实的行
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [filter, setFilter] = useState("");
  const [remark, setRemark] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState<"draft" | "approve" | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addResults, setAddResults] = useState<ProductView[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const addBoxRef = useRef<HTMLDivElement>(null);

  const location = meta.locations.find((l) => l.id === locationId) ?? null;
  const staleSnapshot = snapshotInput !== loadedSnapshot;

  const loadSheet = useCallback(
    async (locId: string, snapshot: string) => {
      if (!locId) return;
      setLoading(true);
      setLoadError("");
      try {
        const res = await api<StocktakeSheet>(
          `/api/stocktakes/sheet?locationId=${encodeURIComponent(locId)}&snapshotAt=${encodeURIComponent(snapshot)}`,
        );
        setRows(res.rows.map((r) => ({ sku: r, counted: "", missingIds: [] })));
        setBookTotal(res.bookTotal);
        setAfterTotal(res.afterTotal);
        setLoadedSnapshot(snapshot);
        setFilter("");
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : "生成盘点表失败，请重试");
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!locationId) return;
    // 换仓位就等于换一张盘点表：截止时点也回到此刻，避免拿着旧时点去盘新仓位
    setSnapshotInput(meta.now);
    void loadSheet(locationId, meta.now);
  }, [locationId, meta.now, loadSheet]);

  // 补款搜索
  useEffect(() => {
    if (!addOpen) return;
    let cancelled = false;
    setAddSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api<{ items: ProductView[] }>(
          `/api/products/search?q=${encodeURIComponent(addQuery.trim())}&limit=8`,
        );
        if (!cancelled) setAddResults(res.items);
      } catch {
        if (!cancelled) setAddResults([]);
      } finally {
        if (!cancelled) setAddSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [addQuery, addOpen]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (addBoxRef.current && !addBoxRef.current.contains(e.target as Node)) setAddOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const visibleRows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        r.sku.productName.toLowerCase().includes(term) ||
        (r.sku.colorName ?? "").toLowerCase().includes(term),
    );
  }, [rows, filter]);

  const stats = useMemo(() => {
    let filled = 0;
    let required = 0;
    let gain = 0;
    let loss = 0;
    let diffLines = 0;
    for (const row of rows) {
      if (row.sku.bookQty !== 0) required += 1;
      if (row.counted.trim() === "") continue;
      filled += 1;
      const n = Number(row.counted);
      if (!Number.isFinite(n)) continue;
      const diff = n - row.sku.bookQty;
      if (diff > 0) gain += diff;
      if (diff < 0) loss += -diff;
      if (diff !== 0) diffLines += 1;
    }
    return { filled, required, gain, loss, diffLines };
  }, [rows]);

  function setCounted(skuId: string, value: string) {
    if (value !== "" && !/^\d{0,6}$/.test(value)) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.sku.skuId !== skuId) return r;
        // 实盘数改了，勾选的件数要跟着对齐，否则会留下对不上的勾选
        if (value === "") return { ...r, counted: value, missingIds: [] };
        const need = Math.max(0, r.sku.bookQty - Number(value));
        return { ...r, counted: value, missingIds: r.missingIds.slice(0, need) };
      }),
    );
  }

  function toggleMissing(skuId: string, instanceId: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.sku.skuId !== skuId) return r;
        const n = Number(r.counted);
        const need = Number.isFinite(n) ? Math.max(0, r.sku.bookQty - n) : 0;
        const has = r.missingIds.includes(instanceId);
        if (has) return { ...r, missingIds: r.missingIds.filter((id) => id !== instanceId) };
        if (r.missingIds.length >= need) return r;
        return { ...r, missingIds: [...r.missingIds, instanceId] };
      }),
    );
  }

  function fillByBook() {
    let filled = 0;
    setRows((prev) =>
      prev.map((r) => {
        if (r.counted.trim() !== "" || r.sku.bookQty === 0) return r;
        filled += 1;
        return { ...r, counted: String(r.sku.bookQty) };
      }),
    );
    toast.info(`已按账面填充 ${filled} 行，只需改有差异的那几行`);
  }

  function addSku(sku: { id: string; colorName: string | null; variantType: "normal" | "custom" }) {
    const product = addResults.find((p) => p.colors.some((c) => c.id === sku.id));
    if (!product) return;
    if (rows.some((r) => r.sku.skuId === sku.id)) {
      toast.info("这个颜色已经在盘点表里了");
      setAddOpen(false);
      return;
    }
    setRows((prev) => [
      ...prev,
      {
        sku: {
          skuId: sku.id,
          productId: product.id,
          productName: product.name,
          unit: product.unit,
          colorName: sku.colorName,
          variantType: sku.variantType,
          bookQty: 0,
          afterQty: 0,
          instances: [],
        },
        counted: "",
        missingIds: [],
        added: true,
      },
    ]);
    setAddQuery("");
    setAddOpen(false);
  }

  function validate(): string {
    if (!locationId) return "请选择要盘的仓位";

    const blank = rows.filter((r) => r.sku.bookQty !== 0 && r.counted.trim() === "");
    if (blank.length > 0) {
      const names = blank
        .slice(0, 3)
        .map((r) => `${r.sku.productName}${r.sku.colorName ? ` · ${r.sku.colorName}` : ""}`);
      return `还有 ${blank.length} 行没填实盘数：${names.join("、")}${blank.length > 3 ? " 等" : ""}。账面上有货的行必须盘一遍`;
    }

    const picked = rows.filter((r) => r.counted.trim() !== "");
    if (picked.length === 0) return "一行实盘数都没填，这张盘点单没有意义";

    for (const r of picked) {
      const n = Number(r.counted);
      if (!Number.isInteger(n) || n < 0) {
        return `「${r.sku.productName}${r.sku.colorName ? ` · ${r.sku.colorName}` : ""}」的实盘数请填非负整数`;
      }
      const diff = n - r.sku.bookQty;
      if (r.sku.variantType === "custom" && diff > 0) {
        return `「${r.sku.productName}」是定制款，每件都有编号，账上没有的件不会凭空多出来。请核对实盘数`;
      }
      if (r.sku.variantType === "custom" && diff < 0 && r.missingIds.length !== -diff) {
        return `「${r.sku.productName}${r.sku.colorName ? ` · ${r.sku.colorName}` : ""}」少了 ${-diff} 件，要勾选少的是哪几件`;
      }
    }

    return "";
  }

  async function submit(approveNow: boolean) {
    if (submitting) return;
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }
    setError("");
    setSubmitting(approveNow ? "approve" : "draft");

    const items = rows
      .filter((r) => r.counted.trim() !== "")
      .map((r) => ({
        skuId: r.sku.skuId,
        countedQty: Number(r.counted),
        instanceIds: r.missingIds,
      }));

    try {
      const doc = await api<{ id: string; docNo: string }>("/api/stocktakes", {
        method: "POST",
        body: JSON.stringify({
          locationId,
          snapshotAt: loadedSnapshot,
          remark: remark.trim() || null,
          items,
          approveNow,
        }),
      });
      toast.success(approveNow ? `盘点单 ${doc.docNo} 已生效，库存已按差异调整` : `草稿 ${doc.docNo} 已保存`);
      router.push(`/stocktakes/${doc.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败，请重试");
      setSubmitting(null);
    }
  }

  return (
    <div className="space-y-4">
      <FormTitle
        backHref="/stocktakes"
        backTitle="返回盘点列表"
        title="新建盘点单"
        description="选仓位、定截止时点，系统把账面数列出来，你只管填实盘数。盘点期间照常发货。"
      />

      {/* 盘点范围 */}
      <section className="card p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">盘哪个仓位</label>
            <div className="flex flex-wrap gap-1.5">
              {meta.locations.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => setLocationId(loc.id)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors ${
                    locationId === loc.id
                      ? "border-brand bg-brand-soft font-medium text-brand-ink"
                      : "border-line bg-card text-ink-2 hover:border-line"
                  }`}
                >
                  <Warehouse size={13} strokeWidth={1.7} />
                  {loc.name}
                  <span className={`tag ${LOCATION_TYPE_TONE[loc.type]}`}>
                    {loc.isSellable ? "可售" : "不可售"}
                  </span>
                </button>
              ))}
            </div>
            {location ? (
              <p className="mt-1.5 text-[11.5px] text-muted">{LOCATION_TYPE_LABEL[location.type]}</p>
            ) : null}
          </div>

          <div>
            <label className="label">截止时点</label>
            <div className="flex gap-2">
              <input
                type="datetime-local"
                className="input tnum"
                value={snapshotInput}
                max={meta.now}
                min={meta.earliest}
                onChange={(e) => setSnapshotInput(e.target.value)}
              />
              {staleSnapshot ? (
                <button
                  type="button"
                  className="btn-ghost btn-sm shrink-0"
                  onClick={() => {
                    if (rows.some((r) => r.counted.trim() !== "")) {
                      toast.info("已按新的截止时点重新生成盘点表，实盘数需要重填");
                    }
                    void loadSheet(locationId, snapshotInput);
                  }}
                  title="按新的截止时点重新算账面"
                >
                  <RefreshCw size={13} />
                  重新生成
                </button>
              ) : null}
            </div>
            <p className="mt-1.5 text-[11.5px] text-muted">
              账面数按这一刻切。之后发生的发货、入库算「截止后变动」，不影响这次盘点。
            </p>
          </div>
        </div>

        <div className="mt-4">
          <label className="label">备注（可选）</label>
          <input
            className="input"
            placeholder="例：月末盘点，主仓东侧货架；两人复核"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-brand/30 bg-brand-soft/60 px-3 py-2.5 text-[12px] leading-5 text-brand-ink">
          <Sparkles size={14} className="mt-0.5 shrink-0" />
          <div>
            <b>不用停业：</b>盘点期间照常发货、照常入库。截止后发生的出入库单独显示在「截止后」一列，
            不会把你的实盘数算成差异。
          </div>
        </div>
      </section>

      {/* 盘点明细 */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-[14px] font-semibold text-ink">盘点明细</h2>
            <span className="tnum text-[11.5px] text-muted">
              账面合计 {bookTotal}
              {afterTotal !== 0 ? ` · 截止后 ${afterTotal > 0 ? "+" : ""}${afterTotal}` : ""}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="tag tnum bg-sunken text-ink-2">
              已填 {stats.filled}/{stats.required} 行必盘
            </span>
            {stats.gain > 0 ? (
              <span className="tag tnum bg-ok-soft text-ok">盘盈 +{stats.gain}</span>
            ) : null}
            {stats.loss > 0 ? (
              <span className="tag tnum bg-danger-soft text-danger">盘亏 -{stats.loss}</span>
            ) : null}
            {stats.diffLines > 0 ? (
              <span className="tag tnum bg-warn-soft text-warn">{stats.diffLines} 行有差异</span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-line-2 px-3 py-2.5">
          <div className="relative min-w-[180px] flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              className="input pl-9"
              placeholder="在盘点表里找款（输入中文或拼音首字母）"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={fillByBook} disabled={loading}>
            <Check size={13} />
            按账面一键填充
          </button>
          <div className="relative" ref={addBoxRef}>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setAddOpen((v) => !v)}
              disabled={loading}
              title="表里没有的款（账上没有、实物有多）加进来"
            >
              <Plus size={13} />
              补一个款
            </button>
            {addOpen ? (
              <div className="absolute right-0 z-30 mt-1 w-[320px] rounded-card border border-line bg-card p-2 shadow-sm">
                <input
                  autoFocus
                  className="input mb-1.5"
                  placeholder="搜产品名 / 拼音首字母"
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                />
                <div className="max-h-[260px] space-y-1 overflow-y-auto">
                  {addSearching ? (
                    <div className="flex items-center gap-2 px-2 py-3 text-[12.5px] text-muted">
                      <Loader2 size={13} className="animate-spin" />
                      搜索中…
                    </div>
                  ) : addResults.length === 0 ? (
                    <div className="px-2 py-3 text-[12.5px] text-muted">没找到，换个词试试</div>
                  ) : (
                    addResults.map((p) => (
                      <div key={p.id} className="rounded-lg px-2 py-1.5 hover:bg-sunken">
                        <div className="text-[12.5px] font-medium text-ink">{p.name}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {p.colors.length === 0 ? (
                            <span className="text-[11.5px] text-muted">没有颜色行</span>
                          ) : (
                            p.colors.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => addSku(c)}
                                className="tag bg-sunken text-ink-2 transition-colors hover:bg-brand-soft hover:text-brand-ink"
                              >
                                {colorText(c.colorName)}
                                {c.variantType === "custom" ? " · 定制" : ""}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-muted">
            <Loader2 size={16} className="animate-spin" />
            正在按截止时点算账面…
          </div>
        ) : loadError ? (
          <div className="flex items-center gap-2 px-4 py-12 text-[13px] text-danger">
            <AlertCircle size={15} />
            {loadError}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-sunken text-muted">
              <ClipboardCheck size={20} strokeWidth={1.6} />
            </div>
            <p className="text-[13.5px] text-ink-2">这个仓位账面上一件货都没有</p>
            <p className="text-[12.5px] text-muted">刚开张或者货都出完了。要盘实物请点右上角「补一个款」</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr>
                  <th className="th w-[38px]">#</th>
                  <th className="th">产品 / 颜色</th>
                  <th className="th w-[92px] text-right">账面</th>
                  <th className="th w-[112px] text-right">实盘</th>
                  <th className="th w-[92px] text-right">差异</th>
                  <th className="th w-[88px] text-right">截止后</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const hasValue = row.counted.trim() !== "";
                  const n = hasValue ? Number(row.counted) : NaN;
                  const diff = hasValue && Number.isFinite(n) ? n - row.sku.bookQty : null;
                  const need =
                    hasValue && Number.isFinite(n) ? Math.max(0, row.sku.bookQty - n) : 0;
                  const isCustom = row.sku.variantType === "custom";
                  // 行号用整张表的顺序：筛选之后 # 不会跳号
                  const rowNo = rows.indexOf(row) + 1;

                  return (
                    <Fragment key={row.sku.skuId}>
                      <tr className={diff !== null && diff !== 0 ? "bg-warn-soft" : undefined}>
                        <td className="td tnum text-muted">{rowNo}</td>
                        <td className="td">
                          <div className="font-medium text-ink">
                            {row.sku.productName}
                            {row.added ? (
                              <span className="tag ml-1.5 bg-warn-soft text-warn">补录</span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                            <span className={row.sku.colorName ? "text-ink-2" : ""}>
                              {colorText(row.sku.colorName)}
                            </span>
                            {isCustom ? (
                              <span className="tag bg-warn-soft text-warn">定制·按件</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="td tnum text-right text-ink-2">
                          {row.sku.bookQty}
                          <span className="ml-0.5 text-[11px] text-muted">{row.sku.unit}</span>
                        </td>
                        <td className="td text-right">
                          <input
                            className={`input tnum w-[86px] text-right ${
                              row.sku.bookQty !== 0 && !hasValue ? "border-warn/40 bg-warn-soft" : ""
                            }`}
                            inputMode="numeric"
                            placeholder={row.sku.bookQty !== 0 ? "必填" : "—"}
                            value={row.counted}
                            onChange={(e) => setCounted(row.sku.skuId, e.target.value)}
                          />
                        </td>
                        <td className="td tnum text-right font-medium">
                          {diff === null ? (
                            <span className="text-muted">—</span>
                          ) : diff === 0 ? (
                            <span className="text-muted">0</span>
                          ) : (
                            <span className={diff > 0 ? "text-ok" : "text-danger"}>
                              {diff > 0 ? "+" : ""}
                              {diff}
                            </span>
                          )}
                        </td>
                        <td className="td tnum text-right text-[12.5px] text-muted">
                          {row.sku.afterQty === 0
                            ? "—"
                            : `${row.sku.afterQty > 0 ? "+" : ""}${row.sku.afterQty}`}
                        </td>
                      </tr>

                      {/* 定制款盘亏：必须落到具体件 */}
                      {isCustom && need > 0 ? (
                        <tr>
                          <td className="td" />
                          <td className="td bg-warn-soft" colSpan={5}>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[11.5px] text-warn">
                                少了 {need} 件，勾出来：
                              </span>
                              {row.sku.instances.length === 0 ? (
                                <span className="text-[11.5px] text-muted">
                                  这个仓位里没有它的件，请核对
                                </span>
                              ) : (
                                row.sku.instances.map((inst) => {
                                  const on = row.missingIds.includes(inst.id);
                                  const disabled =
                                    !on && (!!inst.reservedBy || row.missingIds.length >= need);
                                  return (
                                    <button
                                      key={inst.id}
                                      type="button"
                                      disabled={disabled}
                                      onClick={() => toggleMissing(row.sku.skuId, inst.id)}
                                      title={
                                        inst.reservedBy
                                          ? `已被 ${inst.reservedBy} 占用，先处理那边`
                                          : (inst.productionDate ?? "无生产日期")
                                      }
                                      className={`tag tnum transition-colors ${
                                        on
                                          ? "bg-danger-soft text-danger"
                                          : disabled
                                            ? "bg-sunken text-muted"
                                            : "bg-sunken text-ink-2 hover:bg-sunken"
                                      }`}
                                    >
                                      {on ? "✓ " : ""}
                                      {inst.code}
                                    </button>
                                  );
                                })
                              )}
                              <span className="tnum text-[11.5px] text-muted">
                                已勾 {row.missingIds.length}/{need}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {error ? (
        <div className="flex items-start gap-2.5 rounded-card border border-danger/30 bg-danger-soft px-3.5 py-3 text-[12.5px] leading-5 text-danger">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted">
          保存草稿不动库存；点「保存并生效」才按差异调整账。
        </p>
        <div className="flex gap-2">
          <Link href="/stocktakes" className="btn-ghost">
            取消
          </Link>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => submit(false)}
            disabled={submitting !== null || loading}
          >
            {submitting === "draft" ? <Loader2 size={14} className="animate-spin" /> : null}
            保存草稿
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => submit(true)}
            disabled={submitting !== null || loading}
          >
            {submitting === "approve" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            保存并生效
          </button>
        </div>
      </div>
    </div>
  );
}
