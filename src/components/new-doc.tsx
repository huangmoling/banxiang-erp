"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ClipboardCheck,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Drawer } from "@/components/ui/drawer";
import { InboundForm } from "@/app/(app)/inbound/inbound-form";
import { OutboundForm } from "@/app/(app)/outbound/outbound-form";
import { ReturnForm } from "@/app/(app)/returns/return-form";
import { ScrapForm } from "@/app/(app)/scraps/scrap-form";
import { StocktakeForm } from "@/app/(app)/stocktakes/stocktake-form";
import type { InboundMeta } from "@/modules/inbound/inbound.types";
import type { OutboundMeta } from "@/modules/outbound/outbound.types";
import type { ReturnMeta } from "@/modules/returns/return.types";
import type { ScrapMeta } from "@/modules/scrap/scrap.types";
import type { StocktakeMeta } from "@/modules/stocktake/stocktake.types";

/**
 * 建单抽屉 —— 全站唯一的"新建单据"入口。
 *
 * 以前建单是跳到一个整页，建完再点回列表，筛选条件全丢；
 * 连续开五张单就要来回跳十次。现在统一从抽屉开，列表不动、位置不丢。
 *
 * 为什么在客户端取 meta：抽屉长在列表页里，列表页是客户端组件，
 * 拿不到服务端的 service。五个单据各自的 /api/{kind}/meta 本来就有，
 * 打开抽屉时才取——不打开就不花这一次请求。
 */

export type DocKind = "inbound" | "outbound" | "returns" | "scraps" | "stocktakes";

type DocSpec = {
  kind: DocKind;
  /** 磁贴/菜单里的名字 */
  label: string;
  /** 抽屉标题 */
  title: string;
  subtitle: string;
  metaUrl: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  /** 工作台磁贴色，和 07 令牌里的「类别色」一致 */
  color: string;
};

export const DOC_SPECS: DocSpec[] = [
  {
    kind: "inbound",
    label: "新建入库",
    title: "新建入库单",
    subtitle: "工厂到货就开单。保存草稿不动库存，审核后才加数。",
    metaUrl: "/api/inbound/meta",
    icon: ArrowDownToLine,
    color: "#1677FF",
  },
  {
    kind: "outbound",
    label: "新建出库",
    title: "新建出库单",
    subtitle: "一行就是一个包裹、一个买家。保存后按地址打印出货单。",
    metaUrl: "/api/outbound/meta",
    icon: ArrowUpFromLine,
    color: "#00A870",
  },
  {
    kind: "returns",
    label: "退货入库",
    title: "新建退货单",
    subtitle: "先找到原出库单，再在要退的行上填数量与去向。定制件只能进次品区或报废。",
    metaUrl: "/api/returns/meta",
    icon: Undo2,
    color: "#722ED1",
  },
  {
    kind: "scraps",
    label: "报废处置",
    title: "新建报废单",
    subtitle: "次品区的三条出路：报废 / 线下出售 / 自行处理。审核后从库里扣掉。",
    metaUrl: "/api/scraps/meta",
    icon: Trash2,
    color: "#CF1322",
  },
  {
    kind: "stocktakes",
    label: "库存盘点",
    title: "新建盘点单",
    subtitle: "选仓位、定截止时点，账面数列出来，你只管填实盘数。盘点期间照常发货。",
    metaUrl: "/api/stocktakes/meta",
    icon: ClipboardCheck,
    color: "#FA8C16",
  },
];

function specOf(kind: DocKind): DocSpec {
  return DOC_SPECS.find((s) => s.kind === kind) ?? DOC_SPECS[0]!;
}

function DocForm({
  kind,
  data,
  role,
  embedded,
  onCancel,
}: {
  kind: DocKind;
  data: unknown;
  role: string;
  embedded: boolean;
  onCancel: () => void;
}) {
  switch (kind) {
    case "inbound":
      return <InboundForm meta={data as InboundMeta} embedded={embedded} onCancel={onCancel} />;
    case "outbound":
      return (
        <OutboundForm
          meta={data as OutboundMeta}
          role={role}
          embedded={embedded}
          onCancel={onCancel}
        />
      );
    case "returns":
      return <ReturnForm meta={data as ReturnMeta} embedded={embedded} onCancel={onCancel} />;
    case "scraps":
      return (
        <ScrapForm
          meta={data as ScrapMeta}
          initialLocationId={null}
          presetSkuId={null}
          presetDisposition={null}
          embedded={embedded}
          onCancel={onCancel}
        />
      );
    case "stocktakes":
      return <StocktakeForm meta={data as StocktakeMeta} embedded={embedded} onCancel={onCancel} />;
  }
}

