import type { Metadata, Viewport } from "next";
import { DEFAULT_THEME, THEME_INIT_SCRIPT, themeMeta } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "半巷设计 ERP",
  description: "半巷设计 ERP · 库房仓储管理",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: themeMeta(DEFAULT_THEME).themeColor,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme 会被下面的内联脚本改写，React 没法知道，所以关掉这一层的
    // hydration 比对警告（只影响 <html> 自己的属性，不影响子树）。
    <html lang="zh-CN" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        {/*
          首帧主题。必须同步内联在 <head>：放在 useEffect 里已经晚了一帧，
          深色主题的用户会先看到白闪。读 cookie → localStorage → 默认值。
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
