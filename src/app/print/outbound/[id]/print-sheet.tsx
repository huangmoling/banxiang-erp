"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { formatDateTime } from "@/lib/date";
import { colorText, type OutboundDocView, type OutboundItemView } from "@/modules/outbound/outbound.types";

type Mode = "pick" | "label";
type Scope = "unshipped" | "shipped" | "all";

type Group = {
  /** 组内第一个行号，决定打印顺序，也用来做「包裹 03」这种序号 */
  firstLineNo: number;
  receiver: string;
  items: OutboundItemView[];
  qty: number;
};

/**
 * 按收货地址分组：一个地址 = 一个包裹 = 一张纸。
 * 同一个买家买了两件（两行、同一段地址），会合成一组，不重复出纸。
 */
function buildGroups(doc: OutboundDocView, scope: Scope): Group[] {
  const rows = doc.items.filter((i) =>
    scope === "all" ? true : scope === "shipped" ? i.shipped : !i.shipped,
  );

  const map = new Map<string, Group>();
  for (const item of rows) {
    const key = (item.receiverInfo ?? "").trim().replace(/\s+/g, " ") || "__none__";
    const group = map.get(key);
    if (group) {
      group.items.push(item);
      group.qty += item.qty;
    } else {
      map.set(key, {
        firstLineNo: item.lineNo,
        receiver: item.receiverInfo ?? "",
        items: [item],
        qty: item.qty,
      });
    }
  }

  return [...map.values()].sort((a, b) => a.firstLineNo - b.firstLineNo);
}

