"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2 } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { VoidDocButton } from "@/components/void-doc-button";
import type { DocStatus } from "@/modules/returns/return.types";

export function ReturnDocActions({
  id,
  docNo,
  status,
  totalQty,
  unit,
}: {
  id: string;
  docNo: string;
  status: DocStatus;
  totalQty: number;
  unit: string;
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
      await api(`/api/returns/${id}/approve`, { method: "POST" });
      toast.success(`已审核，${totalQty} ${unit} 已入库`);
      router.refresh();
    } catch (err) {
      // 超退是最常见的失败，直接把后端那句「原单发了多少、已退多少」显示出来
      toast.error(err instanceof ApiError ? err.message : "审核失败，请重试");
    } finally {
      setApproving(false);
    }
  }

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    try {
      await api(`/api/returns/${id}`, { method: "DELETE" });
      toast.success("草稿已删除，占用的单件已释放");
      router.push("/returns");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败");
      setDeleting(false);
    }
  }

  // 已生效的单据不再能审核 / 删除，但可以红冲（把账按原路退回去）
  if (status !== "draft") {
    return (
      <VoidDocButton
        id={id}
        docNo={docNo}
        type="return"
        status={status}
        totalQty={totalQty}
        unit={unit}
      />
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary btn-sm" onClick={approve} disabled={approving}>
          {approving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          审核入库
        </button>
        <button
          type="button"
          className="btn-danger btn-sm"
          onClick={() => setConfirmOpen(true)}
          disabled={approving}
        >
          <Trash2 size={14} />
          删除草稿
        </button>
      </div>

      <Modal
        open={confirmOpen}
        title="删除这张草稿？"
        description={`「${docNo}」还没审核，库存没有变动过。如果里面勾了定制件，删掉后这些件会重新变成可退。`}
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setConfirmOpen(false)}>
              取消
            </button>
            <button type="button" className="btn-danger" onClick={remove} disabled={deleting}>
              {deleting ? <Loader2 size={14} className="animate-spin" /> : null}
              确认删除
            </button>
          </>
        }
      />
    </>
  );
}
