/**
 * CSV 生成工具。
 * 仓库这边导出的表格最后一定是用 Excel / WPS 双击打开的，
 * 所以必须带 UTF-8 BOM，否则「米白」会变成一串乱码——这种问题解释一百遍也没用，直接做对。
 */

export type CsvCell = string | number | null | undefined;

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // 逗号、引号、换行都得包起来；引号本身双写
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCell).join(","));
  // 用 CRLF：Excel 对 LF 的兼容性差一些
  return lines.join("\r\n");
}

/** 下载响应：BOM + CSV，文件名走 RFC 5987 编码以支持中文 */
export function csvResponse(filename: string, headers: string[], rows: CsvCell[][]): Response {
  const body = `\uFEFF${toCsv(headers, rows)}`;
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${asciiFallback(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}

/** 老浏览器 / 下载工具不认识 filename* 时退回纯 ASCII，至少别让文件名变成乱码 */
function asciiFallback(filename: string): string {
  return filename.replace(/[^\x20-\x7e]/g, "_");
}

/** 带日期的文件名：库存明细-20261021.csv */
export function datedFilename(name: string, date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${name}-${y}${m}${d}.csv`;
}
