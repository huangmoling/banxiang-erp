"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Trash2 } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/date";
import {
  colorText,
  type OutboundDocView,
  type OutboundItemView,
} from "@/modules/outbound/outbound.types";

/**
 * 出库明细（发货行）。
 *
 * 一行 = 一个买家 = 一个包裹。这张表是仓管一天里看最多的界面，所以：
 * - 地址必须完整显示、不截断（找货、贴单全靠它）
 * - 勾选 → 「确认发出 N 个」，缺货的那几个留着不动
 * - 发过的行灰掉、不能改、不能删
 */
export function OutboundLines({ doc, role }: { doc: OutboundDocView; role: string }) {
  const router = useRouter();
  const toast = useToast();

  const canShip = ["admin", "manager", "keeper"].includes(role);
  /** 已生效 / 已作废的单不再允许动明细 */
  const editable = doc.status !== "voided" && doc.status !== "approved";

  const [picked, setPicked] = useState<string[]>([]);
  const [shipping, setShipping] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<OutboundItemView | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ receiverInfo: "", externalNo: "", trackingNo: "" });

  const pending = doc.items.filter((i) => !i.shipped);
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const allPicked = pending.length > 0 && picked.length === pending.length;

  const unit =
    new Set(doc.items.map((i) => i.unit)).size === 1 ? (doc.items[0]?.unit ?? "件") : "件";

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleAll() {
    setPicked(allPicked ? [] : pending.map((i) => i.id));
  }

  async function ship() {
    if (picked.length === 0 || shipping) return;
    setShipping(true);
    try {
      const res = await api<{ shipped: number; remaining: number; allDone: boolean }>(
        `/api/outbound/${doc.id}/ship`,
        { method: "POST", json: { itemIds: picked } },
      );

      toast.success(
        res.allDone
          ? `已发出 ${res.shipped} 个包裹，全部发完，这张单结案`
          : `已发出 ${res.shipped} 个包裹，还剩 ${res.remaining} 个待发`,
      );
      setPicked([]);
      router.refresh();
      // 侧栏红角标立刻跟着减，不用等下一轮轮询
      window.dispatchEvent(new Event("suteng:pending-changed"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "确认失败，请重试");
    } finally {
      setShipping(false);
    }
  }

  function openEdit(item: OutboundItemView) {
    setForm({
      receiverInfo: item.receiverInfo ?? "",
      externalNo: item.externalNo ?? "",
      trackingNo: item.trackingNo ?? "",
    });
    setEditItem(item);
  }

  async function saveItem() {
    if (!editItem || saving) return;
    setSaving(true);
    try {
      await api(`/api/outbound/${doc.id}/items/${editItem.id}`, {
        method: "PATCH",
        json: {
          receiverInfo: form.receiverInfo.trim() || null,
          externalNo: form.externalNo.trim() || null,
          trackingNo: form.trackingNo.trim() || null,
        },
      });
      toast.success(`第 ${editItem.lineNo} 行的收货信息已更新`);
      setEditItem(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(item: OutboundItemView) {
    if (deleting) return;
    const ok = window.confirm(
      `删掉第 ${item.lineNo} 行「${item.productName} ×${item.qty}」？\n\n` +
        `这一行还没发出去，删掉不影响库存。删完剩下的行如果都发过了，这张单会自动结案。`,
    );
    if (!ok) return;

    setDeleting(item.id);
    try {
      await api<{ allDone: boolean }>(`/api/outbound/${doc.id}/items/${item.id}`, {
        method: "DELETE",
      });
      toast.success("已删掉这一行");
      setPicked((prev) => prev.filter((x) => x !== item.id));
      router.refresh();
      window.dispatchEvent(new Event("suteng:pending-changed"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败，请重试");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[14px] font-semibold text-ink">发货明细</h2>
          <span className="tnum text-[11.5px] text-muted">
            {doc.itemCount} 个包裹 · 合计 {doc.totalQty} {unit}
            {doc.hasShipped ? ` · 已发 ${doc.shippedCount}` : ""}
          </span>
        </div>

        {canShip && pending.length > 0 ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleAll}
              className="rounded-md px-2 py-1 text-[12px] text-ink-2 transition-colors hover:bg-sunken"
            >
              {allPicked ? "取消全选" : "全选未发"}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void ship()}
              disabled={picked.length === 0 || shipping}
              title="只对勾选的这几行扣库存，没勾的继续留着"
            >
              {shipping ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              确认发出 {picked.length > 0 ? picked.length : ""} 个
            </button>
          </div>
        ) : null}
      </div>

      <div className="divide-y divide-line-2">
        {doc.items.map((item) => {
          const selected = pickedSet.has(item.id);
          return (
            <div
              key={item.id}
              className={`flex gap-3 px-4 py-3 transition-colors ${
                item.shipped ? "bg-sunken" : selected ? "bg-brand-soft/40" : ""
              }`}
            >
              {/* 勾选框：发过的行不给勾，避免重复扣库存 */}
              {canShip && editable && !item.shipped ? (
                <input
                  type="checkbox"
                  className="mt-[3px] h-4 w-4 shrink-0 accent-brand"
                  checked={selected}
                  onChange={() => toggle(item.id)}
                  aria-label={`选择第 ${item.lineNo} 行`}
                />
              ) : (
                <span className="tnum mt-[2px] w-4 shrink-0 text-center text-[11.5px] text-muted">
                  {item.lineNo}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[13px] font-medium text-ink">{item.productName}</span>
                  <span className="text-[12px] text-ink-2">{colorText(item.colorName)}</span>
                  {item.variantType === "custom" ? (
                    <span className="tag bg-warn-soft text-warn">定制·按件</span>
                  ) : null}
                  <span className="tnum text-[12.5px] font-semibold text-ink">
                    ×{item.qty} {item.unit}
                  </span>
                  {item.shipped ? (
                    <span className="tag bg-ok-soft text-ok">
                      已发
                      {item.shippedAt ? ` ${formatDateTime(item.shippedAt).slice(5, 16)}` : ""}
                      {item.shippedByName ? ` · ${item.shippedByName}` : ""}
                    </span>
                  ) : (
                    <span className="tag bg-warn-soft text-warn">待发</span>
                  )}
                </div>

                {/* 收货信息：整段显示，不截断——仓管照着这行字贴单 */}
                <div className="mt-1 whitespace-pre-line break-words text-[12px] leading-[1.6] text-ink-2">
                  {item.receiverInfo || (
                    <span className="text-danger">还没填收货地址，发不出去</span>
                  )}
                  {item.receiverInherited ? (
                    <span className="ml-1.5 text-[11px] text-muted">（沿用整单地址）</span>
                  ) : null}
                </div>

                <div className="tnum mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted">
                  {item.externalNo ? <span>订单 {item.externalNo}</span> : null}
                  {item.trackingNo ? <span>物流 {item.trackingNo}</span> : null}
                  {item.batchNo ? <span>批次 {item.batchNo}</span> : null}
                  {item.instanceCodes.length > 0 ? (
                    <span>件号 {item.instanceCodes.join("、")}</span>
                  ) : null}
                  {item.remark ? <span>备注 {item.remark}</span> : null}
                </div>
              </div>

              {editable && !item.shipped ? (
                <div className="flex shrink-0 items-start gap-0.5">
                  <button
                    type="button"
                    onClick={() => openEdit(item)}
                    className="rounded-md p-1.5 text-muted transition-colors hover:bg-sunken hover:text-brand-ink"
                    title="改这一行的收货信息"
                  >
                    <Pencil size={13} />
                  </button>
                  {doc.itemCount > 1 ? (
                    <button
                      type="button"
                      onClick={() => void removeItem(item)}
                      disabled={deleting === item.id}
                      className="rounded-md p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-40"
                      title="删掉这一行（只限还没发出去的）"
                    >
                      {deleting === item.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* 改某一行的收货信息 */}
      <Modal
        open={!!editItem}
        title={`第 ${editItem?.lineNo ?? ""} 行的收货信息`}
        description="只改这一行的收货信息与单号。商品和数量不在这里改——那会影响库存，只能删行重录。"
        onClose={() => (saving ? undefined : setEditItem(null))}
        width="max-w-[520px]"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setEditItem(null)}
              disabled={saving}
            >
              取消
            </button>
            <button type="button" className="btn-primary" onClick={() => void saveItem()} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              保存
            </button>
          </>
        }
      >
        <div className="space-y-3 pt-1">
          <div>
            <label className="label" htmlFor="itemReceiver">
              收货信息
            </label>
            <textarea
              id="itemReceiver"
              className="input min-h-[86px] resize-y leading-[1.7]"
              value={form.receiverInfo}
              maxLength={300}
              onChange={(e) => setForm((f) => ({ ...f, receiverInfo: e.target.value }))}
              placeholder={"张伟，13812345678\n浙江省杭州市余杭区仓前街道文一西路 969 号"}
            />
            <p className="mt-1 text-[11.5px] text-muted">
              留空 = 沿用单据上的整单地址。填了就以这一行为准，打印和箱贴都用它。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="label" htmlFor="itemExternal">
                淘宝订单号
              </label>
              <input
                id="itemExternal"
                className="input tnum"
                value={form.externalNo}
                maxLength={60}
                onChange={(e) => setForm((f) => ({ ...f, externalNo: e.target.value }))}
                placeholder="选填"
              />
            </div>
            <div>
              <label className="label" htmlFor="itemTracking">
                物流单号
              </label>
              <input
                id="itemTracking"
                className="input tnum"
                value={form.trackingNo}
                maxLength={60}
                onChange={(e) => setForm((f) => ({ ...f, trackingNo: e.target.value }))}
                placeholder="选填"
              />
            </div>
          </div>
        </div>
      </Modal>
    </section>
  );
}
