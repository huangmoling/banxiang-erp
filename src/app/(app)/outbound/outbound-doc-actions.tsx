"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Trash2 } from "lucide-react";
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
    | "pendingShip"
    | "receiverName"
    | "trackingNo"
    | "externalNo"
    | "remark"
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
      // 侧栏红角标立刻减一，不用等下一轮轮询
      window.dispatchEvent(new Event("suteng:pending-changed"));
      toast.success(
        doc.pendingShip
          ? `已确认发货，${doc.totalQty} ${unit} 扣了库存`
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

  // 已生效的单据不再能审核 / 删除，但可以红冲（把账按原路退回去）
  if (doc.status !== "draft") {
    return (
      <VoidDocButton
        id={doc.id}
        docNo={doc.docNo}
        type="outbound"
        status={doc.status as DocStatus}
        totalQty={doc.totalQty}
        unit={unit}
      />
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!isClerk ? (
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={approve}
            disabled={approving}
          >
            {approving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {doc.pendingShip ? "确认，已出货" : "审核出库"}
          </button>
        ) : null}

        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => setInfoOpen(true)}
          disabled={approving}
        >
          <Pencil size={13} />
          改收货信息
        </button>

        <button
          type="button"
          className="btn-danger btn-sm"
          onClick={() => setConfirmOpen(true)}
          disabled={approving}
        >
          <Trash2 size={14} />
          {doc.pendingShip ? "撤销工单" : "删除草稿"}
        </button>
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

      {/* 只改「不动货」的四项：明细和数量不在这里改，那些一动就影响库存 */}
      <Modal
        open={infoOpen}
        title="改收货信息"
        description="这里只能改收货信息、物流单号、订单号、备注。要改商品或数量，只能撤销后重新整理一张。"
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
