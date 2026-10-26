"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Boxes, Loader2, LockKeyhole, User } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Wallpaper } from "@/components/wallpaper";

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
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-14">
      <Wallpaper />

      <div className="absolute right-4 top-4 z-20">
        <ThemeSwitcher />
      </div>

      {/*
        一块单独的玻璃，正中间。
        mac 的登录窗就是一张卡片：图标、名字、两个输入框。
        它不摆"左右两栏讲卖点"——那是官网的事，不是登录窗的事。
        三句承诺挪到卡片底部，一行小字，想看的人能看到。
      */}
      <div className="sheet-in glass relative z-10 w-full max-w-[388px] rounded-[22px] px-7 py-8">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-[54px] w-[54px] items-center justify-center rounded-[15px] bg-brand-solid text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_20px_-6px_rgba(0,84,199,0.55)]">
            <Boxes size={27} strokeWidth={1.7} />
          </div>
          <h1 className="mt-4 text-[17px] font-semibold tracking-[-0.02em] text-ink">
            宿藤家居 ERP
          </h1>
          <p className="mt-1 text-[11.5px] text-muted">库房仓储管理 · 用分配给你的账号登录</p>
        </div>

        <form onSubmit={onSubmit} className="mt-7 space-y-3.5">
          <div>
            <label className="label" htmlFor="username">
              账号
            </label>
            <div className="relative">
              <User
                size={14}
                strokeWidth={2}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
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
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
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
              className="h-3.5 w-3.5 rounded-[4px] border-line accent-brand focus:ring-brand/30"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            在这台设备上保持登录
          </label>

          {error ? (
            <div
              role="alert"
              className="rounded-[10px] bg-danger/10 px-3 py-2 text-[12px] leading-5 text-danger"
            >
              {error}
            </div>
          ) : null}

          <button type="submit" className="btn-primary w-full py-2.5" disabled={loading}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : null}
            {loading ? "正在登录…" : "登录"}
          </button>
        </form>

        <div className="mt-6 border-t border-line/60 pt-4 text-center text-[10.5px] leading-[1.9] text-muted">
          库存只能由流水推导 · 退货良品与次品分开算 · 盘点锁时点
        </div>
      </div>

      <div className="relative z-10 mt-6 text-center text-[10.5px] text-muted">
        忘记密码请联系管理员重置 · 账号与权限由店长维护
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
