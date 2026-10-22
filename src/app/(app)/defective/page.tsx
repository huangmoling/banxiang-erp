import Link from "next/link";
import { ArrowRight, PackageOpen, Undo2 } from "lucide-react";
import { scrapService } from "@/modules/scrap/scrap.service";
import { colorText } from "@/modules/scrap/scrap.types";

export const dynamic = "force-dynamic";

/**
 * 次品区：退货里判定为「不可二次销售」的货都堆在这里。
 * 这一页存在的意义只有一个——让这些货必须走出去。
 * 不给「转回良品架」，因为那等于自己骗自己：定制件退回来就是卖不掉了。
 */
export default async function DefectivePage() {
  const meta = await scrapService.meta();
  const defectiveId = meta.defectiveId;

  const stock = defectiveId ? await scrapService.stock(defectiveId).catch(() => null) : null;
  const rows = stock?.rows ?? [];
  const totalQty = stock?.total ?? 0;
  const customCount = rows.filter((r) => r.variantType === "custom").length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-semibold text-ink">次品区</h1>
        <p className="mt-1 text-[13px] text-muted">
          退货判定为不能二次销售的货都在这里。它不计入可售库存，也不会自己消失——
          每条都得走一条出路。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card px-4 py-3">
          <p className="text-[12.5px] text-muted">在区件数</p>
          <p className="tnum mt-1 text-[28px] font-semibold text-ink">{totalQty}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[12.5px] text-muted">在区款数</p>
          <p className="tnum mt-1 text-[28px] font-semibold text-ink">{rows.length}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[12.5px] text-muted">其中定制款</p>
          <p className="tnum mt-1 text-[28px] font-semibold text-ink">{customCount}</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <p className="text-[13px] font-medium text-ink-2">在区明细</p>
          <div className="flex gap-2">
            <Link href="/scraps?status=approved" className="btn-ghost btn-sm">
              <Undo2 size={13} />
              处置记录
            </Link>
            <Link href="/scraps/new" className="btn-primary btn-sm">
              新建处置单
              <ArrowRight size={13} />
            </Link>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <PackageOpen size={22} className="mx-auto text-muted" />
            <p className="mt-3 text-[13.5px] text-ink-2">次品区是空的</p>
            <p className="mt-1.5 text-[12.5px] text-muted">
              退货时选了「次品区」的货会出现在这里。
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">商品 / 颜色</th>
                <th className="th w-[90px] text-right">在区</th>
                <th className="th w-[240px]">件号</th>
                <th className="th w-[300px]">怎么出去</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const base = `/scraps/new?locationId=${encodeURIComponent(defectiveId ?? "")}&skuId=${encodeURIComponent(row.skuId)}`;
                return (
                  <tr key={row.skuId}>
                    <td className="td">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{row.productName}</span>
                        <span className="text-muted">·</span>
                        <span>{colorText(row.colorName)}</span>
                        {row.variantType === "custom" ? (
                          <span className="tag bg-[#f0f2fb] text-brand-ink">定制 · 按件</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="td tnum text-right font-medium">
                      {row.qty} {row.unit}
                    </td>
                    <td className="td text-[12px] text-ink-2">
                      {row.instances.length > 0
                        ? row.instances
                            .map((i) => (i.reservedBy ? `${i.code}(占用)` : i.code))
                            .join("、")
                        : "—"}
                    </td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1.5">
                        <Link
                          href={`${base}&disposition=scrap`}
                          className="rounded-md border border-line px-2 py-1 text-[12px] text-ink-2 transition-colors hover:border-[#d6dae1] hover:text-ink"
                        >
                          转报废
                        </Link>
                        <Link
                          href={`${base}&disposition=offline_sale`}
                          className="rounded-md border border-line px-2 py-1 text-[12px] text-ink-2 transition-colors hover:border-[#d6dae1] hover:text-ink"
                        >
                          线下出售
                        </Link>
                        <Link
                          href={`${base}&disposition=self_dispose`}
                          className="rounded-md border border-line px-2 py-1 text-[12px] text-ink-2 transition-colors hover:border-[#d6dae1] hover:text-ink"
                        >
                          自行处理
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-card border border-line bg-[#fbfcfd] px-4 py-3.5 text-[12.5px] leading-6 text-muted">
        <p className="mb-1 font-medium text-ink-2">为什么这里没有「改判回良品架」</p>
        <p>
          定制件退回来之后基本不可能再卖出去，常规件进次品区也意味着有破损。
          允许改判回可售库存，等于给「把次品当好货发出去」开了个后门。
          要消化就三条路：报废、线下出售、自行处理——每条都有记录，谁都赖不掉。
        </p>
      </div>
    </div>
  );
}
