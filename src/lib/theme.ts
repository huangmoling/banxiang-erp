/**
 * 主题定义。
 *
 * 三套主题共用一套组件与一套页面代码，区别只在 globals.css 里的变量值
 * 与 <html data-theme="..."> 这一个属性。所以「切换主题」不需要刷新、
 * 不需要重新取数据，也不会因为某个页面忘了适配而花掉。
 *
 * 选择存在两处：
 *   - cookie `suteng:theme`  —— 给首帧用（服务端渲染时就能带上，见 layout.tsx）
 *   - localStorage 同 key     —— 兜底，cookie 被清掉也能记住
 *
 * 这里不引任何依赖，纯常量 + 小函数，客户端服务端都能 import。
 */

export const THEMES = [
  {
    id: "paper",
    label: "素白",
    /** 一句话说清它适合什么时候用，别让人靠猜 */
    hint: "暖米白纸 · 白天与打印",
    /** 色板预览的三个点：导轨 / 画布 / 主色 */
    swatch: ["#141A20", "#F2F1EE", "#12A594"],
    themeColor: "#F2F1EE",
  },
  {
    id: "mist",
    label: "晨雾",
    hint: "冷调青灰 · 久看不累",
    swatch: ["#0F1E26", "#E9EFF2", "#12A594"],
    themeColor: "#E9EFF2",
  },
  {
    id: "ink",
    label: "午夜",
    hint: "全局深色 · 夜里盘库",
    swatch: ["#0B0F13", "#161D24", "#2BB3A3"],
    themeColor: "#0B0F13",
  },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "paper";

export const THEME_COOKIE = "suteng:theme";

/** cookie 一年，跨设备不用反复选（同一个人常在固定机器上干活） */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some((t) => t.id === value);
}

export function themeMeta(id: ThemeId) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/**
 * 首帧应用主题的内联脚本。
 *
 * 必须是同步内联（放在 <head>），在浏览器第一次绘制之前就跑完，
 * 否则深色主题的用户会先看到一帧白底。这是唯一能杜绝闪白的位置——
 * 放在 React 的 useEffect 里已经晚了。
 *
 * 顺序：cookie（服务端也会读，保持一致）→ localStorage → 默认。
 * 老版三套（graphite/lumen/obsidian）映射到新的三套，改版不掉用户的习惯。
 */
export const THEME_INIT_SCRIPT = [
  "(function(){try{",
  'var C="' + THEME_COOKIE + '",D="' + DEFAULT_THEME + '",IDS=["paper","mist","ink"];',
  'var MAP={graphite:"mist",lumen:"paper",obsidian:"ink"};',
  "function readCookie(n){var ps=document.cookie?document.cookie.split('; '):[];",
  "for(var i=0;i<ps.length;i++){if(ps[i].indexOf(n+'=')===0)return decodeURIComponent(ps[i].slice(n.length+1));}",
  "return null;}",
  "var t=readCookie(C);",
  "if(!t){try{t=localStorage.getItem(C);}catch(e){}}",
  "if(MAP[t])t=MAP[t];",
  "if(IDS.indexOf(t)<0)t=D;",
  "var d=document.documentElement;d.setAttribute('data-theme',t);",
  "var c=t==='ink'?'#0B0F13':(t==='mist'?'#E9EFF2':'#F2F1EE');",
  'var mt=document.querySelector(\'meta[name="theme-color"]\');if(mt)mt.setAttribute("content",c);',
  "}catch(e){}})();",
].join("");

/**
 * 应用主题（客户端调用）。
 * 直接改 DOM 属性，不触发路由刷新——切主题不该打断用户手上的活。
 */
export function applyTheme(id: ThemeId) {
  if (typeof document === "undefined") return;
  const meta = themeMeta(id);
  document.documentElement.setAttribute("data-theme", id);

  const themeColorTag = document.querySelector('meta[name="theme-color"]');
  if (themeColorTag) themeColorTag.setAttribute("content", meta.themeColor);

  try {
    document.cookie = `${THEME_COOKIE}=${id}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    /* cookie 写不了就算了，localStorage 还在 */
  }
  try {
    localStorage.setItem(THEME_COOKIE, id);
  } catch {
    /* 隐私模式下 localStorage 会抛，忽略 */
  }
}
