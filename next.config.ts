import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 允许指定构建产物目录：本地 Windows 上 .next 偶尔会被系统或杀毒锁定，
  // 可用 NEXT_DIST_DIR=.next-build 绕开，避免与开发缓存互相干扰。
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // 单进程部署：next build 后产出 .next/standalone，配合 SQLite 文件即可运行
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "pino", "bcryptjs"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // 关掉「构建放进子进程」这条路径。
    // 开着时父子两个进程会同时往 <distDir>/trace 里追加构建事件，
    // 在 Windows 上会随机撞成 EPERM（open ... trace），构建直接崩在编译阶段；
    // 表现是同一份代码有时能过、有时过不去，最难查。
    // 单进程构建慢十来秒，换一个「每次都一样」的结果，值。
    webpackBuildWorker: false,
  },
};

export default nextConfig;
