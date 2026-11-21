"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Boxes, Loader2, LockKeyhole, User } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { ThemeSwitcher } from "@/components/theme-switcher";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = "登录 · 半巷设计 ERP";
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      await api("/api/auth/login", {
        method: "POST",
        json: { username, password, remember },
        noAuthRedirect: true,
      });
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登录失败，请重试");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/*
        左：一块纯深色面。全站唯一允许出现径向渐变的位置——青色光晕从中间
        散开，上面压一层 30px 方格。不放产品截图、不放"高效管理"这种空话，
        只留一句这套系统的底线。

        深面走 --login-deep：紫版是葡萄紫、蓝版是深海蓝、午夜版是压暗的深紫，
        换主题时左栏和右边那张纸一起变。
      */}
      <div className="relative hidden w-[62%] overflow-hidden bg-[rgb(var(--login-deep))] lg:block">
        <div className="login-grid absolute inset-0" aria-hidden />
        <div className="login-glow absolute inset-0" aria-hidden />
        <div className="absolute inset-y-0 right-0 w-px bg-white/10" aria-hidden />

        <div className="relative flex h-full min-h-screen flex-col pl-[7.6%] pr-[6%] pt-[15vh]">
          <div className="flex items-center gap-3">
            <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[7px] bg-white text-brand-ink">
              <Boxes size={19} strokeWidth={2.1} />
            </div>
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-white">
              半巷设计 ERP
            </span>
          </div>

          <div className="mt-[19vh]">
            <h2 className="text-[38px] font-semibold leading-[1.32] tracking-[-0.03em] text-white">
              库房的事，
              <br />
              一件都不会丢。
            </h2>
            <p className="mt-5 text-[14px] leading-[1.9] text-deep-fg2">
              入库 · 出库 · 退货 · 盘点 · 次品，全部留痕 · 清新 SaaS 工作台
            </p>
          </div>
        </div>
      </div>

      {/*
        右：一张纸。没有卡片、没有阴影、没有边框盒——表单直接长在纸上，
        跟报告里那版一致。整个页面只有一个任务：登录。
      */}
      <div className="relative flex flex-1 flex-col justify-center bg-card px-6 py-12 sm:px-10 lg:w-[38%] lg:flex-none lg:px-14">
        <div className="absolute right-4 top-4">
          <ThemeSwitcher tone="light" />
        </div>

        <div className="mx-auto w-full max-w-[400px]">
          {/* 手机上没有左栏，品牌放这里 */}
          <div className="mb-9 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] bg-white text-brand-ink">
              <Boxes size={17} strokeWidth={2.1} />
            </div>
            <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
              半巷设计 ERP
            </span>
          </div>

          <h1 className="text-[21px] font-semibold tracking-[-0.02em] text-ink">登录</h1>
          <p className="mt-2 text-[13px] text-muted">请使用管理员分配的账号</p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            <div>
              <label className="label" htmlFor="username">
                账号
              </label>
              <div className="relative">
                <User
                  size={14}
                  strokeWidth={2}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  id="username"
                  className="input pl-8"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  placeholder="例如 admin"
                  required
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="password">
                密码
              </label>
              <div className="relative">
                <LockKeyhole
                  size={14}
                  strokeWidth={2}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  id="password"
                  type="password"
                  className="input pl-8"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  required
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 pt-1 text-[12px] text-ink-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded-[3px] border-line accent-brand focus:ring-brand/30"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              在这台设备上保持登录
            </label>

            {error ? (
              <div
                role="alert"
                className="rounded-[6px] bg-danger/10 px-3 py-2 text-[12px] leading-5 text-danger"
              >
                {error}
              </div>
            ) : null}

            <button type="submit" className="btn-login py-2.5" disabled={loading}>
              {loading ? <Loader2 size={15} className="animate-spin" /> : null}
              {loading ? "正在登录…" : "进入系统"}
            </button>
          </form>

          <p className="mt-7 text-[12px] text-muted">忘记密码请联系管理员重置</p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-[13px] text-muted">
          加载中…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
