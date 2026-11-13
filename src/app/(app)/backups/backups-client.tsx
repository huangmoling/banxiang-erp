"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  Cloud,
  CloudCheck,
  CloudUpload,
  Database,
  Download,
  HardDriveDownload,
  History,
  Loader2,
  Lock,
  Plug,
  RefreshCw,
  Save,
  ShieldCheck,
  Timer,
  Trash2,
  Upload,
} from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { PageHeader } from "@/components/ui/page-header";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { CRON_PRESETS, describeCron, isValidCron, nextCronRun } from "@/lib/cron";
import {
  BACKUP_KEEP_MAX,
  BACKUP_KEEP_MIN,
  BACKUP_KIND_LABEL,
  BACKUP_KIND_TONE,
  REMOTE_PROVIDER_LABEL,
  REMOTE_PROVIDER_META,
  formatBytes,
  type BackupCreateResult,
  type BackupFile,
  type BackupListResult,
  type BackupRestoreResult,
  type BackupUploadResult,
  type RemoteProvider,
  type RemoteTestResult,
} from "@/modules/backup/backup.types";

/**
 * 备份页。
 *
 * 排版顺序就是出事时的动手顺序：
 * 先看「定时开没开、上次跑成没成」→ 再看「备份有没有传到云上」
 * → 再看「有哪些备份、能不能下载走」→ 最后才是「真的要用某一份盖回去」。
 * 恢复放在最下面、配色最重，是因为它是唯一一个会让数据「变少」的动作。
 */
