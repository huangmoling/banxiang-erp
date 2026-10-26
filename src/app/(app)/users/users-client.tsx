"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, ShieldCheck, UserRound } from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/ui/page-header";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { UserListResult, UserRole, UserRow } from "@/modules/user/user.types";
import { USER_ROLES, USER_ROLE_HINT, USER_ROLE_LABEL, USER_ROLE_TONE } from "@/modules/user/user.types";

const EMPTY_FORM = { username: "", displayName: "", role: "keeper" as UserRole, password: "" };

export function UsersClient({ currentUserId }: { currentUserId: string }) {
  const toast = useToast();
  const [data, setData] = useState<UserListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<UserListResult>("/api/users");
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>, okText: string) {
    try {
      await api(`/api/users/${id}`, { method: "PATCH", json: body });
      toast.success(okText);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "修改失败");
    }
  }

  async function createUser() {
    if (saving) return;
    setSaving(true);
    try {
      await api("/api/users", { method: "POST", json: form });
      toast.success(`账号「${form.displayName}」已创建`);
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  async function submitReset() {
    if (!resetTarget || saving) return;
    setSaving(true);
    try {
      await api(`/api/users/${resetTarget.id}/password`, {
        method: "POST",
        json: { newPassword },
      });
      toast.success(`已重置「${resetTarget.displayName}」的密码，对方需要重新登录`);
      setResetTarget(null);
      setNewPassword("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "重置失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="账号"
        description="5–10 个人的小团队，按角色分工就够用。停用比删除安全——单据上的经手人名字要留着。"
        actions={
          <button type="button" className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
            <Plus size={14} strokeWidth={2} />
            新增账号
          </button>
        }
      />

      {error ? (
        <div className="card border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</div>
      ) : null}

      <div className="card overflow-hidden">
        <div className={`overflow-x-auto ${loading ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                <th className="th">姓名</th>
                <th className="th">登录名</th>
                <th className="th">角色</th>
                <th className="th">状态</th>
                <th className="th">最后登录</th>
                <th className="th text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {!data || data.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="td py-10 text-center text-[12.5px] text-muted">
                    {loading ? "加载中…" : "还没有账号"}
                  </td>
                </tr>
              ) : (
                data.items.map((u) => {
                  const isSelf = u.id === currentUserId;
                  return (
                    <tr key={u.id} className="hover:bg-sunken">
                      <td className="td">
                        <span className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand-ink">
                            {u.displayName.slice(0, 1)}
                          </span>
                          <span className="font-medium">{u.displayName}</span>
                          {isSelf ? (
                            <span className="tag bg-sunken text-muted">是本人</span>
                          ) : null}
                        </span>
                      </td>
                      <td className="td text-ink-2">{u.username}</td>
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <span className={`tag ${USER_ROLE_TONE[u.role]}`}>{USER_ROLE_LABEL[u.role]}</span>
                          <select
                            className="rounded-md border border-line bg-card px-1.5 py-1 text-[12px] text-ink-2 outline-none focus:border-brand"
                            value={u.role}
                            disabled={isSelf}
                            title={isSelf ? "不能改自己的角色" : USER_ROLE_HINT[u.role]}
                            onChange={(e) =>
                              patch(u.id, { role: e.target.value }, `「${u.displayName}」的角色已更新`)
                            }
                          >
                            {USER_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {USER_ROLE_LABEL[r]}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="td">
                        {u.isActive ? (
                          <span className="tag bg-ok-soft text-ok">启用</span>
                        ) : (
                          <span className="tag bg-sunken text-muted">已停用</span>
                        )}
                      </td>
                      <td className="td text-[12.5px] text-muted">{u.lastLoginAt ?? "从未登录"}</td>
                      <td className="td text-right">
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={isSelf}
                            title={isSelf ? "改自己的密码请用右下角的「修改密码」" : "重置密码"}
                            onClick={() => {
                              setResetTarget(u);
                              setNewPassword("");
                            }}
                          >
                            <KeyRound size={13} strokeWidth={1.8} />
                            重置密码
                          </button>
                          <button
                            type="button"
                            className={u.isActive ? "btn-danger btn-sm" : "btn-ghost btn-sm"}
                            disabled={isSelf}
                            title={isSelf ? "不能停用自己" : undefined}
                            onClick={() =>
                              patch(
                                u.id,
                                { isActive: !u.isActive },
                                u.isActive
                                  ? `已停用「${u.displayName}」，对方的登录已失效`
                                  : `已启用「${u.displayName}」`,
                              )
                            }
                          >
                            {u.isActive ? "停用" : "启用"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card bg-sunken p-4">
        <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
          <ShieldCheck size={14} strokeWidth={1.8} className="text-brand-ink" />
          四个角色各自能做什么
        </h2>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {USER_ROLES.map((r) => (
            <li key={r} className="flex gap-2 text-[12.5px] leading-6 text-ink-2">
              <span className={`tag shrink-0 ${USER_ROLE_TONE[r]}`}>{USER_ROLE_LABEL[r]}</span>
              <span className="text-muted">{USER_ROLE_HINT[r]}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 新增账号 */}
      <Modal
        open={createOpen}
        title="新增账号"
        description="初始密码交给他之后，让他自己用右下角的「修改密码」换掉。"
        onClose={() => {
          if (saving) return;
          setCreateOpen(false);
          setForm(EMPTY_FORM);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              disabled={saving}
              onClick={() => {
                setCreateOpen(false);
                setForm(EMPTY_FORM);
              }}
            >
              取消
            </button>
            <button type="button" className="btn-primary" disabled={saving} onClick={createUser}>
              {saving ? "创建中…" : "创建"}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="new-username">
                登录名
              </label>
              <input
                id="new-username"
                className="input"
                placeholder="如 wanggang"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="new-display-name">
                姓名
              </label>
              <input
                id="new-display-name"
                className="input"
                placeholder="如 王刚"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="new-role">
              角色
            </label>
            <select
              id="new-role"
              className="input"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
            >
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {USER_ROLE_LABEL[r]} · {USER_ROLE_HINT[r]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="new-password">
              初始密码
            </label>
            <input
              id="new-password"
              className="input"
              type="text"
              placeholder="至少 8 位，建议让他自己改掉"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
        </div>
      </Modal>

      {/* 重置密码 */}
      <Modal
        open={!!resetTarget}
        title={`重置「${resetTarget?.displayName ?? ""}」的密码`}
        description="重置后对方的所有登录会立即失效，需要用新密码重新登录。"
        onClose={() => {
          if (saving) return;
          setResetTarget(null);
          setNewPassword("");
        }}
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              disabled={saving}
              onClick={() => {
                setResetTarget(null);
                setNewPassword("");
              }}
            >
              取消
            </button>
            <button type="button" className="btn-primary" disabled={saving} onClick={submitReset}>
              {saving ? "保存中…" : "重置"}
            </button>
          </>
        }
      >
        <div>
          <label className="label" htmlFor="reset-password">
            新密码
          </label>
          <input
            id="reset-password"
            className="input"
            type="text"
            placeholder="至少 8 位"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <p className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-5 text-muted">
            <UserRound size={12} className="mt-1 shrink-0" />
            建议当面告诉他密码，并让他登录后自己改掉。
          </p>
        </div>
      </Modal>
    </div>
  );
}
