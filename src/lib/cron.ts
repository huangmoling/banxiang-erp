/**
 * 极简 cron 解析器（标准 5 段：分 时 日 月 周）。
 *
 * 为什么不引库：
 * 这里只需要两件事——「现在这一分钟该不该跑」和「下次/上次是哪一分钟」。
 * 成熟的 cron 库会拖进时区对象、秒级字段、任务队列一堆东西，
 * 而部署在仓库 NAS 上的单进程服务，时区就是容器里的 Asia/Shanghai，不需要那些。
 *
 * 这个文件是**纯函数、无服务端依赖**，前端也会直接引：
 * 设置页要边输边显示「下次运行：明天 03:00」，不能等服务端算。
 *
 * 支持的写法：
 *   `*`  任意        `5`   具体值       `1-5` 区间
 *   `*` 后面接 `/15` 表示每 15 分钟；`10-20/2` 区间步进；`1,15,30` 枚举（可混合上面几种）
 *   `?`（仅日的字段）等同 `*`
 *   月份支持 JAN–DEC、周支持 SUN–SAT（大小写都行）
 */

export type CronSpec = {
  source: string;
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  domRestricted: boolean;
  dowRestricted: boolean;
};

const MONTH_NAMES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const DOW_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

type FieldRange = { min: number; max: number; names?: Record<string, number> };

function toValue(raw: string, names?: Record<string, number>): number | null {
  const s = raw.trim().toUpperCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (names) {
    const hit = names[s];
    if (hit !== undefined) return hit;
  }
  return null;
}

/** 解析一个字段，返回升序去重的值数组；有任何一处看不懂就整体判为非法 */
function parseField(raw: string, range: FieldRange): number[] | null {
  const text = raw.trim();
  if (!text) return null;

  const out = new Set<number>();
  for (const part of text.split(",")) {
    if (!part) return null;

    // 步进：`*/5`、`1-30/2`、`10/5`
    let step = 1;
    let body = part;
    const slash = part.indexOf("/");
    if (slash >= 0) {
      body = part.slice(0, slash);
      const stepText = part.slice(slash + 1);
      if (!/^\d+$/.test(stepText)) return null;
      step = Number(stepText);
      if (step < 1) return null;
    }

    let lo: number;
    let hi: number;

    if (body === "*" || body === "?") {
      lo = range.min;
      hi = range.max;
    } else if (body.includes("-")) {
      const [a, b] = body.split("-");
      const loV = toValue(a ?? "", range.names);
      const hiV = toValue(b ?? "", range.names);
      if (loV === null || hiV === null) return null;
      lo = loV;
      hi = hiV;
    } else {
      const v = toValue(body, range.names);
      if (v === null) return null;
      lo = v;
      // `10/15` 的语义是「从 10 开始，每 15 一直到上限」
      hi = slash >= 0 ? range.max : v;
    }

    if (lo > hi) return null;
    if (lo < range.min || hi > range.max) return null;

    for (let v = lo; v <= hi; v += step) out.add(v);
  }

  return out.size > 0 ? [...out].sort((a, b) => a - b) : null;
}

export function parseCron(expr: string): CronSpec | null {
  const fields = String(expr ?? "").trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [fMin, fHour, fDom, fMonth, fDow] = fields as [string, string, string, string, string];

  const minutes = parseField(fMin, { min: 0, max: 59 });
  const hours = parseField(fHour, { min: 0, max: 23 });
  const dom = parseField(fDom, { min: 1, max: 31 });
  const months = parseField(fMonth, { min: 1, max: 12, names: MONTH_NAMES });
  // 周允许写 7 表示周日，内部统一收敛成 0
  const rawDow = parseField(fDow, { min: 0, max: 7, names: DOW_NAMES });

  if (!minutes || !hours || !dom || !months || !rawDow) return null;

  const dow = [...new Set(rawDow.map((v) => (v === 7 ? 0 : v)))].sort((a, b) => a - b);

  return {
    source: fields.join(" "),
    minutes,
    hours,
    daysOfMonth: dom,
    months,
    daysOfWeek: dow,
    domRestricted: fDom !== "*" && fDom !== "?",
    dowRestricted: fDow !== "*" && fDow !== "?",
  };
}

export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null;
}

/**
 * 「日」与「周」同时被限定时按标准 cron 语义取**或**
 * （`0 3 1 * 1` = 每月 1 号 或 每周一，而不是取交集）。
 * 只限定其一时按限定那个算。
 */
function dayMatches(spec: CronSpec, d: Date): boolean {
  if (!spec.months.includes(d.getMonth() + 1)) return false;

  const domOk = spec.daysOfMonth.includes(d.getDate());
  const dowOk = spec.daysOfWeek.includes(d.getDay());

  if (spec.domRestricted && spec.dowRestricted) return domOk || dowOk;
  if (spec.domRestricted) return domOk;
  if (spec.dowRestricted) return dowOk;
  return true;
}

function truncateToMinute(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0, 0);
}

export function cronMatches(spec: CronSpec, d: Date): boolean {
  return (
    dayMatches(spec, d) &&
    spec.hours.includes(d.getHours()) &&
    spec.minutes.includes(d.getMinutes())
  );
}

