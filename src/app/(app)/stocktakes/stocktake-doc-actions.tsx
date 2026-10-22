"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2 } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { DocStatus } from "@/modules/stocktake/stocktake.types";

export function StocktakeDocActions({
  id,
  docNo,
  status,
  diffLines,
}: {
  id: string;
  docNo: string;
  status: DocStatus;
  diffLines: number;
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
      await api(`/api/stocktakes/${id}/approve`, { method: "POST" });
      toast.success(diffLines > 0 ? `已生效，${diffLines} 行差异已调整到账上` : "已生效，账实相符");
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
      await api(`/api/stocktakes/${id}`, { method: "DELETE" });
      toast.success("草稿已删除，判为盘亏的件已放回可出库");
      router.push("/stocktakes");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败");
      setDeleting(false);
    }
  }

  if (status !== "draft") return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary btn-sm" onClick={approve} disabled={approving}>
          {approving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          审核并调账
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
        description={`「${docNo}」还没审核，库存没有任何变动。如果单子里把某些定制件判成了盘亏，删掉后这些件会重新变成可出库。`}
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
