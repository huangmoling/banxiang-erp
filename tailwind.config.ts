import type { Config } from "tailwindcss";

/**
 * 视觉规范 v3（致远范式 · 三态）
 * ----------------------------------------------------------------------------
 * 颜色一律走 CSS 变量，定义在 src/app/globals.css。
 * 三套主题（paper / mist / ink）只换变量值，这里不写死任何 hex——
 * 一旦这里写了具体颜色，主题切换就会破，页面里也会重新长回硬编码。
 *
 * 变量值是 "R G B" 三元组，包成 rgb(... / <alpha-value>) 之后
 * bg-card/95、border-danger/40 这类透明度修饰符仍然可用。
 *
 * 圆角只有两档：card 10px（纸面）、field 6px（控件）。
 * 深色面（导轨/顶栏/工作台）走 deep-*，三套主题里都是深的。
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
          /** 实心按钮底：比 brand 深，保证白字 ≥5:1 */
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
        danger: {
          DEFAULT: v("--c-danger"),
          /** 实心红底：白字专用，比正文红暗一档 */
          solid: v("--c-danger-solid"),
          soft: v("--c-danger-soft"),
        },
        ok: { DEFAULT: v("--c-ok"), soft: v("--c-ok-soft") },

        /* 深色面：导轨、顶栏、工作台。三套主题里都保持深色 */
        deep: {
          DEFAULT: v("--c-deep-bg"),
          card: v("--c-deep-card"),
          raised: v("--c-deep-raised"),
          line: v("--c-deep-line"),
          fg: v("--c-deep-fg"),
          fg2: v("--c-deep-fg2"),
          muted: v("--c-deep-muted"),
          active: v("--c-deep-active"),
        },

        /* 兼容旧命名（少量组件仍在用 sidebar-*），语义同 deep-* */
        sidebar: {
          DEFAULT: v("--c-deep-bg"),
          fg: v("--c-deep-fg2"),
          muted: v("--c-deep-muted"),
          line: v("--c-deep-line"),
          hover: v("--c-deep-hover"),
          active: v("--c-deep-active"),
          "active-fg": v("--c-deep-fg"),
          strong: v("--c-deep-fg"),
        },
      },
      borderRadius: {
        /** 表面：纸卡、表格、面板 */
        card: "16px",
        /** 控件：按钮、输入框、下拉 */
        field: "10px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        pop: "var(--shadow-pop)",
      },
      fontSize: {
        /** 数字块的主数字：靠字重和字距压出精密感，不靠字大 */
        num: ["30px", { lineHeight: "1", letterSpacing: "-0.025em" }],
        /** 页面大标题：21px 就够，再大就成了消费级产品 */
        display: ["21px", { lineHeight: "1.25", letterSpacing: "-0.015em" }],
      },
      fontFamily: {
        /* 不自托管字体：客户内网部署，拿不到 CDN，中文字体包又太大。
           继续用系统栈——macOS 上是 SF Pro，Windows 上落到 Segoe UI。 */
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Segoe UI Variable Text",
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
      transitionTimingFunction: {
        mac: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};

export default config;
