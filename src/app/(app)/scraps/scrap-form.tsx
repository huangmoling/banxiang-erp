"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, PackageOpen } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { CancelButton } from "@/components/ui/doc";
import {
  DISPOSITION_HINT,
  DISPOSITION_LABEL,
  colorText,
  type Disposition,
  type ScrapMeta,
  type ScrapStockResult,
} from "@/modules/scrap/scrap.types";

type RowState = {
  qty: string;
  disposition: Disposition;
  remark: string;
  /** 定制款：勾选的件号（数量由勾选决定，不让手填） */
  picked: string[];
};

const DISPOSITIONS: Disposition[] = ["scrap", "offline_sale", "self_dispose"];

export function ScrapForm({
  meta,
  initialLocationId,
  presetSkuId,
  presetDisposition,
  embedded = false,
  onCancel,
}: {
  meta: ScrapMeta;
  initialLocationId: string | null;
  presetSkuId: string | null;
  presetDisposition: Disposition | null;
  embedded?: boolean;
  /** 抽屉里点取消：直接关抽屉，而不是跳回同一个列表页 */
  onCancel?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();

  const [locationId, setLocationId] = useState<string>(initialLocationId ?? "");
  const [bizDate, setBizDate] = useState(meta.today);
  const [remark, setRemark] = useState("");
  const [stock, setStock] = useState<ScrapStockResult | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<null | "draft" | "approve">(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadStock = useCallback(
    async (id: string) => {
      if (!id) return;
      setLoading(true);
      setLoadError(null);
      try {
        const res = await api<ScrapStockResult>(
          `/api/scraps/stock?locationId=${encodeURIComponent(id)}`,
        );
        setStock(res);
        const next: Record<string, RowState> = {};
        for (const row of res.rows) {
          const preset = row.skuId === presetSkuId;
          next[row.skuId] = {
            qty: preset && row.variantType === "normal" ? String(row.qty) : "",
            disposition: presetDisposition ?? "scrap",
            remark: "",
            picked: [],
          };
        }
        setRows(next);
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : "加载库存失败");
        setStock(null);
      } finally {
        setLoading(false);
      }
    },
    [presetSkuId, presetDisposition],
  );

  useEffect(() => {
    void loadStock(locationId);
  }, [locationId, loadStock]);

  function setRow(skuId: string, patch: Partial<RowState>) {
    setRows((prev) => {
      const current = prev[skuId];
      if (!current) return prev;
      return { ...prev, [skuId]: { ...current, ...patch } };
    });
  }

  function togglePick(skuId: string, instanceId: string, max: number) {
    setRows((prev) => {
      const row = prev[skuId];
      if (!row) return prev;
      const on = row.picked.includes(instanceId);
      if (!on && row.picked.length >= max) return prev;
      return {
        ...prev,
        [skuId]: {
          ...row,
          picked: on ? row.picked.filter((id) => id !== instanceId) : [...row.picked, instanceId],
        },
      };
    });
  }

  /** 每行实际要处理多少：常规款看填的数字，定制款看勾了几件 */
  const entries = useMemo(() => {
    if (!stock) return [];
    return stock.rows
      .map((row) => {
        const state = rows[row.skuId];
        if (!state) return null;
        const qty =
          row.variantType === "custom" ? state.picked.length : Number.parseInt(state.qty || "0", 10);
        if (!Number.isFinite(qty) || qty <= 0) return null;
        return { row, state, qty };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
  }, [stock, rows]);

  const totalQty = entries.reduce((sum, e) => sum + e.qty, 0);

  async function submit(approveNow: boolean) {
    if (saving) return;
    if (!locationId) {
      toast.error("先选一个源仓位");
      return;
    }
    if (entries.length === 0) {
      toast.error("还没有填任何一行。数量填 0 的款不会被处理");
      return;
    }
    for (const e of entries) {
      if (e.qty > e.row.qty) {
        toast.error(
          `「${e.row.productName} ${colorText(e.row.colorName)}」这个仓位只有 ${e.row.qty} ${e.row.unit}，不能处理 ${e.qty}`,
        );
        return;
      }
      if (e.state.disposition === "self_dispose" && !e.state.remark.trim()) {
        toast.error(
          `「${e.row.productName} ${colorText(e.row.colorName)}」选了自行处理，要写一句怎么处理的`,
        );
        return;
      }
    }

    setSaving(approveNow ? "approve" : "draft");
    try {
      const doc = await api<{ id: string; docNo: string }>("/api/scraps", {
        method: "POST",
        json: {
          sourceLocationId: locationId,
          bizDate,
          remark: remark.trim() || null,
          approveNow,
          items: entries.map((e) => ({
            skuId: e.row.skuId,
            qty: e.qty,
            disposition: e.state.disposition,
            remark: e.state.remark.trim() || null,
            instanceIds: e.state.picked,
          })),
        },
      });
      toast.success(
        approveNow ? `已生效，${totalQty} 件已按各自方式处理` : `草稿已保存（${doc.docNo}），库存还没动`,
      );
      router.push(`/scraps/${doc.id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "保存失败，请重试");
      setSaving(null);
    }
  }

  const isDefective = stock?.locationType === "defective";

  return (
    <div className={embedded ? "flex min-h-full flex-col pb-24" : "pb-24"}>
      {embedded ? null : (
        <div className="mb-4 flex items-center gap-3">
          <Link href="/scraps" className="btn-ghost btn-sm" aria-label="返回">
            <ArrowLeft size={14} />
          </Link>
          <div>
            <h1 className="text-[19px] font-semibold text-ink">新建处置单</h1>
            <p className="mt-0.5 text-[13px] text-muted">
              只有填了数量的行才会被处理；没填的行留在原处不动。
            </p>
          </div>
        </div>
      )}

      <div className="card mb-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="source">
              货从哪个仓位出去 <span className="text-danger">*</span>
            </label>
            <select
              id="source"
              className="input"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              {meta.locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                  {loc.type === "defective" ? "（次品区）" : loc.isSellable ? "（可售）" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="bizDate">
              业务日期
            </label>
            <input
              id="bizDate"
              type="date"
              className="input"
              max={meta.today}
              value={bizDate}
              onChange={(e) => setBizDate(e.target.value)}
            />
          </div>
        </div>

        {isDefective ? (
          <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] leading-5 text-warn">
            次品区的货不计入可售库存。转报废后货会进报废区（还在仓库里），
            线下出售和自行处理则直接从账上离开。
          </p>
        ) : null}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-16 text-[13px] text-muted">
            <Loader2 size={15} className="animate-spin" />
            正在读这个仓位的库存…
          </div>
        ) : loadError ? (
          <div className="px-4 py-16 text-center text-[13px] text-danger">{loadError}</div>
        ) : !stock || stock.rows.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <PackageOpen size={22} className="mx-auto text-muted" />
            <p className="mt-3 text-[13.5px] text-ink-2">
              「{stock?.locationName ?? "这个仓位"}」里现在没有货
            </p>
            <p className="mt-1.5 text-[12.5px] text-muted">
              货要先入库才谈得上处置。
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">商品 / 颜色</th>
                <th className="th w-[90px] text-right">现有</th>
                <th className="th w-[130px]">处理数量</th>
                <th className="th w-[150px]">处理方式</th>
                <th className="th w-[200px]">说明</th>
              </tr>
            </thead>
            <tbody>
              {stock.rows.map((row) => {
                const state = rows[row.skuId];
                if (!state) return null;
                const isCustom = row.variantType === "custom";
                const qty = isCustom ? state.picked.length : Number.parseInt(state.qty || "0", 10) || 0;
                const active = qty > 0;

                return (
                  <Fragment key={row.skuId}>
                    <tr className={active ? "bg-brand-soft" : undefined}>
                      <td className="td">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{row.productName}</span>
                          <span className="text-muted">·</span>
                          <span>{colorText(row.colorName)}</span>
                          {isCustom ? (
                            <span className="tag bg-brand-soft text-brand-ink">定制 · 按件</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="td tnum text-right text-ink-2">
                        {row.qty} {row.unit}
                      </td>
                      <td className="td">
                        {isCustom ? (
                          <span className="text-[13px] text-muted">
                            {state.picked.length > 0 ? `已勾 ${state.picked.length} 件` : "在下方勾件"}
                          </span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            max={row.qty}
                            className="input w-[90px] py-1.5 text-[13px]"
                            placeholder="0"
                            value={state.qty}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v !== "" && !/^\d{0,6}$/.test(v)) return;
                              setRow(row.skuId, { qty: v });
                            }}
                          />
                        )}
                      </td>
                      <td className="td">
                        <select
                          className="input py-1.5 text-[13px]"
                          value={state.disposition}
                          onChange={(e) => setRow(row.skuId, { disposition: e.target.value as Disposition })}
                        >
                          {DISPOSITIONS.map((d) => (
                            <option key={d} value={d}>
                              {DISPOSITION_LABEL[d]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="td">
                        <input
                          className="input py-1.5 text-[13px]"
                          placeholder={state.disposition === "self_dispose" ? "必填：送人 / 拆解 / 丢弃" : "选填"}
                          maxLength={100}
                          value={state.remark}
                          onChange={(e) => setRow(row.skuId, { remark: e.target.value })}
                        />
                      </td>
                    </tr>

                    {active ? (
                      <tr>
                        <td className="td bg-sunken pt-0" colSpan={5}>
                          <p className="text-[12px] leading-5 text-muted">
                            {DISPOSITION_HINT[state.disposition]}
                          </p>
                        </td>
                      </tr>
                    ) : null}

                    {/* 定制款：必须点到具体件，一物一码不能只说「2 件」 */}
                    {isCustom && active ? (
                      <tr>
                        <td className="td border-t-0 bg-sunken" colSpan={5}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[12.5px] text-muted">勾选要处理的件：</span>
                            {row.instances.map((inst) => {
                              const on = state.picked.includes(inst.id);
                              const blocked = !!inst.reservedBy && !on;
                              return (
                                <button
                                  key={inst.id}
                                  type="button"
                                  disabled={blocked}
                                  onClick={() => togglePick(row.skuId, inst.id, row.qty)}
                                  title={
                                    inst.reservedBy
                                      ? `已被 ${inst.reservedBy} 占用`
                                      : (inst.productionDate ?? "无生产日期")
                                  }
                                  className={`rounded-md border px-2 py-1 text-[12px] transition-colors ${
                                    on
                                      ? "border-brand bg-brand-soft text-brand-ink"
                                      : blocked
                                        ? "cursor-not-allowed border-line-2 text-muted"
                                        : "border-line text-ink-2 hover:border-line"
                                  }`}
                                >
                                  {inst.code}
                                </button>
                              );
                            })}
                            {row.instances.length === 0 ? (
                              <span className="text-[12.5px] text-muted">
                                这个款在库没有可处理的件号
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-card/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3">
          <div className="text-[13px] text-ink-2">
            共 <span className="tnum font-semibold text-ink">{entries.length}</span> 行、
            <span className="tnum font-semibold text-ink"> {totalQty} </span> 件
          </div>
          <input
            className="input ml-2 max-w-[320px] py-1.5 text-[13px]"
            placeholder="整单备注（选填）"
            maxLength={500}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
          <div className="ml-auto flex gap-2">
            <CancelButton href="/scraps" onCancel={onCancel} className="btn-ghost btn-sm" />
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => submit(false)}
              disabled={saving !== null}
            >
              {saving === "draft" ? <Loader2 size={14} className="animate-spin" /> : null}
              存草稿
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => submit(true)}
              disabled={saving !== null}
            >
              {saving === "approve" ? <Loader2 size={14} className="animate-spin" /> : null}
              保存并生效
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
