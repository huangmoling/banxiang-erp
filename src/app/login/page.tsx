"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Boxes, Check, Loader2, LockKeyhole, User } from "lucide-react";
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      {/*
        底纹：极细网格 + 一团很淡的品牌色光晕。
        科技感来自"精密"而不是特效——网格间距 32px、线只有 1px，
        光晕用 10% 透明度，正常看几乎察觉不到，只让画布不是一块死白/死黑。
      */}
      <div className="grid-fade pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[400px] w-[760px] -translate-x-1/2 rounded-full bg-brand/10 blur-[110px]"
        aria-hidden
      />

      <div className="absolute right-4 top-4 z-10">
        <ThemeSwitcher />
      </div>

      <div className="relative grid w-full max-w-[920px] overflow-hidden rounded-card border border-line bg-card shadow-pop md:min-h-[540px] md:grid-cols-[1.02fr_1fr]">
        {/*
          左半用的是"侧栏色"（bg-sidebar），不是写死的深蓝。
          好处有两个：登录后左侧栏就是这个颜色，视觉上前后接得住；
          切到全浅主题它自动变白、文字自动变深，不用另写一套。
        */}
        <div className="hidden flex-col justify-between bg-sidebar p-9 md:flex md:border-r md:border-sidebar-line">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-solid text-white">
              <Boxes size={19} strokeWidth={1.7} />
            </div>
            <div>
              <div className="text-[15px] font-semibold tracking-tight text-sidebar-active-fg">
                宿藤家居 ERP
              </div>
              <div className="text-[11.5px] text-sidebar-muted">库房仓储管理</div>
            </div>
          </div>

          <div className="my-10">
            <h1 className="text-[24px] font-semibold leading-[1.4] tracking-[-0.01em] text-sidebar-active-fg">
              进出多少、
              <br />
              退回来几件，
              <br />
              一查就清楚。
            </h1>
            <p className="mt-3.5 text-[12.5px] leading-6 text-sidebar-muted">
              只记数量，不记价格。仓库里的事，仓库的人自己就能录。
            </p>
          </div>

          <ul className="space-y-2.5 text-[12px] leading-5 text-sidebar-muted">
            {[
              "库存只能由出入库流水推导，改不了数字",
              "退货分「良品回架」与「次品区」，不混算",
              "盘点锁截止时点，当天照常发货",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Check size={13} strokeWidth={2.6} className="mt-[3px] shrink-0 text-brand" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 右：表单 */}
        <div className="p-8 sm:p-10">
          <div className="mb-7 md:hidden">
            <div className="flex items-center gap-2 text-brand-ink">
              <Boxes size={19} strokeWidth={1.8} />
              <span className="text-[15px] font-semibold">宿藤家居 ERP</span>
            </div>
          </div>

          <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">登录</h2>
          <p className="mt-1 text-[12.5px] text-muted">用仓库分配的账号登录</p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            <div>
              <label className="label" htmlFor="username">
                账号
              </label>
              <div className="relative">
                <User
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  id="username"
                  className="input pl-9"
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
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  id="password"
                  type="password"
                  className="input pl-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  required
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-line text-brand-ink focus:ring-brand/30"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              在这台设备上保持登录
            </label>

            {error ? (
              <div
                role="alert"
                className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[12.5px] leading-5 text-danger"
              >
                {error}
              </div>
            ) : null}

            <button type="submit" className="btn-primary w-full py-2.5" disabled={loading}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? "正在登录…" : "登录"}
            </button>
          </form>

          <p className="mt-6 text-[11.5px] leading-5 text-muted">
            忘记密码请联系管理员重置。账号与权限由店长维护。
          </p>
        </div>
      </div>

      <div className="absolute bottom-4 left-0 right-0 text-center text-[11px] text-muted">
        宿藤家居 · 库房仓储管理
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
