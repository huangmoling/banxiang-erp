/**
 * 日期工具：全系统只处理「日期」不处理时区偏移。
 * 单据的业务日期、生产日期都按店铺所在时区的自然日理解，
 * 因此统一用本地年月日构造 Date，禁止用 new Date("2026-10-20")（会被当成 UTC）。
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-20" → 本地零点的 Date；非法日期返回 null（2 月 30 日不会被顺延） */
export function parseDateOnly(input: string): Date | null {
  const m = DATE_ONLY.exec(input.trim());
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);

  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/** Date → "2026-10-20"（按本地时区取年月日） */
export function formatDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 紧凑日期，用于单号与批次号：20261020 */
export function formatCompactDate(d: Date): string {
  return formatDateOnly(d).replace(/-/g, "");
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfMonth(d = new Date()): Date {
  const s = new Date(d);
  s.setDate(1);
  s.setHours(0, 0, 0, 0);
  return s;
}

export function todayDateOnly(): string {
  return formatDateOnly(new Date());
}

/** 同一自然日 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** ISO 时间 → "2026-10-20 15:04"（按本地时区，用于审核时间这类精确到分钟的场景） */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${formatDateOnly(d)} ${hh}:${mm}`;
}

/**
 * "2026-10-20T20:15" / "2026-10-20 20:15" / "2026-10-20T20:15:30" → 本地时间 Date。
 * datetime-local 输入框给的就是第一种格式，不能丢给 new Date()，
 * 否则带时区的字符串会被当成别的时区，盘点截止时点会整体偏出去。
 */
export function parseLocalDateTime(input: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input.trim());
  if (!m) return null;

  const [year, month, day, hour, minute, second] = [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  ];
  if (hour > 23 || minute > 59 || second > 59) return null;

  const d = new Date(year, month - 1, day, hour, minute, second, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/** Date → "2026-10-20T20:15"（datetime-local 输入框要的值） */
export function formatLocalDateTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${formatDateOnly(d)}T${hh}:${mm}`;
}

/** 当前时刻的 datetime-local 值，精确到分钟 */
export function nowLocalDateTime(): string {
  return formatLocalDateTime(new Date());
}

