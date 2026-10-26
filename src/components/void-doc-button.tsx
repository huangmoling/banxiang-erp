"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Undo2 } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/**
 * 红冲入口。四种单据共用：入库 / 出库 / 退货 / 报废处置。
 *
 * 只有「已生效」的单据才显示。草稿本来就没动过库存，删掉就行；
 * 盘点单由服务端拒绝红冲（盘点本身就是修正单）。
 */
export function VoidDocButton({
  id,
  docNo,
  type,
  status,
  totalQty,
  unit,
}: {
  id: string;
  docNo: string;
  type: "inbound" | "outbound" | "return" | "scrap";
  status: string;
  totalQty: number;
  unit: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (status !== "approved") return null;

  const consequence = CONSEQUENCE[type];

  async function submit() {
    if (submitting) return;
    if (reason.trim().length < 2) {
      toast.error("请写一句红冲原因（至少 2 个字）");
      return;
    }
    setSubmitting(true);
    try {
      await api(`/api/documents/${id}/void`, { method: "POST", json: { reason: reason.trim() } });
      toast.success(`「${docNo}」已红冲，账已按原路退回`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      // 冲不动的原因很具体（货已经发走 / 挂着退货单 / 件已被处置），原样显示
      toast.error(err instanceof ApiError ? err.message : "红冲失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>
        <Undo2 size={14} />
        红冲
      </button>

      <Modal
        open={open}
        title={`红冲「${docNo}」？`}
        description={`这会把已经生效的 ${totalQty} ${unit} 按原路退回去。原始流水一条都不删，只是补上一套反向流水，事后查账时两笔并排可见。`}
        onClose={() => (submitting ? undefined : setOpen(false))}
        width="max-w-[480px]"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              取消
            </button>
            <button type="button" className="btn-danger" onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
              确认红冲
            </button>
          </>
        }
      >
        <div className="space-y-3 pt-1">
          <div className="rounded-lg bg-warn-soft px-3 py-2.5 text-[12.5px] leading-5 text-warn">
            {consequence}
          </div>
          <div>
            <label className="label" htmlFor="void-reason">
              红冲原因 <span className="text-danger">*</span>
            </label>
            <textarea
              id="void-reason"
              className="input min-h-[72px] resize-y"
              placeholder="例：单号填错了，这批货实际发的是另一单"
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
            <p className="mt-1 text-[12px] text-muted">
              这句会记在单据和操作记录里，别人翻账时能看到。
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}

const CONSEQUENCE: Record<"inbound" | "outbound" | "return" | "scrap", string> = {
  inbound: "这批货会从库存里退回去。如果货已经发出去了，会冲不动——得先把出库单冲掉。",
  outbound: "这批货会退回仓库，批次余量和定制件编号都回到原处，等于这单没发过。",
  return: "退回来的货会重新变成「已出库」，原出库单的「已退数量」也会减回去。",
  scrap: "这批货会回到处置前的仓位：转报废的从报废区退出来，线下出售 / 自行处理的重新回到账上。",
};