export function BackupsClient() {
  const toast = useToast();

  const [data, setData] = useState<BackupListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"manual" | "settings" | "restore" | null>(null);

  // 设置表单（和服务端的值分开存，才能做「改了没保存」的提示）
  const [enabled, setEnabled] = useState(true);
  const [cron, setCron] = useState("0 3 * * *");
  const [keepCount, setKeepCount] = useState(7);

  // 云端备份（OpenList / 坚果云）
  const [provider, setProvider] = useState<RemoteProvider>("openlist");
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteUser, setRemoteUser] = useState("");
  /** 留空 = 不改已保存的密码（服务端从不回传明文） */
  const [remotePass, setRemotePass] = useState("");
  const [remoteToken, setRemoteToken] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<RemoteTestResult | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const [toDelete, setToDelete] = useState<BackupFile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreWord, setRestoreWord] = useState("");
  const [restoreResult, setRestoreResult] = useState<BackupRestoreResult | null>(null);
  /** 从服务器上已有的备份直接恢复；有值时弹的是「恢复这一份」确认框 */
  const [restoreLocal, setRestoreLocal] = useState<BackupFile | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 「下次运行」要在客户端算：服务端渲染一遍、客户端再算一遍会差几秒，直接算会 hydration 不一致
  const [nowTick, setNowTick] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<BackupListResult>("/api/backups");
      setData(res);
      setEnabled(res.settings.enabled);
      setCron(res.settings.cron);
      setKeepCount(res.settings.keepCount);
      setProvider(res.settings.remote.provider);
      setRemoteEnabled(res.settings.remote.enabled);
      setRemoteUrl(res.settings.remote.url);
      setRemoteUser(res.settings.remote.username);
      setRemotePath(res.settings.remote.remotePath);
      setRemotePass("");
      setRemoteToken("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "加载失败，请重试");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setNowTick(new Date());
    const t = setInterval(() => setNowTick(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const cronOk = isValidCron(cron);
  const cronText = useMemo(() => (cronOk ? describeCron(cron) : ""), [cron, cronOk]);
  const nextRun = useMemo(() => (cronOk && nowTick ? nextCronRun(cron, nowTick) : null), [cron, cronOk, nowTick]);

  const dirty =
    !!data &&
    (data.settings.enabled !== enabled ||
      data.settings.cron !== cron ||
      data.settings.keepCount !== keepCount ||
      data.settings.remote.enabled !== remoteEnabled ||
      data.settings.remote.provider !== provider ||
      data.settings.remote.url !== remoteUrl.trim().replace(/\/+$/, "") ||
      data.settings.remote.username !== remoteUser.trim() ||
      data.settings.remote.remotePath !== remotePath.trim() ||
      remotePass.length > 0 ||
      remoteToken.length > 0);

  async function saveSettings() {
    if (busy) return;
    if (!cronOk) {
      toast.error("cron 表达式看不懂，先按提示改对再保存");
      return;
    }
    setBusy("settings");
    try {
      await api("/api/backups/settings", {
        method: "PATCH",
        json: {
          enabled,
          cron: cron.trim(),
          keepCount,
          remote: {
            enabled: remoteEnabled,
            provider,
            url: remoteUrl.trim(),
            username: remoteUser.trim(),
            remotePath: remotePath.trim(),
            ...(remotePass ? { password: remotePass } : {}),
            ...(remoteToken ? { token: remoteToken } : {}),
          },
        },
      });
      toast.success("设置已保存，调度器下一分钟就按新设置判断要不要跑");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api<RemoteTestResult>("/api/backups/remote/test", {
        method: "POST",
        json: {
          provider,
          url: remoteUrl.trim(),
          username: remoteUser.trim(),
          remotePath: remotePath.trim(),
          ...(remotePass ? { password: remotePass } : {}),
          ...(remoteToken ? { token: remoteToken } : {}),
        },
      });
      setTestResult(res);
      if (res.ok) toast.success("云端连接正常");
      else toast.error(res.message || "连接失败");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "测试失败");
    } finally {
      setTesting(false);
    }
  }

  /** 切换云端类型：地址是固定的就直接填好，省得用户去查 */
  function changeProvider(next: RemoteProvider) {
    setProvider(next);
    setTestResult(null);
    if (next === "jianguoyun" && !remoteUrl.trim()) {
      setRemoteUrl("https://dav.jianguoyun.com/dav");
    }
  }

  async function createManual() {
    if (busy) return;
    setBusy("manual");
    try {
      const res = await api<BackupCreateResult>("/api/backups", { method: "POST" });
      toast.success(`已备份：${res.file.name}（${formatBytes(res.file.sizeBytes)}）`);
      if (res.upload && !res.upload.ok) {
        toast.error(`本地已备份，但传到云端失败：${res.upload.error ?? "未知原因"}`);
      } else if (res.upload?.ok) {
        toast.success("已同步上传到云端");
      }
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "备份失败");
    } finally {
      setBusy(null);
    }
  }

  async function uploadThis(name: string) {
    if (uploading) return;
    setUploading(name);
    try {
      const res = await api<BackupUploadResult>(`/api/backups/${name}/upload`, { method: "POST" });
      toast.success(`已上传到 ${res.remotePath ?? "云端"}`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "上传失败");
    } finally {
      setUploading(null);
    }
  }

  async function remove() {
    if (!toDelete || deleting) return;
    setDeleting(true);
    try {
      await api(`/api/backups/${toDelete.name}`, { method: "DELETE" });
      toast.success(`已删除 ${toDelete.name}`);
      setToDelete(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  function pickFile(f: File | null) {
    if (!f) return;
    const lower = f.name.toLowerCase();
    if (!lower.endsWith(".tar") && !lower.endsWith(".db")) {
      toast.error("只支持本系统备份出来的 .tar（含图片）或老的 .db 文件");
      return;
    }
    setRestoreFile(f);
    setRestoreWord("");
    setRestoreOpen(true);
  }

  async function doRestore() {
    if (!restoreFile || busy) return;
    if (restoreWord.trim() !== "恢复") {
      toast.error("请照着输入「恢复」两个字");
      return;
    }

    setBusy("restore");
    try {
      // 原始流上传：带图片的包可能上百 MB，走 FormData 会整个读进内存
      const res = await api<BackupRestoreResult>("/api/backups/restore", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-backup-name": encodeURIComponent(restoreFile.name),
        },
        body: restoreFile,
      });
      setRestoreOpen(false);
      setRestoreResult(res);
      setRestoreFile(null);
      if (fileRef.current) fileRef.current.value = "";
      toast.success("数据已恢复");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "恢复失败");
    } finally {
      setBusy(null);
    }
  }

  /** 直接拿服务器上这份备份覆盖回来（不用下载再上传） */
  async function doRestoreLocal() {
    if (!restoreLocal || busy) return;
    if (restoreWord.trim() !== "恢复") {
      toast.error("请照着输入「恢复」两个字");
      return;
    }

    setBusy("restore");
    try {
      const res = await api<BackupRestoreResult>(`/api/backups/${restoreLocal.name}/restore`, {
        method: "POST",
      });
      setRestoreLocal(null);
      setRestoreResult(res);
      toast.success("数据已恢复");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "恢复失败");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-muted">
        <Loader2 size={16} className="animate-spin" />
        读取备份目录…
      </div>
    );
  }

  const uploadedCount = data?.items.filter((f) => f.uploadedAt).length ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="数据备份"
        description="备份把整个库和全部商品图片打进一个包。服务器坏了、升级出问题、数据被误删，都能用这里的一份文件把账和图片原样装回去。开启云端上传后，还会再往网盘存一份——NAS 整台报废也还有救。"
        actions={
          <div className="flex gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            刷新
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => void createManual()}
            disabled={busy !== null}
          >
            {busy === "manual" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            立即备份
          </button>
          </div>
        }
      />

      {data?.settings.lastAutoError ? (
        <div className="flex items-start gap-2 rounded-card border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[12.5px] leading-5 text-danger">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div>
            上一次定时备份失败了：{data.settings.lastAutoError}
            <div className="mt-0.5 text-[11.5px]">
              多半是磁盘满了或备份目录没有写权限。在处理之前，建议先点「立即备份」手动补一份。
            </div>
          </div>
        </div>
      ) : null}

      {data?.settings.remote.enabled && data.settings.lastUploadError ? (
        <div className="flex items-start gap-2 rounded-card border border-warn/40 bg-warn-soft px-3.5 py-2.5 text-[12.5px] leading-5 text-warn">
          <Cloud size={15} className="mt-0.5 shrink-0" />
          <div>
            最近一次上传云端失败：{data.settings.lastUploadError}
            <div className="mt-0.5 text-[11.5px]">
              本地备份是好的，只是云上那份没更新。网络恢复后在列表里点云朵图标重传即可。
            </div>
          </div>
        </div>
      ) : null}

      {/* 概览 */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat icon={Database} label="备份总数" value={String(data?.items.length ?? 0)} unit="份" />
        <Stat icon={Clock} label="定时备份" value={String(data?.autoCount ?? 0)} unit="份" />
        <Stat icon={Lock} label="手动 / 恢复前" value={String(data?.manualCount ?? 0)} unit="份" />
        <Stat
          icon={CloudCheck}
          label="已上传云盘"
          value={data?.settings.remote.enabled ? String(uploadedCount) : "—"}
          unit={data?.settings.remote.enabled ? "份" : undefined}
        />
      </div>

      {/* 定时设置 */}
      <section className="card p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[13.5px] font-semibold text-ink">定时备份</h2>
            <p className="mt-0.5 text-[11.5px] text-muted">
              用 cron 表达式定时间；份数满了就从最旧的那一份开始覆盖（手动备份不占名额）。
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-line text-brand-ink focus:ring-brand"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {enabled ? "已开启" : "已关闭"}
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_150px_auto] sm:items-end">
          <div>
            <label className="label" htmlFor="cron">
              cron 表达式
            </label>
            <input
              id="cron"
              className="input tnum"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 3 * * *"
              spellCheck={false}
              disabled={!enabled}
            />
            <div className="mt-1 text-[11px] leading-4 text-muted">
              5 段：分 时 日 月 周。例 <code className="tnum">0 3 * * *</code> 每天 3 点、
              <code className="tnum">0 */6 * * *</code> 每 6 小时、
              <code className="tnum">0 3 * * 1</code> 每周一 3 点。
            </div>
          </div>

          <div>
            <label className="label" htmlFor="keepCount">
              保留份数
            </label>
            <input
              id="keepCount"
              type="number"
              min={BACKUP_KEEP_MIN}
              max={BACKUP_KEEP_MAX}
              className="input tnum"
              value={Number.isFinite(keepCount) ? keepCount : ""}
              onChange={(e) => setKeepCount(Number(e.target.value))}
              disabled={!enabled}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => void saveSettings()}
              disabled={busy !== null || !dirty || !cronOk}
            >
              {busy === "settings" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              保存设置
            </button>
            {dirty ? <span className="text-[11.5px] text-warn">有改动还没保存</span> : null}
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {CRON_PRESETS.map((p) => (
            <button
              key={p.expr}
              type="button"
              onClick={() => setCron(p.expr)}
              disabled={!enabled}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                cron.trim() === p.expr
                  ? "border-brand bg-brand-soft text-brand-ink"
                  : "border-line text-ink-2 hover:border-brand hover:text-brand-ink"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line-2 pt-3 text-[11.5px] text-muted">
          <span className="flex items-center gap-1">
            <Timer size={12} />
            {cronOk ? (
              <>
                规则：<b className="font-medium text-ink-2">{cronText}</b>
              </>
            ) : (
              <span className="text-danger">表达式看不懂，这条规则不会触发</span>
            )}
          </span>
          <span className="flex items-center gap-1">
            <Clock size={12} />
            下次运行：
            <b className="tnum font-medium text-ink-2">
              {cronOk
                ? nextRun
                  ? fmt(nextRun.toISOString())
                  : "两年内不会触发，检查表达式"
                : "—"}
            </b>
          </span>
          <span className="flex items-center gap-1">
            <ShieldCheck size={12} className="text-ok" />
            上次定时备份：
            <b className="tnum font-medium text-ink-2">
              {data?.settings.lastAutoAt ? fmt(data.settings.lastAutoAt) : "还没跑过"}
            </b>
          </span>
        </div>

        {!enabled ? (
          <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-warn-soft px-3 py-2 text-[11.5px] leading-5 text-warn">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            定时备份关着，只有手动点「立即备份」才会留一份。数据没了就是真没了，建议开着。
          </div>
        ) : null}
      </section>

      {/* 云端 */}
      <section className="card p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
              <Cloud size={14} strokeWidth={1.9} className="text-brand-ink" />
              云端备份
            </h2>
            <p className="mt-0.5 text-[11.5px] text-muted">
              每次备份完成后，自动把整个包（库 + 商品图片）传到云端。服务器整台坏掉时，云端这份就是最后的家底。
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-line text-brand-ink focus:ring-brand"
              checked={remoteEnabled}
              onChange={(e) => setRemoteEnabled(e.target.checked)}
            />
            {remoteEnabled ? "已开启" : "已关闭"}
          </label>
        </div>

        <div className="mb-3">
          <span className="label">存到哪儿</span>
          <div className="flex flex-wrap gap-2">
            {(["openlist", "jianguoyun"] as RemoteProvider[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => changeProvider(p)}
                disabled={!remoteEnabled}
                className={`rounded-field border px-3 py-1.5 text-[12.5px] transition-colors disabled:opacity-60 ${
                  provider === p
                    ? "border-brand bg-brand-soft font-medium text-brand-ink"
                    : "border-line text-ink-2 hover:border-brand hover:text-brand-ink"
                }`}
              >
                {REMOTE_PROVIDER_LABEL[p]}
              </button>
            ))}
          </div>
          <div className="mt-1 text-[11px] leading-4 text-muted">
            {provider === "jianguoyun"
              ? "坚果云：网页版「设置 → 安全选项 → 添加应用密码」，密码填那一串；账号填注册邮箱。"
              : "OpenList：家里自建的那台，底下挂 R2 / 本地盘都行。"}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="remoteUrl">
              {provider === "jianguoyun" ? "WebDAV 地址" : "OpenList 地址"}
            </label>
            <input
              id="remoteUrl"
              className="input tnum"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder={REMOTE_PROVIDER_META[provider].urlPlaceholder}
              spellCheck={false}
              disabled={!remoteEnabled}
            />
            <div className="mt-1 text-[11px] text-muted">{REMOTE_PROVIDER_META[provider].urlHint}</div>
          </div>

          <div>
            <label className="label" htmlFor="remotePath">
              备份目录
            </label>
            <input
              id="remotePath"
              className="input tnum"
              value={remotePath}
              onChange={(e) => setRemotePath(e.target.value)}
              placeholder={provider === "jianguoyun" ? "/suteng" : "/r2/suteng"}
              spellCheck={false}
              disabled={!remoteEnabled}
            />
            <div className="mt-1 text-[11px] text-muted">{REMOTE_PROVIDER_META[provider].pathHint}</div>
          </div>

          <div>
            <label className="label" htmlFor="remoteUser">
              {provider === "jianguoyun" ? "坚果云账号（邮箱）" : "账号"}
            </label>
            <input
              id="remoteUser"
              className="input"
              value={remoteUser}
              onChange={(e) => setRemoteUser(e.target.value)}
              placeholder={REMOTE_PROVIDER_META[provider].userPlaceholder}
              autoComplete="off"
              disabled={!remoteEnabled}
            />
          </div>

          <div>
            <label className="label" htmlFor="remotePass">
              {provider === "jianguoyun" ? "应用密码" : "密码"}
            </label>
            <input
              id="remotePass"
              type="password"
              className="input"
              value={remotePass}
              onChange={(e) => setRemotePass(e.target.value)}
              placeholder={
                data?.settings.remote.passwordSet
                  ? "已保存，留空表示不改"
                  : REMOTE_PROVIDER_META[provider].passHint
              }
              autoComplete="new-password"
              disabled={!remoteEnabled}
            />
          </div>

          {provider === "openlist" ? (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="remoteToken">
                长期令牌（选填）
              </label>
              <input
                id="remoteToken"
                className="input tnum"
                value={remoteToken}
                onChange={(e) => setRemoteToken(e.target.value)}
                placeholder={
                  data?.settings.remote.tokenSet
                    ? "已保存，留空表示不改"
                    : "填了账号密码就不用填这个；只想用令牌时才填"
                }
                spellCheck={false}
                autoComplete="off"
                disabled={!remoteEnabled}
              />
              <div className="mt-1 text-[11px] leading-4 text-muted">
                系统优先用账号密码每次换新令牌（最稳）；只有没填密码时才用长期令牌。
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => void testConnection()}
            disabled={testing || !remoteEnabled}
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
            测试连接
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => void saveSettings()}
            disabled={busy !== null || !dirty || !cronOk}
          >
            {busy === "settings" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            保存设置
          </button>
          {data?.settings.remote.enabled && data.settings.lastUploadAt ? (
            <span className="text-[11.5px] text-muted">
              最近上传：<b className="tnum font-medium text-ink-2">{fmt(data.settings.lastUploadAt)}</b>
            </span>
          ) : null}
        </div>

        {testResult ? (
          <div
            className={`mt-3 rounded-lg px-3 py-2.5 text-[12px] leading-5 ${
              testResult.ok ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"
            }`}
          >
            <div className="flex items-start gap-1.5">
              {testResult.ok ? (
                <Check size={14} className="mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              )}
              <div>
                {testResult.message}
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                  <span>登录账号：{testResult.user ?? "—"}</span>
                  <span>目录：{testResult.pathExists ? "存在" : "不存在"}</span>
                  <span>权限：{testResult.writable ? "可写" : "不可写 / 未知"}</span>
                  <span>文件数：{testResult.fileCount}</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* 备份列表 */}
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[13.5px] font-semibold text-ink">备份文件</h2>
          <span className="tnum text-[11.5px] text-muted">共 {data?.items.length ?? 0} 份</span>
        </div>

        {data && data.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <th className="th">文件</th>
                  <th className="th w-[104px]">类型</th>
                  <th className="th w-[132px]">内容</th>
                  <th className="th w-[136px]">云端</th>
                  <th className="th w-[92px] text-right">大小</th>
                  <th className="th w-[150px]">时间</th>
                  <th className="th w-[132px] text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((f) => (
                  <tr key={f.name} className="hover:bg-sunken">
                    <td className="td">
                      <div className="tnum truncate font-medium text-ink" title={f.name}>
                        {f.name}
                      </div>
                      {f.pinned ? (
                        <div className="mt-0.5 text-[11px] text-muted">不会被动过</div>
                      ) : null}
                    </td>
                    <td className="td">
                      <span className={`tag ${BACKUP_KIND_TONE[f.kind]}`}>{BACKUP_KIND_LABEL[f.kind]}</span>
                    </td>
                    <td className="td text-[11.5px] leading-4">
                      {f.format === "tar" ? (
                        <>
                          <div className="text-ink-2">库 + 图片</div>
                          <div className="tnum text-muted">
                            {f.imageCount === null ? "图片数未知" : `${f.imageCount} 张图`}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-warn">只有库</div>
                          <div className="text-muted">老备份，不含图片</div>
                        </>
                      )}
                    </td>
                    <td className="td">
                      {f.uploadedAt ? (
                        <span
                          className="inline-flex items-center gap-1 text-[11.5px] text-ok"
                          title={`上传于 ${fmt(f.uploadedAt)}`}
                        >
                          <CloudCheck size={13} />
                          已上传
                        </span>
                      ) : data.settings.remote.enabled ? (
                        <button
                          type="button"
                          onClick={() => void uploadThis(f.name)}
                          disabled={uploading !== null}
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-muted transition-colors hover:bg-line-2 hover:text-brand-ink disabled:opacity-60"
                          title="传到云端"
                        >
                          {uploading === f.name ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <CloudUpload size={13} />
                          )}
                          上传
                        </button>
                      ) : (
                        <span className="text-[11.5px] text-faint">—</span>
                      )}
                    </td>
                    <td className="td tnum text-right text-ink-2">{formatBytes(f.sizeBytes)}</td>
                    <td className="td tnum text-[12.5px] text-ink-2">{fmt(f.createdAt)}</td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setRestoreWord("");
                            setRestoreLocal(f);
                          }}
                          disabled={busy !== null}
                          className="rounded-md p-1.5 text-muted transition-colors hover:bg-warn-soft hover:text-warn disabled:opacity-60"
                          title="用这一份恢复数据"
                        >
                          <History size={14} />
                        </button>
                        <a
                          href={`/api/backups/${f.name}/download`}
                          className="rounded-md p-1.5 text-muted transition-colors hover:bg-line-2 hover:text-brand-ink"
                          title="下载到本机"
                        >
                          <Download size={14} />
                        </a>
                        <button
                          type="button"
                          onClick={() => setToDelete(f)}
                          className="rounded-md p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                          title="删除这一份"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Database size={20} strokeWidth={1.6} className="text-muted" />
            <p className="text-[12.5px] text-muted">还没有备份。点右上角「立即备份」先留一份</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-2 bg-sunken px-4 py-2.5 text-[11.5px] text-muted">
          <span className="flex items-center gap-1">
            <HardDriveDownload size={12} />
            存放目录：<code className="tnum rounded bg-card px-1.5 py-0.5 text-ink-2">{data?.dir}</code>
          </span>
          <span>整卷拷走（data 目录）等于把所有备份一起带走</span>
        </div>
      </section>

      {/* 恢复 */}
      <section className="card border-danger/30 p-4 sm:p-5">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger">
            <Upload size={15} strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13.5px] font-semibold text-ink">用备份恢复数据</h2>
            <p className="mt-0.5 text-[11.5px] leading-5 text-muted">
              两种用法：列表里点某一行的「恢复」图标直接退回去（最快）；或者把从云端下载的包上传回来——
              换机器、整卷丢了，都是这条路上救的。
            </p>

            <ul className="mt-2 space-y-1 text-[11.5px] leading-5 text-ink-2">
              <li className="flex gap-1.5">
                <span className="text-danger">·</span>
                恢复是<b>整库覆盖</b>：备份之后新录的单据、商品、账号都会消失。
              </li>
              <li className="flex gap-1.5">
                <span className="text-ok">·</span>
                覆盖前系统会自动给当前数据（<b>含商品图片</b>）拍一张 <code>pre-restore</code> 快照，导错了还能拿它退回来。
              </li>
              <li className="flex gap-1.5">
                <span className="text-brand-ink">·</span>
                备份包里的图片会补齐到图片目录，<b>只补不删</b>——现有图片一张都不会被删掉。
              </li>
              <li className="flex gap-1.5">
                <span className="text-warn">·</span>
                恢复后账号密码以备份里为准——你可能会被踢回登录页。
              </li>
            </ul>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".tar,.db,application/octet-stream"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => fileRef.current?.click()}
                disabled={busy !== null}
              >
                <Upload size={14} />
                上传备份包
              </button>
              <span className="text-[11.5px] text-muted">接受 .tar（库+图片）与老的 .db，最大 512 MB</span>
            </div>

            {data?.settings.imageDir ? (
              <p className="mt-2 text-[11px] leading-4 text-muted">
                图片目录：<code className="tnum rounded bg-sunken px-1.5 py-0.5">{data.settings.imageDir}</code>
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* 删除确认 */}
      <Modal
        open={!!toDelete}
        title="删除这份备份？"
        description={
          toDelete
            ? `「${toDelete.name}」删掉就找不回来了${
                toDelete.uploadedAt ? "（注意：云端上那一份不会被一起删掉）" : ""
              }。如果这是唯一一份手动备份，建议先下载到本机再删。`
            : undefined
        }
        onClose={() => (deleting ? undefined : setToDelete(null))}
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setToDelete(null)}
              disabled={deleting}
            >
              取消
            </button>
            <button type="button" className="btn-danger" onClick={remove} disabled={deleting}>
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              确认删除
            </button>
          </>
        }
      />

      {/* 恢复确认：必须手打「恢复」两个字 */}
      <Modal
        open={restoreOpen}
        title="确认用这份备份覆盖当前数据？"
        description={
          restoreFile
            ? `将用「${restoreFile.name}」（${formatBytes(restoreFile.size)}）整库覆盖当前数据。`
            : undefined
        }
        onClose={() => (busy === "restore" ? undefined : setRestoreOpen(false))}
        width="max-w-[480px]"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setRestoreOpen(false)}
              disabled={busy === "restore"}
            >
              取消
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => void doRestore()}
              disabled={busy === "restore" || restoreWord.trim() !== "恢复"}
            >
              {busy === "restore" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              覆盖并恢复
            </button>
          </>
        }
      >
        <div className="space-y-3 pt-1">
          <div className="rounded-lg bg-danger-soft px-3 py-2.5 text-[12.5px] leading-5 text-danger">
            这会把当前所有数据替换成备份里的内容。备份之后录的单据、新建的商品、改过的密码，全部作废。
          </div>
          <div>
            <label className="label" htmlFor="restore-word">
              照着输入「恢复」两个字 <span className="text-danger">*</span>
            </label>
            <input
              id="restore-word"
              className="input"
              value={restoreWord}
              onChange={(e) => setRestoreWord(e.target.value)}
              placeholder="恢复"
              autoFocus
            />
          </div>
        </div>
      </Modal>

      {/* 用服务器上这一份恢复：确认框 */}
      <Modal
        open={!!restoreLocal}
        title="确认用这份备份覆盖当前数据？"
        description={
          restoreLocal
            ? `将用「${restoreLocal.name}」（${formatBytes(restoreLocal.sizeBytes)}）覆盖当前数据。`
            : undefined
        }
        onClose={() => (busy === "restore" ? undefined : setRestoreLocal(null))}
        width="max-w-[480px]"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setRestoreLocal(null)}
              disabled={busy === "restore"}
            >
              取消
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => void doRestoreLocal()}
              disabled={busy === "restore" || restoreWord.trim() !== "恢复"}
            >
              {busy === "restore" ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />}
              覆盖并恢复
            </button>
          </>
        }
      >
        <div className="space-y-3 pt-1">
          <div className="rounded-lg bg-danger-soft px-3 py-2.5 text-[12.5px] leading-5 text-danger">
            这会把当前所有数据替换成备份里的内容。备份之后录的单据、新建的商品、改过的密码，全部作废。
          </div>
          <div className="rounded-lg bg-sunken px-3 py-2 text-[12px] leading-5 text-ink-2">
            {restoreLocal?.format === "tar"
              ? `这份包里带 ${restoreLocal.imageCount ?? 0} 张商品图，恢复时一起补进图片目录（只补不删）。`
              : "这是老格式备份，只有数据库，不含图片。恢复后图片目录保持现状。"}
          </div>
          <div>
            <label className="label" htmlFor="restore-local-word">
              照着输入「恢复」两个字 <span className="text-danger">*</span>
            </label>
            <input
              id="restore-local-word"
              className="input"
              value={restoreWord}
              onChange={(e) => setRestoreWord(e.target.value)}
              placeholder="恢复"
              autoFocus
            />
          </div>
        </div>
      </Modal>

      {/* 恢复结果 */}
      <Modal
        open={!!restoreResult}
        title="数据已恢复"
        onClose={() => setRestoreResult(null)}
        width="max-w-[520px]"
        footer={
          <button type="button" className="btn-primary" onClick={() => setRestoreResult(null)}>
            知道了
          </button>
        }
      >
        {restoreResult ? (
          <div className="space-y-3 pt-1 text-[12.5px] leading-5">
            <div className="rounded-lg bg-ok-soft px-3 py-2.5 text-ok">
              已用「{restoreResult.from}」覆盖当前数据。库里现在有：商品{" "}
              <b className="tnum">{restoreResult.counts.products}</b> 款、单据{" "}
              <b className="tnum">{restoreResult.counts.documents}</b> 张、库存流水{" "}
              <b className="tnum">{restoreResult.counts.movements}</b> 条、账号{" "}
              <b className="tnum">{restoreResult.counts.users}</b> 个。
            </div>

            {restoreResult.format === "tar" ? (
              <div
                className={`rounded-lg px-3 py-2.5 ${
                  restoreResult.imagesMissing > 0 ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"
                }`}
              >
                图片：包里带 <b className="tnum">{restoreResult.imagesInBackup}</b> 张，这次补进{" "}
                <b className="tnum">{restoreResult.imagesRestored}</b> 张（已存在的同名图跳过）。
                {restoreResult.imagesMissing > 0 ? (
                  <>
                    <br />
                    仍有 <b className="tnum">{restoreResult.imagesMissing}</b> 个商品找不到图片文件——
                    这份备份可能是「不含图片」时期拍的。到商品页重新传一下图即可。
                  </>
                ) : (
                  <>全部商品图片都对上了。</>
                )}
              </div>
            ) : (
              <div className="rounded-lg bg-warn-soft px-3 py-2.5 text-warn">
                这是老格式备份，<b>不含商品图片</b>，图片目录保持原样。若这次没解决破图问题，
                请换一份 .tar 备份再恢复。
              </div>
            )}

            {restoreResult.safetyBackup ? (
              <p className="text-ink-2">
                恢复前的数据已经拍成快照：
                <code className="tnum rounded bg-sunken px-1.5 py-0.5">{restoreResult.safetyBackup}</code>
                <br />
                <span className="text-muted">导错了就再用它恢复一次，等于撤销。</span>
              </p>
            ) : null}

            {restoreResult.needsRestart ? (
              <div className="flex items-start gap-1.5 rounded-lg bg-warn-soft px-3 py-2.5 text-warn">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div>
                  这份备份来自更早的版本，表结构还差 {restoreResult.pendingMigrations.length} 步迁移。
                  数据已经装回去了，但有些页面可能报错——
                  <b>请重启一次服务</b>（NAS 上执行 <code>docker compose restart</code>），
                  启动时会自动把缺的表结构补上。
                  {restoreResult.pendingMigrations.length > 0 ? (
                    <div className="mt-1 break-all text-[11px]">
                      缺失：{restoreResult.pendingMigrations.join("、")}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <p className="text-[11.5px] text-muted">
              如果账号密码是旧的，用备份里的密码登录；进不去就让别的管理员重置。
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  unit,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
        <Icon size={13} strokeWidth={1.8} />
        {label}
      </div>
      <div className="tnum mt-1 text-[22px] font-semibold leading-tight text-ink">
        {value}
        {unit ? <span className="ml-1 text-[12px] font-normal text-muted">{unit}</span> : null}
      </div>
    </div>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
