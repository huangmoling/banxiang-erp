import type { Config } from "tailwindcss";

/**
 * 视觉规范 v1.3（UI 重构）
 * ----------------------------------------------------------------------------
 * 颜色一律走 CSS 变量，定义在 src/app/globals.css。
 * 三套主题（graphite / lumen / obsidian）只换变量值，这里不写死任何 hex——
 * 一旦这里写了具体颜色，主题切换就会破，页面里也会重新长回硬编码。
 *
 * 变量值是 "R G B" 三元组，包成 rgb(... / <alpha-value>) 之后
 * bg-canvas/95、border-danger/40 这类透明度修饰符仍然可用。
 */
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /* 三层表面 */
        canvas: v("--c-canvas"),
        card: v("--c-card"),
        sunken: v("--c-sunken"),

        /* 线与文字 */
        line: v("--c-line"),
        "line-2": v("--c-line-2"),
        ink: v("--c-ink"),
        "ink-2": v("--c-ink-2"),
        muted: v("--c-muted"),

        brand: {
          DEFAULT: v("--c-brand"),
          /** 实心按钮底：比 brand 略深，保证白字 ≥4.5:1 */
          solid: v("--c-brand-solid"),
          soft: v("--c-brand-soft"),
          ink: v("--c-brand-ink"),
        },

        /** 定制款/定制色。按件追踪是这套系统独有的概念，值得一个专属色 */
        custom: {
          DEFAULT: v("--c-custom"),
          soft: v("--c-custom-soft"),
        },

        warn: { DEFAULT: v("--c-warn"), soft: v("--c-warn-soft") },
        danger: { DEFAULT: v("--c-danger"), soft: v("--c-danger-soft") },
        ok: { DEFAULT: v("--c-ok"), soft: v("--c-ok-soft") },

        /* 侧栏自成一套：graphite/obsidian 深色，lumen 浅色 */
        sidebar: {
          DEFAULT: v("--c-sidebar"),
          fg: v("--c-sidebar-fg"),
          muted: v("--c-sidebar-muted"),
          line: v("--c-sidebar-line"),
          hover: v("--c-sidebar-hover"),
          active: v("--c-sidebar-active"),
          "active-fg": v("--c-sidebar-active-fg"),
        },
      },
      borderRadius: {
        card: "12px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        pop: "var(--shadow-pop)",
      },
      fontSize: {
        num: ["30px", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
      },
      fontFamily: {
        /* 不自托管字体：客户内网部署，拿不到 CDN，中文字体包又太大。
           继续用系统栈，把渲染质量交给 -webkit-font-smoothing。 */
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Microsoft YaHei",
          "Hiragino Sans GB",
          "sans-serif",
        ],
        /* 单号、数量、时间戳用等宽：位数对齐，扫表时不会跳 */
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};

export default config;
