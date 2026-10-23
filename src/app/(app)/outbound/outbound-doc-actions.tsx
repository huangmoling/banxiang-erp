"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Printer, Trash2 } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { VoidDocButton } from "@/components/void-doc-button";
import type { DocStatus, OutboundDocView } from "@/modules/outbound/outbound.types";

/**
 * 出库单底部操作区。
 * 待发货工单多出一个「确认，已出货」——对仓管来说这是他一天里唯一的动作；
 * 内勤只能改收货信息、撤销自己整理的单，看不到确认按钮（后端也会拦）。
 */
export function OutboundDocActions({
  doc,
  role,
}: {
  doc: Pick<
    OutboundDocView,
    | "id"
    | "docNo"
    | "status"
    | "totalQty"
    | "items"
    | "itemCount"
    | "pendingShip"
    | "receiverName"
    | "trackingNo"
    | "externalNo"
    | "remark"
    | "pendingCount"
    | "shippedCount"
    | "hasShipped"
  >;
  role: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const isClerk = role === "clerk";
  const unit = doc.items[0]?.unit ?? "件";

  const [approving, setApproving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [infoOpen, setInfoOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    receiverName: doc.receiverName ?? "",
    trackingNo: doc.trackingNo ?? "",
    externalNo: doc.externalNo ?? "",
    remark: doc.remark ?? "",
  });

  async function approve() {
    if (approving) return;
    setApproving(true);
    try {
      await api(`/api/outbound/${doc.id}/approve`, { method: "POST" });
      // 侧栏红角标立刻跟着减，不用等下一轮轮询
      window.dispatchEvent(new Event("suteng:pending-changed"));
      toast.success(
        doc.pendingShip
          ? `已确认发货：${doc.pendingCount} 个包裹扣了库存`
          : `已审核，${doc.totalQty} ${unit} 已出库`,
      );
      router.refresh();
    } catch (err) {
      // 库存不够是最常见的失败，直接把后端那句「哪一行差多少」显示出来
      toast.error(err instanceof ApiError ? err.message : "确认失败，请重试");
    } finally {
      setApproving(false);
    }
  }

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    try {
      await api(`/api/outbound/${doc.id}`, { method: "DELETE" });
      toast.success(doc.pendingShip ? "工单已撤销" : "草稿已删除，占用的单件已释放");
      router.push("/outbound");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败");
      setDeleting(false);
    }
  }

  async function saveInfo() {
    if (saving) return;
    setSaving(true);
    try {
      await api(`/api/outbound/${doc.id}`, {
        method: "PATCH",
        json: {
          receiverName: form.receiverName.trim() || null,
          trackingNo: form.trackingNo.trim() || null,
          externalNo: form.externalNo.trim() || null,
          remark: form.remark.trim() || null,
        },
      });
      toast.success("已改好");
      setInfoOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  // 已生效的单据不再能审核 / 删除，但可以打印、可以红冲（把账按原路退回去）
  if (doc.status !== "draft") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/print/outbound/${doc.id}?mode=pick`} className="btn-ghost btn-sm">
          <Printer size={13} />
          打印出货单
        </Link>
        <VoidDocButton
          id={doc.id}
          docNo={doc.docNo}
          type="outbound"
          status={doc.status as DocStatus}
          totalQty={doc.totalQty}
          unit={unit}
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {/* 打印是最常用的动作：仓管拿着纸单去货架找货，比盯屏幕快 */}
        <Link href={`/print/outbound/${doc.id}?mode=pick`} className="btn-ghost btn-sm">
          <Printer size={13} />
          打印出货单
        </Link>

        {!isClerk && doc.pendingCount > 0 ? (
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={approve}
            disabled={approving}
            title="把还没发的行一次全发掉；只想发一部分，在下面明细里勾选后点「确认发出」"
          >
            {approving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {doc.pendingCount === doc.itemCount
              ? "审核出库"
              : `全部确认发出（${doc.pendingCount}）`}
          </button>
        ) : null}

        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => setInfoOpen(true)}
          disabled={approving}
        >
          <Pencil size={13} />
          {doc.receiverName ? "改整单地址" : "设整单地址"}
        </button>

        {/* 有行发出去过就不许整单删：删了流水会跟着消失，货却已经走了 */}
        {!doc.hasShipped ? (
          <button
            type="button"
            className="btn-danger btn-sm"
            onClick={() => setConfirmOpen(true)}
            disabled={approving}
          >
            <Trash2 size={14} />
            {doc.pendingShip ? "撤销工单" : "删除草稿"}
          </button>
        ) : null}
      </div>

      <Modal
        open={confirmOpen}
        title={doc.pendingShip ? "撤销这张发货工单？" : "删除这张草稿？"}
        description={
          doc.pendingShip
            ? `「${doc.docNo}」还没发货，撤销后仓库那边就看不到它了，库存本来也没动过。要改明细可以撤销后重新整理一张。`
            : `「${doc.docNo}」还没审核，库存没有变动过。如果里面勾了定制件，删掉后这些件会重新变成可出。`
        }
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setConfirmOpen(false)}>
              取消
            </button>
            <button type="button" className="btn-danger" onClick={remove} disabled={deleting}>
              {deleting ? <Loader2 size={14} className="animate-spin" /> : null}
              {doc.pendingShip ? "确认撤销" : "确认删除"}
            </button>
          </>
        }
      />

      {/* 单据级只留「整单通用地址」：真正的收货地址在每一行上 */}
      <Modal
        open={infoOpen}
        title="整单通用地址"
        description="填了这里，商品行上没填地址的就沿用它。一单只发一个买家时才需要；多买家就在各自的行上填。商品和数量不在这里改。"
        onClose={() => (saving ? undefined : setInfoOpen(false))}
        width="max-w-[520px]"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setInfoOpen(false)}
              disabled={saving}
            >
              取消
            </button>
            <button type="button" className="btn-primary" onClick={saveInfo} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              保存
            </button>
          </>
        }
      >
        <div className="space-y-3 pt-1">
          <div>
            <label className="label" htmlFor="editReceiver">
              收货信息
              <span className="ml-1 font-normal text-muted">（姓名、电话、地址）</span>
            </label>
            <textarea
              id="editReceiver"
              className="input min-h-[78px] resize-y leading-[1.7]"
              value={form.receiverName}
              onChange={(e) => setForm({ ...form, receiverName: e.target.value })}
              maxLength={300}
              placeholder="整段粘进来即可"
            />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="label" htmlFor="editExternal">
                淘宝订单号
              </label>
              <input
                id="editExternal"
                className="input tnum"
                value={form.externalNo}
                onChange={(e) => setForm({ ...form, externalNo: e.target.value })}
                maxLength={60}
                placeholder="选填"
              />
            </div>
            <div>
              <label className="label" htmlFor="editTracking">
                物流单号
              </label>
              <input
                id="editTracking"
                className="input tnum"
                value={form.trackingNo}
                onChange={(e) => setForm({ ...form, trackingNo: e.target.value })}
                maxLength={60}
                placeholder="选填"
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="editRemark">
              备注
            </label>
            <textarea
              id="editRemark"
              className="input min-h-[60px] resize-y"
              value={form.remark}
              onChange={(e) => setForm({ ...form, remark: e.target.value })}
              maxLength={500}
              placeholder="选填"
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
