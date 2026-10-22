import type { Config } from "tailwindcss";

/**
 * 视觉规范（见设计方案 5.8）：
 * 中性灰底 #f6f7f9 + 白卡片，单一主色靛蓝 #3b5bdb，圆角 12px，无阴影。
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f6f7f9",
        card: "#ffffff",
        ink: "#1f2430",
        "ink-2": "#525a68",
        muted: "#8a929f",
        line: "#e6e8ec",
        "line-2": "#eef0f3",
        brand: {
          DEFAULT: "#3b5bdb",
          soft: "#eef1fd",
          ink: "#2f49af",
        },
        warn: "#c2711a",
        "warn-soft": "#fdf4e8",
        danger: "#c0392b",
        "danger-soft": "#fdeeec",
        ok: "#1f7a4d",
        "ok-soft": "#eaf6ef",
      },
      borderRadius: {
        card: "12px",
      },
      fontSize: {
        num: ["30px", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Microsoft YaHei",
          "Hiragino Sans GB",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};

export default config;