export function PrintSheet({
  doc,
  mode,
  scope,
}: {
  doc: OutboundDocView;
  mode: Mode;
  scope: Scope;
}) {
  const [m, setM] = useState<Mode>(mode);
  const [s, setS] = useState<Scope>(scope);

  const groups = useMemo(() => buildGroups(doc, s), [doc, s]);
  const unit =
    new Set(doc.items.map((i) => i.unit)).size === 1 ? (doc.items[0]?.unit ?? "件") : "件";
  const totalQty = groups.reduce((sum, g) => sum + g.qty, 0);
  const missing = groups.filter((g) => !g.receiver.trim()).length;

  useEffect(() => {
    const prev = document.title;
    document.title = `${m === "label" ? "箱贴" : "出货单"} ${doc.docNo}`;
    return () => {
      document.title = prev;
    };
  }, [m, doc.docNo]);

  return (
    <>
      <style>{printCss(m)}</style>

      {/* 工具条只在屏幕上出现，打印时自动隐藏 */}
      <div className="p-toolbar">
        <div className="p-toolbar-inner">
          <Link href={`/outbound/${doc.id}`} className="p-toolbar-link">
            <ArrowLeft size={14} /> 返回单据
          </Link>

          <div className="p-seg">
            <button type="button" className={m === "pick" ? "on" : ""} onClick={() => setM("pick")}>
              出货单（A4）
            </button>
            <button type="button" className={m === "label" ? "on" : ""} onClick={() => setM("label")}>
              箱贴（每箱一张）
            </button>
          </div>

          <div className="p-seg">
            <button type="button" className={s === "unshipped" ? "on" : ""} onClick={() => setS("unshipped")}>
              还没发的
            </button>
            <button type="button" className={s === "shipped" ? "on" : ""} onClick={() => setS("shipped")}>
              已发的（补打）
            </button>
            <button type="button" className={s === "all" ? "on" : ""} onClick={() => setS("all")}>
              全部
            </button>
          </div>

          <span className="p-toolbar-hint">
            {groups.length} 个包裹 · {totalQty} {unit}
          </span>

          <button type="button" className="p-print-btn" onClick={() => window.print()}>
            <Printer size={14} /> 打印
          </button>
        </div>

        {missing > 0 ? (
          <div className="p-warn">
            有 {missing} 个包裹还没填收货地址，打出来没法贴。先回单据补上。
          </div>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <div className="p-empty">
          这个范围里没有可打的包裹。换一下上面的筛选条件试试。
        </div>
      ) : m === "pick" ? (
        <div className="p-sheet">
          <header className="p-head">
            <div>
              <div className="p-brand">半巷设计 · 出货单</div>
              <div className="p-docno">{doc.docNo}</div>
            </div>
            <div className="p-head-meta">
              <div>业务日期 {doc.bizDate}</div>
              <div>
                共 {groups.length} 个包裹 · {totalQty} {unit}
              </div>
              <div>制单 {doc.createdByName ?? "—"}</div>
            </div>
          </header>

          <div className="p-note">每块是一个包裹：按地址把货找齐，勾上方框，打包贴单。</div>

          <div className="p-groups">
            {groups.map((g, index) => (
              <section key={g.firstLineNo} className="p-group">
                <div className="p-group-head">
                  <span className="p-box" />
                  <span className="p-pkg">包裹 {String(index + 1).padStart(2, "0")}</span>
                  <span className="p-pkg-code">
                    {doc.docNo}-{String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className="p-receiver">
                  {g.receiver.trim() ? g.receiver : "（未填收货地址）"}
                </div>
                <table className="p-items">
                  <tbody>
                    {g.items.map((item) => (
                      <tr key={item.id}>
                        <td className="p-item-name">
                          {item.productName}
                          <span className="p-item-color"> {colorText(item.colorName)}</span>
                        </td>
                        <td className="p-item-qty">
                          ×{item.qty} {item.unit}
                        </td>
                        <td className="p-item-note">
                          {item.instanceCodes.length > 0
                            ? item.instanceCodes.join("、")
                            : (item.remark ?? "")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {g.items.some((i) => i.trackingNo) ? (
                  <div className="p-tracking">
                    物流单号：{g.items.map((i) => i.trackingNo).filter(Boolean).join(" / ")}
                  </div>
                ) : null}
              </section>
            ))}
          </div>

          <footer className="p-foot">
            <span>拣货人 ____________</span>
            <span>打包人 ____________</span>
            <span>日期 ____________</span>
          </footer>
        </div>
      ) : (
        groups.map((g, index) => (
          <div key={g.firstLineNo} className="p-label">
            <div className="p-label-top">
              <span className="p-label-brand">半巷设计</span>
              <span className="p-label-code">
                {doc.docNo}-{String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <div className="p-label-receiver">{g.receiver.trim() || "（未填收货地址）"}</div>
            <div className="p-label-items">
              {g.items.map((item) => (
                <div key={item.id}>
                  {item.productName}
                  <span className="p-item-color"> {colorText(item.colorName)}</span> ×{item.qty}{" "}
                  {item.unit}
                </div>
              ))}
            </div>
            <div className="p-label-foot">
              共 {g.items.reduce((n, i) => n + i.qty, 0)} 件 · {doc.bizDate}
            </div>
          </div>
        ))
      )}
    </>
  );
}

/** 打印样式：A4 出货单 / 100×150mm 箱贴，两套 @page 分开写 */
function printCss(mode: Mode): string {
  const page = mode === "label" ? "@page{size:100mm 150mm;margin:0}" : "@page{size:A4;margin:12mm}";
  return `
.p-toolbar{position:sticky;top:0;z-index:20;background:#f6f7f9;border-bottom:1px solid #e6e8ec;padding:10px 16px}
.p-toolbar-inner{max-width:210mm;margin:0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:12.5px}
.p-toolbar-link{display:inline-flex;align-items:center;gap:4px;color:#525a68;text-decoration:none}
.p-toolbar-link:hover{color:#3b5bdb}
.p-toolbar-hint{color:#8a929f;margin-left:auto}
.p-seg{display:inline-flex;border:1px solid #e6e8ec;border-radius:8px;background:#fff;padding:2px}
.p-seg button{border:none;background:transparent;padding:4px 9px;font-size:12px;color:#525a68;border-radius:6px;cursor:pointer}
.p-seg button.on{background:#eef1fd;color:#3b5bdb;font-weight:600}
.p-print-btn{display:inline-flex;align-items:center;gap:5px;background:#3b5bdb;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:12.5px;cursor:pointer}
.p-warn{max-width:210mm;margin:8px auto 0;background:#fdf1f1;border:1px solid #f3cfc9;color:#8f2c1f;border-radius:8px;padding:7px 11px;font-size:12px}
.p-empty{max-width:210mm;margin:40px auto;text-align:center;color:#8a929f;font-size:13px}

.p-sheet{width:210mm;min-height:297mm;margin:14px auto 24px;background:#fff;padding:12mm;
  box-shadow:0 1px 4px rgba(20,25,35,.10);color:#111;font-size:10.5pt;line-height:1.5}
.p-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1.5px solid #111;padding-bottom:6px}
.p-brand{font-size:13pt;font-weight:700;letter-spacing:.02em}
.p-docno{font-size:11pt;margin-top:2px;font-variant-numeric:tabular-nums}
.p-head-meta{text-align:right;font-size:9pt;color:#333;line-height:1.6}
.p-note{margin:6px 0 10px;font-size:9pt;color:#666}
.p-groups{display:flex;flex-direction:column;gap:6px}
.p-group{border:1px solid #cfd4dc;border-radius:4px;padding:6px 8px;break-inside:avoid;page-break-inside:avoid}
.p-group-head{display:flex;align-items:center;gap:7px;margin-bottom:3px}
.p-box{width:11px;height:11px;border:1.2px solid #333;display:inline-block;flex:none}
.p-pkg{font-size:10pt;font-weight:700}
.p-pkg-code{margin-left:auto;font-size:8.5pt;color:#666;font-variant-numeric:tabular-nums}
.p-receiver{font-size:10pt;font-weight:600;white-space:pre-line;word-break:break-word;line-height:1.45}
.p-items{width:100%;border-collapse:collapse;margin-top:3px}
.p-items td{font-size:9.5pt;padding:2px 0;border-top:1px dashed #e2e5ea}
.p-item-name{font-weight:600}
.p-item-color{font-weight:400;color:#444}
.p-item-qty{width:70px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.p-item-note{width:26%;color:#666;text-align:right;font-size:8.5pt}
.p-tracking{margin-top:2px;font-size:8.5pt;color:#444;font-variant-numeric:tabular-nums}
.p-foot{margin-top:14px;padding-top:8px;border-top:1px solid #cfd4dc;display:flex;gap:22px;font-size:9pt;color:#444}

.p-label{width:100mm;height:150mm;box-sizing:border-box;margin:14px auto;padding:6mm;background:#fff;
  border:1px solid #cfd4dc;color:#111;display:flex;flex-direction:column;break-after:page;page-break-after:always}
.p-label:last-child{break-after:auto;page-break-after:auto}
.p-label-top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #111;padding-bottom:3mm}
.p-label-brand{font-size:10pt;font-weight:700;letter-spacing:.06em}
.p-label-code{font-size:9pt;font-variant-numeric:tabular-nums}
.p-label-receiver{flex:1;margin-top:4mm;font-size:13pt;font-weight:700;line-height:1.55;white-space:pre-line;word-break:break-word}
.p-label-items{border-top:1px dashed #999;padding-top:2.5mm;font-size:9.5pt;line-height:1.6}
.p-label-foot{margin-top:2mm;font-size:8.5pt;color:#555;text-align:right}

@media print{
  html,body{background:#fff !important;margin:0 !important;padding:0 !important}
  .p-toolbar{display:none !important}
  .p-sheet{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}
  .p-label{margin:0;border:none}
  .p-groups{gap:4px}
}
${page}
`;
}
