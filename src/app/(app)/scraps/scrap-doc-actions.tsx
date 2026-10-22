"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2 } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { VoidDocButton } from "@/components/void-doc-button";
import type { DocStatus } from "@/modules/scrap/scrap.types";

export function ScrapDocActions({
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
      await api(`/api/scraps/${id}/approve`, { method: "POST" });
      toast.success(`已生效，${totalQty} ${unit}已按各自方式处理`);
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
      await api(`/api/scraps/${id}`, { method: "DELETE" });
      toast.success("草稿已删除，勾选的件已释放");
      router.push("/scraps");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败");
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {status === "draft" ? (
          <>
            <button type="button" className="btn-primary btn-sm" onClick={approve} disabled={approving}>
              {approving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              审核生效
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
          </>
        ) : null}

        <VoidDocButton
          id={id}
          docNo={docNo}
          type="scrap"
          status={status}
          totalQty={totalQty}
          unit={unit}
        />
      </div>

      <Modal
        open={confirmOpen}
        title="删除这张草稿？"
        description={`「${docNo}」还没生效，库存没有变动过。删掉后勾选的定制件会重新变成可处理。`}
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
