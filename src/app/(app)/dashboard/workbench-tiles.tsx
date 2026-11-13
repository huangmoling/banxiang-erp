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

/**
 * 工作台的八个磁贴。
 *
 * 上排四个是「动作」，点下去直接拉建单抽屉（不跳页）；下排四个是「查询」，
 * 跳列表页。这是这一版最重要的一条操作习惯改动——开单不该打断你看列表。
 *
 * 客户端组件，因为它要调抽屉；数据由服务端页面传进来，不在这里取数。
 */

type TileProps = {
  label: string;
  sub: string;
  value?: string;
  color: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  href?: string;
  kind?: DocKind;
  onOpen?: (k: DocKind) => void;
};

function Tile({ label, sub, value, color, icon: Icon, href, kind, onOpen }: TileProps) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium leading-tight">{label}</span>
        <Icon size={15} strokeWidth={1.9} className="shrink-0 opacity-75" />
      </div>
      <div className="flex items-baseline justify-between gap-2">
        {value ? (
          <span className="tnum text-[19px] font-semibold leading-none tracking-[-0.02em]">
            {value}
          </span>
        ) : null}
        <span className={`tile-sub truncate ${value ? "text-[11px]" : "text-[11.5px]"}`}>
          {sub}
        </span>
      </div>
    </>
  );

  const cls = "tile";
  const style = { background: color };

  if (kind && onOpen) {
    return (
      <button type="button" onClick={() => onOpen(kind)} className={`${cls} text-left`} style={style}>
        {inner}
      </button>
    );
  }
  return (
    <Link href={href ?? "#"} className={cls} style={style}>
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
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile
          kind="inbound"
          onOpen={newDoc.start}
          label="新建入库"
          sub="工厂到货"
          color="#2563EB"
          icon={ArrowDownToLine}
        />
        <Tile
          kind="outbound"
          onOpen={newDoc.start}
          label="新建出库"
          sub={pendingPackages > 0 ? `${pendingPackages} 个待发` : "发货开单"}
          color="#0E8577"
          icon={ArrowUpFromLine}
        />
        <Tile
          kind="returns"
          onOpen={newDoc.start}
          label="退货入库"
          sub="退回的货"
          color="#7C5CD6"
          icon={Undo2}
        />
        <Tile
          kind="stocktakes"
          onOpen={newDoc.start}
          label="库存盘点"
          sub="数一遍"
          color="#A6641F"
          icon={ClipboardCheck}
        />

        <Tile
          href="/products"
          label="商品档案"
          sub="款 / 颜色"
          value={`${productsTotal}`}
          color="#2F5578"
          icon={Package}
        />
        <Tile
          href="/inventory"
          label="库存明细"
          sub="可售"
          value={`${onHand}`}
          color="#2A6350"
          icon={Warehouse}
        />
        <Tile
          href="/defective"
          label="次品区"
          sub={defective > 0 ? "待处置" : "空"}
          value={`${defective}`}
          color="#7E3D33"
          icon={TriangleAlert}
        />
        <Tile
          href="/reports"
          label="报表中心"
          sub="出入库统计"
          color="#4B3A63"
          icon={ChartColumnBig}
        />
      </div>
      {newDoc.drawer}
    </>
  );
}