/** 一个字段 / 一天内最早匹配的 HH:mm（不早于 cur 所在的分钟）；当天没有就返回 null */
function firstTimeOfDay(spec: CronSpec, cur: Date): Date | null {
  const h0 = cur.getHours();
  const m0 = cur.getMinutes();
  for (const h of spec.hours) {
    if (h < h0) continue;
    for (const m of spec.minutes) {
      if (h === h0 && m < m0) continue;
      return new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), h, m, 0, 0);
    }
  }
  return null;
}

/** 当天不晚于 cur 的最后一个 HH:mm */
function lastTimeOfDay(spec: CronSpec, cur: Date): Date | null {
  const h0 = cur.getHours();
  const m0 = cur.getMinutes();
  for (let i = spec.hours.length - 1; i >= 0; i -= 1) {
    const h = spec.hours[i] as number;
    if (h > h0) continue;
    for (let j = spec.minutes.length - 1; j >= 0; j -= 1) {
      const m = spec.minutes[j] as number;
      if (h === h0 && m > m0) continue;
      return new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), h, m, 0, 0);
    }
  }
  return null;
}

/** 往后找 2 年还没匹配上就认为「这个表达式基本不会触发」，返回 null */
const MAX_SCAN_DAYS = 731;

/** 下一次该跑的分钟（严格晚于 from 所在的那一分钟）。 */
export function nextCronRun(expr: string, from: Date = new Date()): Date | null {
  const spec = parseCron(expr);
  if (!spec) return null;

  // 从下一分钟开始找：同一分钟里再触发一次没有意义
  let cur = new Date(truncateToMinute(from).getTime() + 60_000);

  for (let i = 0; i < MAX_SCAN_DAYS; i += 1) {
    if (dayMatches(spec, cur)) {
      const hit = firstTimeOfDay(spec, cur);
      if (hit) return hit;
    }
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 0, 0, 0, 0);
  }
  return null;
}

/** 上一次该跑的分钟（含 from 所在的那一分钟）。调度器靠它判断「错过了没有」。 */
export function prevCronRun(expr: string, from: Date = new Date()): Date | null {
  const spec = parseCron(expr);
  if (!spec) return null;

  let cur = truncateToMinute(from);

  for (let i = 0; i < MAX_SCAN_DAYS; i += 1) {
    if (dayMatches(spec, cur)) {
      const hit = lastTimeOfDay(spec, cur);
      if (hit) return hit;
    }
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - 1, 23, 59, 0, 0);
  }
  return null;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 给人看的一句话解释。看不懂表达式时返回空串，调用方自己兜底。 */
export function describeCron(expr: string): string {
  const spec = parseCron(expr);
  if (!spec) return "";

  const { minutes, hours } = spec;

  let day: string;
  if (spec.dowRestricted && !spec.domRestricted) {
    day = `每${spec.daysOfWeek.map((d) => WEEKDAY_CN[d]).join("、")}`;
  } else if (spec.domRestricted && !spec.dowRestricted) {
    day = `每月 ${spec.daysOfMonth.join("、")} 号`;
  } else if (spec.domRestricted && spec.dowRestricted) {
    day = `每月 ${spec.daysOfMonth.join("、")} 号或每${spec.daysOfWeek
      .map((d) => WEEKDAY_CN[d])
      .join("、")}`;
  } else {
    day = "每天";
  }

  let time: string;
  if (minutes.length === 60 && hours.length === 24) {
    time = "每分钟";
  } else if (minutes.length === 60) {
    time = "每分钟";
  } else if (hours.length === 24) {
    time = minutes.length === 1 ? `每小时第 ${minutes[0]} 分` : `每小时的 ${minutes.join("、")} 分`;
  } else if (minutes.length === 1 && hours.length > 6) {
    time = `${hours[0]}:00 起每 ${(hours[1] as number) - (hours[0] as number)} 小时` ;
  } else if (minutes.length * hours.length <= 6) {
    const list: string[] = [];
    for (const h of hours) for (const m of minutes) list.push(`${pad2(h)}:${pad2(m)}`);
    time = list.join("、");
  } else {
    time = `${hours.length} 个整点（${hours.slice(0, 3).map(pad2).join("、")}…）的第 ${minutes
      .slice(0, 3)
      .map(pad2)
      .join("、")} 分`;
  }

  // 只在某几个月生效时补一句，否则「每月 1 号」会让人以为每月都跑
  const monthNote =
    spec.months.length < 12 ? `（仅 ${spec.months.map((m) => `${m} 月`).join("、")}）` : "";

  return `${day} ${time}${monthNote}`;
}

/** 设置页的常用预设。写死几套，比让人对着 cron 语法猜要友好得多 */
export const CRON_PRESETS: { label: string; expr: string }[] = [
  { label: "每天凌晨 3 点", expr: "0 3 * * *" },
  { label: "每 6 小时", expr: "0 */6 * * *" },
  { label: "每 12 小时", expr: "0 */12 * * *" },
  { label: "每周一凌晨 3 点", expr: "0 3 * * 1" },
  { label: "每月 1 号凌晨 3 点", expr: "0 3 1 * *" },
  { label: "工作日中午 12 点", expr: "0 12 * * 1-5" },
];

/** 把旧的「每天 HH:mm」转成等价的 cron，供老数据平滑升级 */
export function cronFromDailyTime(dailyTime: string): string | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(dailyTime.trim());
  if (!m) return null;
  return `${Number(m[2])} ${Number(m[1])} * * *`;
}
