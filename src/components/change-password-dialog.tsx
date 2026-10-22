"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/**
 * 修改密码。
 * 改完不强制退出：这个工具是仓库里几个人共用的，正录着单被踢回登录页会骂人。
 * 但会在提示里说清楚——其它设备上的登录仍然有效，直到会话过期。
 */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
  }

  async function submit() {
    if (saving) return;
    setError(null);

    if (newPassword.length < 8) {
      setError("新密码至少 8 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    setSaving(true);
    try {
      await api("/api/auth/password", {
        method: "PATCH",
        json: { currentPassword, newPassword, confirmPassword },
      });
      toast.success("密码已更新，下次登录请用新密码");
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "修改失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="修改密码"
      description="改完之后当前登录不受影响，其它设备上的登录会在会话到期后失效。"
      onClose={() => {
        if (saving) return;
        reset();
        onClose();
      }}
      footer={
        <>
          <button
            type="button"
            className="btn-ghost"
            disabled={saving}
            onClick={() => {
              reset();
              onClose();
            }}
          >
            取消
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
            {saving ? "保存中…" : "保存"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="current-password">
            当前密码
          </label>
          <input
            id="current-password"
            type="password"
            className="input"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="new-password">
            新密码
          </label>
          <input
            id="new-password"
            type="password"
            className="input"
            autoComplete="new-password"
            placeholder="至少 8 位"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="confirm-password">
            再输一次新密码
          </label>
          <input
            id="confirm-password"
            type="password"
            className="input"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        {error ? (
          <p className="flex items-center gap-1.5 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
            <KeyRound size={13} strokeWidth={1.8} />
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
