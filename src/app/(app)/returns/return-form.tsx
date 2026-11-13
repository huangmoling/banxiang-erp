"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Search,
  Undo2,
  Warehouse,
} from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { FormTitle, InlineError } from "@/components/ui/doc";
import { todayDateOnly } from "@/lib/date";
import {
  CUSTOM_ALLOWED_DESTINATIONS,
  DESTINATION_HINT,
  DESTINATION_LABEL,
  colorText,
  type OriginDetail,
  type ReturnDestination,
  type ReturnDocView,
  type ReturnMeta,
  type ReturnableOrigin,
} from "@/modules/returns/return.types";

type Row = {
  originItemId: string;
  /** 常规款手填；定制款跟着勾选的件数走 */
  qty: number;
  destination: ReturnDestination;
  /** 定制款：退回的件 id */
  instanceIds: string[];
  picking: boolean;
};

export function ReturnForm({ meta, embedded = false }: { meta: ReturnMeta; embedded?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const today = meta.today || todayDateOnly();

  const [origin, setOrigin] = useState<OriginDetail | null>(null);
  const [loadingOrigin, setLoadingOrigin] = useState(false);

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<ReturnableOrigin[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  const [rows, setRows] = useState<Record<string, Row>>({});
  const [bizDate, setBizDate] = useState(today);
  const [trackingNo, setTrackingNo] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [externalNo, setExternalNo] = useState("");
  const [remark, setRemark] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState<"draft" | "approve" | null>(null);

  const boxRef = useRef<HTMLDivElement>(null);

  const pickedRows = useMemo(
    () => Object.values(rows).filter((r) => r.qty > 0 || r.instanceIds.length > 0),
    [rows],
  );
  const totalQty = pickedRows.reduce((sum, r) => sum + r.qty, 0);
  const units = new Set(
    pickedRows.map((r) => origin?.items.find((i) => i.id === r.originItemId)?.unit ?? "件"),
  );
  const totalUnit = units.size === 1 ? [...units][0] : "件";
  const byDest = pickedRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.destination] = (acc[r.destination] ?? 0) + r.qty;
    return acc;
  }, {});

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // 搜索原出库单：打开就列最近的已生效出库单
  useEffect(() => {
    if (!open || origin) return;
    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const res = await api<{ items: ReturnableOrigin[] }>(
          `/api/returns/origins?q=${encodeURIComponent(q.trim())}&limit=10`,
        );
        if (!cancelled) {
          setCandidates(res.items);
          setActiveIdx(0);
        }
      } catch {
        if (!cancelled) setCandidates([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, open, origin]);

  async function loadOrigin(id: string) {
    setLoadingOrigin(true);
    setError("");
    try {
      const detail = await api<OriginDetail>(`/api/returns/origins/${id}`);

      const next: Record<string, Row> = {};
      for (const item of detail.items) {
        next[item.id] = {
          originItemId: item.id,
          qty: 0,
          // 定制款默认就进次品区：它没有「回良品架」这个选项
          destination: item.variantType === "custom" ? "defective" : "good",
          instanceIds: [],
          picking: item.variantType === "custom" && item.returnableQty > 0,
        };
      }

      setOrigin(detail);
      setRows(next);
      setExternalNo(detail.externalNo ?? "");
      setReceiverName(detail.receiverName ?? "");
      setOpen(false);
      setQ("");

      if (detail.returnableQty === 0) {
        toast.info("这张出库单的货已经全部退完了，没有可退的数量");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "读取原出库单失败，请重试");
    } finally {
      setLoadingOrigin(false);
    }
  }

  function resetOrigin() {
    setOrigin(null);
    setRows({});
    setExternalNo("");
    setReceiverName("");
    setTrackingNo("");
    setRemark("");
    setError("");
    setOpen(false);
  }

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  }

  function toggleInstance(rowId: string, instanceId: string) {
    setRows((prev) => {
      const row = prev[rowId];
      if (!row) return prev;
      const has = row.instanceIds.includes(instanceId);
      const next = has
        ? row.instanceIds.filter((id) => id !== instanceId)
        : [...row.instanceIds, instanceId];
      // 勾几件就是几件，数量不让人手填，避免「勾了 1 件填了 3 件」
      return { ...prev, [rowId]: { ...row, instanceIds: next, qty: next.length } };
    });
  }

  function validate(): string {
    if (!origin) return "先选一张要退货的原出库单";

    const items = Object.values(rows).filter((r) => r.qty > 0 || r.instanceIds.length > 0);
    if (items.length === 0) return "还没有填退货数量，在要退的行上填「本次退」";

    for (const row of items) {
      const item = origin.items.find((i) => i.id === row.originItemId);
      if (!item) continue;
      const label = `${item.productName} · ${colorText(item.colorName)}`;

      if (item.variantType === "custom") {
        if (row.instanceIds.length === 0) return `「${label}」是定制款，请勾选退回的是哪一件`;
        if (!CUSTOM_ALLOWED_DESTINATIONS.includes(row.destination)) {
          return `「${label}」是定制款，只能进次品区或报废，不能回良品架`;
        }
        continue;
      }

      if (!Number.isFinite(row.qty) || row.qty < 1) return `「${label}」的退货数量没填，或者填了 0`;
      if (row.qty > item.returnableQty) {
        return `「${label}」最多还能退 ${item.returnableQty} ${item.unit}（原单发了 ${item.qty}，已退 ${item.returnedQty}）`;
      }
    }

    return "";
  }

  async function submit(approveNow: boolean) {
    if (submitting || !origin) return;

    const message = validate();
    if (message) {
      setError(message);
      return;
    }

    setError("");
    setSubmitting(approveNow ? "approve" : "draft");

    try {
      const doc = await api<ReturnDocView>("/api/returns", {
        method: "POST",
        json: {
          originDocumentId: origin.id,
          bizDate,
          externalNo: externalNo.trim() || null,
          receiverName: receiverName.trim() || null,
          trackingNo: trackingNo.trim() || null,
          remark: remark.trim() || null,
          items: Object.values(rows)
            .filter((r) => r.qty > 0 || r.instanceIds.length > 0)
            .map((r) => ({
              originItemId: r.originItemId,
              qty: r.qty,
              destination: r.destination,
              instanceIds: r.instanceIds,
            })),
          approveNow,
        },
      });

      toast.success(approveNow ? `已入库，单号 ${doc.docNo}` : `草稿已保存：${doc.docNo}`);
      router.push(`/returns/${doc.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败，请重试");
      setSubmitting(null);
    }
  }

  return (
    <div className={embedded ? "flex min-h-full flex-col gap-4" : "space-y-4"}>
      {embedded ? null : (
        <FormTitle
          backHref="/returns"
          backTitle="返回退货列表"
          title="新建退货单"
          description="先找到原出库单 → 在要退的行上填数量、选去向 → 保存。审核后库存才会动。"
        />
      )}

      {error ? (
        <InlineError>{error}</InlineError>
      ) : null}

      {!origin ? (
        <section className="card p-4 sm:p-5">
          <h2 className="mb-1 text-[13.5px] font-semibold text-ink">第一步：找到原出库单</h2>
          <p className="mb-3 text-[11.5px] leading-5 text-muted">
            退货必须挂在一张已审核的出库单上，系统靠它校验「已退 ≤ 已发」，防止重复退货把库存退多。
          </p>

          <div className="relative" ref={boxRef}>
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted"
            />
            <input
              className="input pl-9"
              placeholder="输入出库单号、淘宝订单号、物流单号或产品名，如 CK-20261020"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (!open) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIdx((i) => Math.min(i + 1, candidates.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const picked = candidates[activeIdx];
                  if (picked) void loadOrigin(picked.id);
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
              autoFocus
              autoComplete="off"
            />

            {open ? (
              <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-card border border-line bg-card">
                {searching || loadingOrigin ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-[12.5px] text-muted">
                    <Loader2 size={14} className="animate-spin" />
                    读取中…
                  </div>
                ) : candidates.length === 0 ? (
                  <div className="px-3.5 py-5 text-center text-[12.5px] text-ink-2">
                    没有匹配的出库单。只列已审核生效的；草稿出库单的货还没发出去，退不了。
                  </div>
                ) : (
                  <ul className="max-h-[360px] overflow-y-auto py-1">
                    {candidates.map((c, i) => {
                      const allReturned = c.returnableQty === 0;
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onMouseEnter={() => setActiveIdx(i)}
                            onClick={() => void loadOrigin(c.id)}
                            className={`flex w-full items-start gap-3 px-3 py-2 text-left transition-colors ${
                              i === activeIdx ? "bg-brand-soft" : "hover:bg-sunken"
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="tnum text-[12.5px] font-medium text-ink">{c.docNo}</span>
                                <span className="tnum text-[11.5px] text-muted">{c.bizDate}</span>
                                {c.externalNo ? (
                                  <span className="tnum text-[11.5px] text-muted">{c.externalNo}</span>
                                ) : null}
                              </span>
                              <span className="mt-0.5 block truncate text-[11.5px] text-ink-2">
                                {c.preview || "—"}
                                {c.receiverInfo
                                  ? ` · ${c.receiverInfo.replace(/\s+/g, " ").slice(0, 34)}`
                                  : c.receiverName
                                    ? ` · ${c.receiverName}`
                                    : ""}
                              </span>
                            </span>
                            <span
                              className={`tnum shrink-0 text-[11.5px] ${
                                allReturned ? "text-muted" : "text-muted"
                              }`}
                            >
                              {allReturned ? "已退完" : `可退 ${c.returnableQty}`}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="flex items-center justify-between border-t border-line-2 bg-sunken px-3 py-2 text-[11.5px] text-muted">
                  <span>↑↓ 选择 · 回车确认</span>
                  <span>只显示已审核的出库单</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-sunken py-10 text-center">
            <Undo2 size={20} strokeWidth={1.6} className="text-muted" />
            <p className="text-[12.5px] text-muted">还没有选原单。搜到那张发货单，才能开始退</p>
          </div>
        </section>
      ) : (
        <>
          {/* 原单信息 */}
          <section className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tag bg-brand-soft text-brand-ink">原出库单</span>
                  <Link
                    href={`/outbound/${origin.id}`}
                    className="tnum text-[14px] font-semibold text-ink hover:text-brand-ink"
                  >
                    {origin.docNo}
                  </Link>
                  <span className="tnum text-[12px] text-muted">{origin.bizDate}</span>
                </div>
                <p className="mt-1 text-[12px] text-muted">
                  {origin.externalNo ? `淘宝单号 ${origin.externalNo} · ` : ""}
                  {origin.receiverName ? `收件人 ${origin.receiverName} · ` : ""}
                  已发 <b className="tnum text-ink-2">{origin.totalQty}</b> · 已退{" "}
                  <b className="tnum text-ink-2">{origin.returnedQty}</b> · 还能退{" "}
                  <b className="tnum text-brand-ink">{origin.returnableQty}</b>
                </p>
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={resetOrigin}>
                换一张单
              </button>
            </div>
          </section>

          {/* 明细 */}
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="text-[14px] font-semibold text-ink">填写退货</h2>
              <span className="text-[11.5px] text-muted">
                退多少就填多少 · 定制款要勾具体哪一件
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse">
                <thead>
                  <tr>
                    <th className="th w-[42px]">#</th>
                    <th className="th">产品 / 颜色</th>
                    <th className="th w-[64px] text-right">已发</th>
                    <th className="th w-[64px] text-right">已退</th>
                    <th className="th w-[64px] text-right">可退</th>
                    <th className="th w-[104px]">本次退</th>
                    <th className="th w-[124px]">去向</th>
                    <th className="th w-[120px]">退回的件</th>
                  </tr>
                </thead>
                <tbody>
                  {origin.items.map((item) => {
                    const row = rows[item.id];
                    if (!row) return null;

                    const done = item.returnableQty === 0;
                    const isCustom = item.variantType === "custom";
                    const over = !isCustom && row.qty > item.returnableQty;
                    const active = row.qty > 0 || row.instanceIds.length > 0;

                    return (
                      <Fragment key={item.id}>
                        <tr className={active ? "bg-brand-soft" : undefined}>
                          <td className="td tnum text-muted">{item.lineNo}</td>
                          <td className="td">
                            <div className="font-medium text-ink">{item.productName}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                              <span className={item.colorName ? "text-ink-2" : ""}>
                                {colorText(item.colorName)}
                              </span>
                              {isCustom ? (
                                <span className="tag bg-warn-soft text-warn">定制·按件</span>
                              ) : (
                                <span className="tag bg-sunken text-ink-2">常规·按数量</span>
                              )}
                              {item.batchNo ? (
                                <span className="tnum text-[10.5px]">{item.batchNo}</span>
                              ) : null}
                            </div>
                            {/* 一条单里可能有几十个买家买同一款，退的是谁只能看地址 */}
                            {item.receiverInfo ? (
                              <div
                                className="mt-0.5 max-w-[300px] truncate text-[10.5px] text-muted"
                                title={item.receiverInfo}
                              >
                                寄给 {item.receiverInfo.replace(/\s+/g, " ")}
                              </div>
                            ) : null}
                          </td>
                          <td className="td tnum text-right text-ink-2">{item.qty}</td>
                          <td className="td tnum text-right text-muted">{item.returnedQty}</td>
                          <td className="td tnum text-right font-medium">
                            {done ? (
                              <span className="tag bg-sunken text-muted">已退完</span>
                            ) : (
                              item.returnableQty
                            )}
                          </td>
                          <td className="td">
                            {isCustom ? (
                              <span
                                className={`input flex items-center justify-center px-1.5 py-1.5 text-[13px] tnum ${
                                  row.qty > 0 ? "text-ink" : "text-muted"
                                }`}
                                title="数量跟着勾选的件数走"
                              >
                                {row.qty}
                              </span>
                            ) : (
                              <input
                                type="number"
                                min={0}
                                max={item.returnableQty}
                                inputMode="numeric"
                                disabled={done}
                                className={`input px-1.5 py-1.5 text-center text-[13px] tnum ${
                                  over ? "border-danger/30 text-danger" : ""
                                } ${done ? "cursor-not-allowed bg-sunken text-muted" : ""}`}
                                value={Number.isFinite(row.qty) && row.qty !== 0 ? row.qty : ""}
                                onChange={(e) => updateRow(item.id, { qty: Number(e.target.value) })}
                                onFocus={(e) => e.currentTarget.select()}
                                placeholder={done ? "—" : "0"}
                                title={`最多退 ${item.returnableQty} ${item.unit}`}
                              />
                            )}
                          </td>
                          <td className="td">
                            {isCustom ? (
                              <select
                                className="input py-1.5 text-[12px]"
                                value={row.destination}
                                disabled={done}
                                onChange={(e) =>
                                  updateRow(item.id, {
                                    destination: e.target.value as ReturnDestination,
                                  })
                                }
                                title="定制件退货只能进次品区或报废"
                              >
                                {CUSTOM_ALLOWED_DESTINATIONS.map((d) => (
                                  <option key={d} value={d}>
                                    {DESTINATION_LABEL[d]}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <select
                                className="input py-1.5 text-[12px]"
                                value={row.destination}
                                disabled={done}
                                onChange={(e) =>
                                  updateRow(item.id, {
                                    destination: e.target.value as ReturnDestination,
                                  })
                                }
                              >
                                {(Object.keys(DESTINATION_LABEL) as ReturnDestination[]).map((d) => (
                                  <option key={d} value={d}>
                                    {DESTINATION_LABEL[d]}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="td">
                            {isCustom ? (
                              <button
                                type="button"
                                disabled={done}
                                onClick={() => updateRow(item.id, { picking: !row.picking })}
                                className={`flex w-full items-center justify-between gap-1 rounded-md border px-2 py-1.5 text-[12px] transition-colors ${
                                  done
                                    ? "cursor-not-allowed border-line-2 bg-sunken text-muted"
                                    : row.instanceIds.length > 0
                                      ? "border-brand/30 bg-brand-soft text-brand-ink"
                                      : "border-line bg-card text-ink-2 hover:border-line"
                                }`}
                              >
                                <span className="truncate">
                                  {row.instanceIds.length > 0
                                    ? `已选 ${row.instanceIds.length} 件`
                                    : "选择件"}
                                </span>
                                {row.picking ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                              </button>
                            ) : (
                              <span className="text-[11.5px] text-muted">—</span>
                            )}
                          </td>
                        </tr>

                        {isCustom && row.picking && !done ? (
                          <tr key={`${item.id}-inst`}>
                            <td className="td" />
                            <td className="td px-2.5 pb-2.5" colSpan={7}>
                              {item.instances.length === 0 ? (
                                <p className="py-1 text-[12px] text-danger">
                                  这一行没有发出去的单件记录，退不了。
                                </p>
                              ) : (
                                <div className="space-y-1.5 rounded-lg border border-line-2 bg-sunken p-2.5">
                                  <div className="flex items-center justify-between text-[11.5px] text-muted">
                                    <span>勾选退回来的件（勾几件就是几件）</span>
                                    <span className="tnum">共 {item.instances.length} 件</span>
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {item.instances.map((inst) => {
                                      const selected = row.instanceIds.includes(inst.id);
                                      const blocked = !inst.returnable;
                                      return (
                                        <button
                                          key={inst.id}
                                          type="button"
                                          disabled={blocked}
                                          onClick={() => toggleInstance(item.id, inst.id)}
                                          title={
                                            blocked
                                              ? inst.reservedBy
                                                ? `已被 ${inst.reservedBy} 占用`
                                                : inst.returnedByDocNo
                                                  ? `已退到 ${inst.returnedByDocNo}`
                                                  : "这一件已经退过了"
                                              : inst.productionDate
                                                ? `生产日期 ${inst.productionDate}`
                                                : undefined
                                          }
                                          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] transition-colors ${
                                            blocked
                                              ? "cursor-not-allowed border-line-2 bg-sunken text-muted"
                                              : selected
                                                ? "border-brand/30 bg-brand-soft text-brand-ink"
                                                : "border-line bg-card text-ink-2 hover:border-brand/30"
                                          }`}
                                        >
                                          {selected ? <Check size={11} /> : null}
                                          <span className="tnum">{inst.code}</span>
                                          <span className="text-[10.5px] text-muted">
                                            {blocked
                                              ? inst.reservedBy
                                                ? `${inst.reservedBy} 占用`
                                                : "已退"
                                              : (inst.productionDate ?? "无生产日期")}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
            <section className="card bg-sunken p-4 text-[12px] leading-[1.85] text-ink-2 sm:p-5">
              <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                <Warehouse size={14} strokeWidth={1.8} className="text-brand-ink" />
                去向怎么选
              </div>
              <ul className="space-y-1.5">
                {(Object.keys(DESTINATION_LABEL) as ReturnDestination[]).map((d) => (
                  <li key={d} className="flex gap-1.5">
                    <span className={`tag mt-0.5 shrink-0 ${d === "good" ? "bg-ok-soft text-ok" : d === "defective" ? "bg-warn-soft text-warn" : "bg-sunken text-ink-2"}`}>
                      {DESTINATION_LABEL[d]}
                    </span>
                    <span>{DESTINATION_HINT[d]}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 border-t border-line-2 pt-2.5 text-[11.5px] text-muted">
                定制款（定制色）退回来基本卖不掉，<b>系统不允许回良品架</b>，只能进次品区或报废。
                次品区不计入可售库存，可以后续线下出售或转报废。
              </p>
            </section>

            <section className="card p-4 sm:p-5">
              <h2 className="mb-3.5 text-[13.5px] font-semibold text-ink">单据信息</h2>

              <div className="space-y-3.5">
                <div>
                  <label className="label" htmlFor="bizDate">
                    退货日期
                  </label>
                  <input
                    id="bizDate"
                    type="date"
                    max={today}
                    className="input tnum"
                    value={bizDate}
                    onChange={(e) => setBizDate(e.target.value)}
                  />
                  <p className="mt-1 text-[11.5px] text-muted">补录前几天的退货就改成那天，账记在那一天。</p>
                </div>

                <div>
                  <label className="label" htmlFor="trackingNo">
                    退回物流单号
                  </label>
                  <input
                    id="trackingNo"
                    className="input tnum"
                    value={trackingNo}
                    onChange={(e) => setTrackingNo(e.target.value)}
                    placeholder="选填，买家寄回的单号"
                    maxLength={60}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="label" htmlFor="receiverName">
                      退回人
                    </label>
                    <input
                      id="receiverName"
                      className="input"
                      value={receiverName}
                      onChange={(e) => setReceiverName(e.target.value)}
                      placeholder="选填"
                      maxLength={40}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="externalNo">
                      淘宝订单号
                    </label>
                    <input
                      id="externalNo"
                      className="input tnum"
                      value={externalNo}
                      onChange={(e) => setExternalNo(e.target.value)}
                      placeholder="选填"
                      maxLength={60}
                    />
                  </div>
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
                    placeholder="选填：破损情况、客户反馈等"
                    maxLength={500}
                  />
                </div>
              </div>
            </section>
          </div>

          <div className="sticky bottom-0 -mx-4 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="tnum text-[12px] text-muted">
                {pickedRows.length} 行 · 合计 <b className="text-[14px] text-ink">{totalQty}</b>{" "}
                {totalUnit}
                {Object.entries(byDest).length > 0
                  ? ` · ${Object.entries(byDest)
                      .map(([d, n]) => `${DESTINATION_LABEL[d as ReturnDestination]} ${n}`)
                      .join(" / ")}`
                  : ""}
              </span>
              <div className="flex gap-2">
                <Link href="/returns" className="btn-ghost">
                  取消
                </Link>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => void submit(false)}
                  disabled={submitting !== null}
                  title="只存草稿，不影响库存"
                >
                  {submitting === "draft" ? <Loader2 size={14} className="animate-spin" /> : null}
                  存为草稿
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void submit(true)}
                  disabled={submitting !== null}
                >
                  {submitting === "approve" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  保存并审核入库
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
