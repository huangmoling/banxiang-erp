"use client";

import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChartColumnBig,
  ClipboardCheck,
  Package,
  Trash2,
  TriangleAlert,
  Undo2,
  Warehouse,
} from "lucide-react";
import { useNewDoc, type DocKind } from "@/components/new-doc";

/* 金蝶式快捷入口：白卡 + 彩色图标块，上排开单、下排查询，功能与原版一致 */
type TileProps = {
  label: string;
  sub: string;
  value?: string;
  /** 1–8，对应 globals.css 里的 --c-a1…--c-a8，跟着主题换色 */
  accent: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  href?: string;
  kind?: DocKind;
  onOpen?: (k: DocKind) => void;
};

function Tile({ label, sub, value, accent, icon: Icon, href, kind, onOpen }: TileProps) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-[4px]"
          style={{ background: `rgb(var(--c-a${accent}) / 0.1)`, color: `rgb(var(--c-a${accent}))` }}
        >
          <Icon size={18} strokeWidth={1.9} />
        </span>
        {value ? (
          <span className="tnum text-[20px] font-semibold leading-none tracking-[-0.02em] text-ink">{value}</span>
        ) : null}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13.5px] font-semibold leading-tight text-ink">{label}</span>
        <span className="tile-sub truncate text-[11.5px]">{sub}</span>
      </div>
    </>
  );
  if (kind && onOpen) {
    return (
      <button type="button" onClick={() => onOpen(kind)} className="tile text-left">
        {inner}
      </button>
    );
  }
  return (
    <Link href={href ?? "#"} className="tile">
      {inner}
    </Link>
  );
}

export function WorkbenchTiles({
  pendingPackages,
  productsTotal,
  onHand,
  defective,
}: {
  pendingPackages: number;
  productsTotal: number;
  onHand: number;
  defective: number;
}) {
  const newDoc = useNewDoc();
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Tile kind="inbound" onOpen={newDoc.start} label="新建入库" sub="工厂到货" accent={1} icon={ArrowDownToLine} />
        <Tile kind="outbound" onOpen={newDoc.start} label="新建出库" sub={pendingPackages > 0 ? `${pendingPackages} 个待发` : "发货开单"} accent={2} icon={ArrowUpFromLine} />
        <Tile kind="returns" onOpen={newDoc.start} label="退货入库" sub="退回的货" accent={3} icon={Undo2} />
        <Tile kind="stocktakes" onOpen={newDoc.start} label="库存盘点" sub="数一遍" accent={4} icon={ClipboardCheck} />
        <Tile href="/products" label="商品档案" sub="款 / 颜色" value={`${productsTotal}`} accent={5} icon={Package} />
        <Tile href="/inventory" label="库存明细" sub="可售" value={`${onHand}`} accent={6} icon={Warehouse} />
        <Tile href="/defective" label="次品区" sub={defective > 0 ? "待处置" : "空"} value={`${defective}`} accent={7} icon={TriangleAlert} />
        <Tile href="/reports" label="报表中心" sub="出入库统计" accent={8} icon={ChartColumnBig} />
      </div>
      {newDoc.drawer}
    </>
  );
}
