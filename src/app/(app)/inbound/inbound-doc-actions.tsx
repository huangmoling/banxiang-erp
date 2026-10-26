"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2 } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { VoidDocButton } from "@/components/void-doc-button";
import type { DocStatus } from "@/modules/inbound/inbound.types";

/**
 * 入库单的顶栏动作。
 *
 * 删除权限收得很紧：**只有管理员能删入库单**（草稿也一样）。
 * 入库错一笔库存就失真了，所以仓管看到的是「找管理员删」而不是一个红按钮。
 * 已生效的单据，管理员既可以红冲（留痕更正），也可以彻底删除（当作没录过）：
 * 前者原单还在、反向流水并排留着；后者连单带流水一起清掉，适合「选错款、根本没这批货」。
 */
export function InboundDocActions({
  id,
  docNo,
  status,
  totalQty,
  unit,
  canDelete,
}: {
  id: string;
  docNo: string;
  status: DocStatus;
  totalQty: number;
  unit: string;
  /** 当前登录人是不是管理员（服务端判定后传进来，前端只负责显不显示按钮） */
  canDelete: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [approving, setApproving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function approve() {
    if (approving) return;
    setApproving(true);
    try {
      await api(`/api/inbound/${id}/approve`, { method: "POST" });
      toast.success(`已审核，${totalQty} ${unit} 已入账`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "审核失败，请重试");
    } finally {
      setApproving(false);
    }
  }

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await api<{ docNo: string; removedQty: number; status: string }>(
        `/api/inbound/${id}`,
        { method: "DELETE" },
      );
      toast.success(
        res.removedQty > 0
          ? `「${res.docNo}」已删除，${res.removedQty} ${unit} 已从库存退出`
          : `「${res.docNo}」已删除`,
      );
      router.push("/inbound");
      router.refresh();
    } catch (err) {
      // 删不动的原因很具体（货已发走 / 件被别的草稿占用），原样告诉人
      toast.error(err instanceof ApiError ? err.message : "删除失败");
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  const purgeModal = (
    <Modal
      open={confirmOpen}
      title={status === "draft" ? "删除这张草稿？" : `彻底删除「${docNo}」？`}
      description={
        status === "draft"
          ? `「${docNo}」还没审核，库存没有变动过，删掉不会留痕。`
          : `这张单已经生效，库存里有它的 ${totalQty} ${unit}。彻底删除会把单据、明细和它产生的库存流水一起清掉，等于这批货从来没入过库——不是红冲，事后查不到这张单。`
      }
      onClose={() => (deleting ? undefined : setConfirmOpen(false))}
      width="max-w-[480px]"
      footer={
        <>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setConfirmOpen(false)}
            disabled={deleting}
          >
            取消
          </button>
          <button type="button" className="btn-danger" onClick={remove} disabled={deleting}>
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {status === "draft" ? "确认删除" : "确认彻底删除"}
          </button>
        </>
      }
    >
      {status === "draft" ? null : (
        <div className="space-y-2 pt-1 text-[12.5px] leading-5">
          <div className="rounded-lg bg-danger-soft px-3 py-2.5 text-danger">
            库存会退回入库前：批次余量扣回、定制件编号一并删掉、「本月入库」也不再算这一笔。
            如果货已经发出去或转走了，系统会拦住不让删——先去处理下游单据。
          </div>
          <p className="text-muted">
            只是数量或颜色录错了、货其实真到了仓里？那就用<b className="text-ink-2">红冲</b>，
            别用彻底删除：红冲会留痕，两笔流水并排摆着，以后查账还看得见。
          </p>
        </div>
      )}
    </Modal>
  );

  // 已生效 / 已作废：红冲（留痕）＋ 管理员可彻底删除
  if (status !== "draft") {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <VoidDocButton
            id={id}
            docNo={docNo}
            type="inbound"
            status={status}
            totalQty={totalQty}
            unit={unit}
          />
          {canDelete ? (
            <button type="button" className="btn-danger btn-sm" onClick={() => setConfirmOpen(true)}>
              <Trash2 size={14} />
              彻底删除
            </button>
          ) : null}
        </div>
        {purgeModal}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary btn-sm" onClick={approve} disabled={approving}>
          {approving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          审核入库
        </button>
        {canDelete ? (
          <button
            type="button"
            className="btn-danger btn-sm"
            onClick={() => setConfirmOpen(true)}
            disabled={approving}
          >
            <Trash2 size={14} />
            删除草稿
          </button>
        ) : (
          <span className="text-[11.5px] text-muted">录错了？草稿只有管理员能删</span>
        )}
      </div>

      {purgeModal}
    </>
  );
}
