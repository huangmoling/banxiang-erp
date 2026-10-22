import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { formatDateTime } from "@/lib/date";
import { VoidedNotice } from "@/components/voided-notice";
import { scrapService } from "@/modules/scrap/scrap.service";
import {
  DISPOSITION_LABEL,
  DISPOSITION_TONE,
  DOC_STATUS_LABEL,
  DOC_STATUS_TONE,
  colorText,
  type Disposition,
} from "@/modules/scrap/scrap.types";
import { ScrapDocActions } from "../scrap-doc-actions";

export const dynamic = "force-dynamic";

export default async function ScrapDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const doc = await scrapService.detail(id).catch(() => null);
  if (!doc) notFound();

  const byDisposition = doc.items.reduce<Record<Disposition, number>>(
    (acc, item) => {
      acc[item.disposition] += item.qty;
      return acc;
    },
    { scrap: 0, offline_sale: 0, self_dispose: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link href="/scraps" className="btn-ghost btn-sm" aria-label="返回列表">
            <ArrowLeft size={14} />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="tnum text-[19px] font-semibold text-ink">{doc.docNo}</h1>
              <span className={`tag ${DOC_STATUS_TONE[doc.status]}`}>
                {DOC_STATUS_LABEL[doc.status]}
              </span>
              {doc.fromDefective ? (
                <span className="tag bg-[#fdf1f1] text-[#b4433a]">来自次品区</span>
              ) : null}
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {doc.bizDate} · 从「{doc.sourceLocationName ?? "—"}」出去 · 共 {doc.totalQty} 件
            </p>
          </div>
        </div>

        <ScrapDocActions
          id={doc.id}
          docNo={doc.docNo}
          status={doc.status}
          totalQty={doc.totalQty}
          unit="件"
        />
      </div>

      <VoidedNotice
        voidedAt={doc.voidedAt}
        voidReason={doc.voidReason}
        voidedByName={doc.voidedByName}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {(["scrap", "offline_sale", "self_dispose"] as Disposition[]).map((d) => (
          <div key={d} className="card px-4 py-3">
            <p className="text-[12.5px] text-muted">{DISPOSITION_LABEL[d]}</p>
            <p className="tnum mt-1 text-[24px] font-semibold text-ink">
              {byDisposition[d]}
              <span className="ml-1 text-[13px] font-normal text-muted">件</span>
            </p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th w-[50px]">#</th>
              <th className="th">商品 / 颜色</th>
              <th className="th w-[100px] text-right">数量</th>
              <th className="th w-[110px]">处理方式</th>
              <th className="th w-[180px]">件号</th>
              <th className="th">说明</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((item) => (
              <tr key={item.id}>
                <td className="td tnum text-muted">{item.lineNo}</td>
                <td className="td">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{item.productName}</span>
                    <span className="text-muted">·</span>
                    <span>{colorText(item.colorName)}</span>
                  </div>
                </td>
                <td className="td tnum text-right font-medium">
                  {item.qty} {item.unit}
                </td>
                <td className="td">
                  <span className={`tag ${DISPOSITION_TONE[item.disposition]}`}>
                    {DISPOSITION_LABEL[item.disposition]}
                  </span>
                </td>
                <td className="td text-[12.5px] text-ink-2">
                  {item.instanceCodes.length > 0 ? item.instanceCodes.join("、") : "—"}
                </td>
                <td className="td text-ink-2">{item.remark || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card px-4 py-3.5">
        <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="w-[76px] shrink-0 text-muted">建单人</dt>
            <dd className="text-ink-2">{doc.createdByName ?? "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-[76px] shrink-0 text-muted">建档时间</dt>
            <dd className="tnum text-ink-2">{formatDateTime(doc.createdAt)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-[76px] shrink-0 text-muted">审核人</dt>
            <dd className="text-ink-2">
              {doc.approvedByName ?? "—"}
              {doc.approvedAt ? ` · ${formatDateTime(doc.approvedAt)}` : ""}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-[76px] shrink-0 text-muted">整单备注</dt>
            <dd className="text-ink-2">{doc.remark || "—"}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-card border border-line bg-[#fbfcfd] px-4 py-3.5">
        <p className="text-[12.5px] font-medium text-ink-2">三种处理方式在账上的区别</p>
        <ul className="mt-1.5 space-y-1 text-[12.5px] leading-5 text-muted">
          <li>· 转报废：货还在仓库（进报废区），本月损耗统计里能看到；</li>
          <li>· 线下出售：货已经卖掉离场，系统只记数量和去向，不记价格；</li>
          <li>· 自行处理：送人 / 拆解 / 丢弃，必须写清怎么处理的，一年后还查得出来。</li>
        </ul>
      </div>
    </div>
  );
}
