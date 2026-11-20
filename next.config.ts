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
  /**
   * 安全响应头。
   *
   * 只加「不改行为」的那几个：
   * - 禁止被 iframe 嵌套（点击劫持）
   * - 禁止 MIME 嗅探（配合上传白名单挡「图片里的脚本」）
   * - 不把完整 URL 带给外部站点（内网地址、单号别漏出去）
   * 完整 CSP 没上：页面里有主题初始化用的 inline script，
   * 上 CSP 就得配 nonce，收益不如改崩风险大。frame-ancestors 单独给一条够用。
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