/** 抽屉本体：只在 open 时挂载，关掉就把表单连同状态一起丢掉 */
function NewDocDrawer({ kind, onClose }: { kind: DocKind | null; onClose: () => void }) {
  const [data, setData] = useState<unknown>(null);
  const [role, setRole] = useState("viewer");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const loadedFor = useRef<DocKind | null>(null);

  useEffect(() => {
    if (!kind) {
      loadedFor.current = null;
      setData(null);
      setError("");
      return;
    }
    if (loadedFor.current === kind) return;
    loadedFor.current = kind;
    let alive = true;
    setLoading(true);
    setError("");
    setData(null);

    const spec = specOf(kind);
    void (async () => {
      try {
        const [payload, me] = await Promise.all([
          api<unknown>(spec.metaUrl),
          // 出库要对内勤少给一个"直接审核"的按钮，按钮得知道角色
          kind === "outbound"
            ? api<{ user: { role: string } }>("/api/auth/me")
            : Promise.resolve(null),
        ]);
        if (!alive) return;
        setRole(me?.user.role ?? "viewer");
        setData(payload);
      } catch {
        if (alive) setError("没能加载建单需要的选项，请关掉重试；如果一直这样，刷新一下页面。");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [kind]);

  const spec = kind ? specOf(kind) : null;

  return (
    <Drawer
      open={kind !== null}
      onClose={onClose}
      title={spec?.title ?? ""}
      subtitle={spec?.subtitle}
      width={940}
    >
      {error ? (
        <div className="mb-3 rounded-[6px] bg-danger/[0.09] px-3 py-2.5 text-[12px] leading-5 text-danger">
          {error}
        </div>
      ) : null}

      {loading || !data || !kind ? (
        <div className="flex items-center gap-2 py-16 text-[12.5px] text-muted">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-brand" />
          正在准备表单…
        </div>
      ) : (
        <DocForm kind={kind} data={data} role={role} embedded onCancel={onClose} />
      )}
    </Drawer>
  );
}

/**
 * 用法：
 *   const newDoc = useNewDoc();
 *   <button onClick={() => newDoc.start("inbound")}>新建</button>
 *   {newDoc.drawer}
 */
export function useNewDoc() {
  const [kind, setKind] = useState<DocKind | null>(null);
  return {
    start: (k: DocKind) => setKind(k),
    close: () => setKind(null),
    drawer: <NewDocDrawer kind={kind} onClose={() => setKind(null)} />,
  };
}

/** 列表页页头那颗「新建 xx 单」按钮：点开就是抽屉 */
export function NewDocButton({
  kind,
  className = "btn-primary btn-sm",
  label,
}: {
  kind: DocKind;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState<DocKind | null>(null);
  const spec = specOf(kind);
  const Icon = spec.icon;
  return (
    <>
      <button type="button" onClick={() => setOpen(kind)} className={className}>
        <Icon size={14} strokeWidth={2} />
        {label ?? spec.label}
      </button>
      <NewDocDrawer kind={open} onClose={() => setOpen(null)} />
    </>
  );
}

/**
 * 顶栏的「＋ 新建」下拉：五张单一个入口。
 * 顶栏到处都在，等于任何页面都能三步之内开一张单。
 */
export function NewDocMenu() {
  const [menu, setMenu] = useState(false);
  const [kind, setKind] = useState<DocKind | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setMenu(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setMenu((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menu}
        className="flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[linear-gradient(135deg,rgb(var(--c-grad-1)),rgb(var(--c-grad-2))_55%,rgb(var(--c-grad-3))_125%)] px-3.5 text-[12.5px] font-semibold text-white shadow-[0_6px_16px_rgb(var(--c-grad-1)/0.32)] transition-all hover:brightness-110"
      >
        <Plus size={13} strokeWidth={2.4} />
        新建
        <ChevronDown size={12} strokeWidth={2.2} className="opacity-70" />
      </button>

      {menu ? (
        <div
          role="menu"
          className="sheet-in absolute right-0 top-9 z-50 w-[208px] overflow-hidden rounded-card border border-line bg-card p-1 shadow-pop"
        >
          {DOC_SPECS.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.kind}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  setKind(s.kind);
                }}
                className="flex w-full items-center gap-2.5 rounded-[5px] px-2 py-[7px] text-left text-[12.5px] text-ink transition-colors hover:bg-sunken"
              >
                <Icon size={14} strokeWidth={1.9} className="shrink-0 text-muted" />
                {s.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <NewDocDrawer kind={kind} onClose={() => setKind(null)} />
    </div>
  );
}
