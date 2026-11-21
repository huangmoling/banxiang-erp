/**
 * 主题定义 —— 清新 SaaS 风 · 三套配色
 * 三套共用一套组件与布局，区别只在 globals.css 的令牌取值与 data-theme。
 * paper = SaaS 紫（默认） / mist = 海盐蓝 / ink = 午夜紫
 */
export const THEMES = [
  {
    id: "paper",
    label: "SaaS 紫",
    hint: "紫粉渐变 · 清新 SaaS 风",
    swatch: ["#7C5CFF", "#F2F3FA", "#EC4899"],
    themeColor: "#F2F3FA",
  },
  {
    id: "mist",
    label: "海盐蓝",
    hint: "天蓝→青→薄荷渐变",
    swatch: ["#0EA5E9", "#EFF8FE", "#34D399"],
    themeColor: "#EFF8FE",
  },
  {
    id: "ink",
    label: "午夜紫",
    hint: "深空蓝灰 + 霓虹紫粉",
    swatch: ["#0A0E16", "#121824", "#A78BFA"],
    themeColor: "#0A0E16",
  },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: ThemeId = "paper";
export const THEME_COOKIE = "suteng:theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some((t) => t.id === value);
}
export function themeMeta(id: ThemeId) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
// 首屏防闪白：在 <head> 里同步跑，读 cookie/localStorage 后立刻打上 data-theme
export const THEME_INIT_SCRIPT = [
  "(function(){try{",
  'var C="' + THEME_COOKIE + '",D="' + DEFAULT_THEME + '",IDS=["paper","mist","ink"];',
  // 历史遗留的主题值（含 v1.5 致远范式那一代）统一落到最接近的新主题上
  'var MAP={graphite:"mist",lumen:"paper",obsidian:"ink"};',
  "function readCookie(n){var ps=document.cookie?document.cookie.split('; '):[];",
  "for(var i=0;i<ps.length;i++){if(ps[i].indexOf(n+'=')===0)return decodeURIComponent(ps[i].slice(n.length+1));}",
  "return null;}",
  "var t=readCookie(C);",
  "if(!t){try{t=localStorage.getItem(C);}catch(e){}}",
  "if(MAP[t])t=MAP[t];",
  "if(IDS.indexOf(t)<0)t=D;",
  "var d=document.documentElement;d.setAttribute('data-theme',t);",
  "var c=t==='ink'?'#0A0E16':(t==='mist'?'#EFF8FE':'#F2F3FA');",
  'var mt=document.querySelector(\'meta[name="theme-color"]\');if(mt)mt.setAttribute("content",c);',
  "}catch(e){}})();",
].join("");

export function applyTheme(id: ThemeId) {
  if (typeof document === "undefined") return;
  const meta = themeMeta(id);
  document.documentElement.setAttribute("data-theme", id);
  const themeColorTag = document.querySelector('meta[name="theme-color"]');
  if (themeColorTag) themeColorTag.setAttribute("content", meta.themeColor);
  try {
    document.cookie = `${THEME_COOKIE}=${id}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
  } catch {}
  try {
    localStorage.setItem(THEME_COOKIE, id);
  } catch {}
}
