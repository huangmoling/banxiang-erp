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
    document.title = "登录 · 宿藤家居 ERP";
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
        左：深色面。一句话说清这套系统靠什么立住（库存只能由流水推导），
        不放产品截图、不放"高效管理"这种空话。小屏直接不显示——
        手机上是来登录的，不是来看介绍页的。
      */}
      <div className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-deep p-10 lg:flex">
        <div className="login-weave absolute inset-0" aria-hidden />

        <div className="relative flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-brand-solid text-white">
            <Boxes size={17} strokeWidth={2} />
          </div>
          <div>
            <div className="text-[13px] font-semibold leading-tight text-deep-fg">宿藤家居</div>
            <div className="text-[10.5px] leading-tight text-deep-muted">库房仓储管理</div>
          </div>
        </div>

        <div className="relative">
          <h2 className="text-[26px] font-semibold leading-[1.35] tracking-[-0.02em] text-deep-fg">
            每一件货，
            <br />
            都算得清。
          </h2>
          <p className="mt-3.5 max-w-[30ch] text-[11.5px] leading-[1.9] text-deep-fg2">
            库存只由出入库流水推导，没人能直接改数字。
            退货的良品和次品分两个池子算，定制件退回永不回流。
          </p>
        </div>

        <div className="relative flex items-center gap-3 text-[10.5px] text-deep-muted">
          <span>v1.5</span>
          <span className="h-3 w-px bg-white/12" />
          <span>宿藤家居 · 内部系统</span>
        </div>
      </div>

      {/* 右：纸面表单。只有一个任务——登录 */}
      <div className="relative flex flex-1 items-center justify-center bg-canvas px-4 py-12">
        <div className="absolute right-4 top-4">
          <ThemeSwitcher tone="light" />
        </div>

        <div className="w-full max-w-[368px]">
          <div className="rounded-card border border-line bg-card px-6 py-7 shadow-card">
            <div className="flex items-center gap-2 lg:hidden">
              <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-brand-solid text-white">
                <Boxes size={15} strokeWidth={2} />
              </div>
              <span className="text-[13px] font-semibold text-ink">宿藤家居 ERP</span>
            </div>

            <h1 className="mt-4 text-[19px] font-semibold tracking-[-0.015em] text-ink lg:mt-0">
              登录
            </h1>
            <p className="mt-1 text-[11.5px] text-muted">用分配给你的账号登录</p>

            <form onSubmit={onSubmit} className="mt-6 space-y-3.5">
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

              <label className="flex cursor-pointer items-center gap-2 pt-0.5 text-[12px] text-ink-2">
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

              <button type="submit" className="btn-primary w-full py-2.5" disabled={loading}>
                {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                {loading ? "正在登录…" : "登录"}
              </button>
            </form>

            <div className="mt-5 border-t border-line pt-3.5 text-[10.5px] leading-[1.9] text-muted">
              库存只能由流水推导 · 退货良品与次品分开算 · 盘点锁时点
            </div>
          </div>

          <p className="mt-4 text-center text-[10.5px] text-muted">
            忘记密码请联系管理员重置 · 账号与权限由店长维护
          </p>
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
