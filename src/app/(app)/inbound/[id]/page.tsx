import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  FileText,
  Info,
  User,
  Warehouse,
} from "lucide-react";
import { inboundService } from "@/modules/inbound/inbound.service";
import { isAppError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import {
  DOC_STATUS_LABEL,
  DOC_STATUS_TONE,
  colorText,
  type InboundDocView,
} from "@/modules/inbound/inbound.types";
import { InboundDocActions } from "../inbound-doc-actions";

import { VoidedNotice } from "@/components/voided-notice";

export const dynamic = "force-dynamic";

export default async function InboundDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let doc: InboundDocView;
  try {
    doc = await inboundService.detail(id);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }

  const unit = doc.items[0]?.unit ?? "件";
  const user = await getSession();
  const canDelete = user?.role === "admin";
  const customQty = doc.items
    .filter((i) => i.variantType === "custom")
    .reduce((sum, i) => sum + i.qty, 0);

  return (
    <div className="space-y-4">
      <VoidedNotice
        voidedAt={doc.voidedAt}
        voidReason={doc.voidReason}
        voidedByName={doc.voidedByName}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href="/inbound"
            className="rounded-md p-1.5 text-muted hover:bg-line-2 hover:text-ink"
            title="返回入库列表"
          >
            <ArrowLeft size={16} />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="tnum text-[19px] font-semibold tracking-tight text-ink">{doc.docNo}</h1>
              <span className={`tag ${DOC_STATUS_TONE[doc.status]}`}>{DOC_STATUS_LABEL[doc.status]}</span>
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted">
              业务日期 {doc.bizDate} · {doc.itemCount} 行 · 合计 {doc.totalQty} {unit}
            </p>
          </div>
        </div>

        <InboundDocActions
          id={doc.id}
          docNo={doc.docNo}
          status={doc.status}
          totalQty={doc.totalQty}
          unit={unit}
          canDelete={canDelete}
        />
      </div>

      {doc.status === "draft" ? (
        <div className="flex items-start gap-2.5 rounded-card border border-[#f0e2c8] bg-warn-soft px-3.5 py-3 text-[12.5px] leading-5 text-[#8a5a15]">
          <CircleAlert size={15} className="mt-0.5 shrink-0" />
          <div>
            这张单还是草稿，<b>库存没有变动</b>。点右上角「审核入库」之后，{doc.totalQty} {unit} 才算真正入账。
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-card border border-[#cfe6d9] bg-ok-soft px-3.5 py-3 text-[12.5px] leading-5 text-[#1f6b46]">
          <Check size={15} className="mt-0.5 shrink-0" />
          <div>
            已生效：{doc.totalQty} {unit} 已入账
            {doc.approvedByName ? `，由 ${doc.approvedByName} 审核` : ""}
            {doc.approvedAt ? `（${formatDateTime(doc.approvedAt)}）` : ""}。
            {customQty > 0 ? ` 其中 ${customQty} 件定制款已生成唯一编号。` : ""}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* 明细 */}
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[14px] font-semibold text-ink">入库明细</h2>
            <span className="text-[11.5px] text-muted">一色一行 · 数量按各自单位</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[660px] border-collapse">
              <thead>
                <tr>
                  <th className="th w-[42px]">#</th>
                  <th className="th">产品 / 颜色</th>
                  <th className="th w-[84px] text-right">数量</th>
                  <th className="th w-[106px]">生产日期</th>
                  <th className="th w-[96px]">批次</th>
                  <th className="th w-[40%]">单件编号</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((item) => (
                  <tr key={item.id}>
                    <td className="td tnum text-muted">{item.lineNo}</td>
                    <td className="td">
                      <div className="font-medium text-ink">{item.productName}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                        <span className={item.colorName ? "text-ink-2" : ""}>{colorText(item.colorName)}</span>
                        {item.variantType === "custom" ? (
                          <span className="tag bg-[#fdf4e8] text-[#a15f12]">定制·按件</span>
                        ) : (
                          <span className="tag bg-[#f2f4f7] text-ink-2">常规·按数量</span>
                        )}
                      </div>
                    </td>
                    <td className="td tnum text-right font-medium">
                      {item.qty}
                      <span className="ml-0.5 text-[11.5px] font-normal text-muted">{item.unit}</span>
                    </td>
                    <td className="td tnum text-ink-2">{item.productionDate ?? "—"}</td>
                    <td className="td tnum text-[12.5px] text-ink-2">{item.batchNo ?? "—"}</td>
                    <td className="td">
                      {item.instanceCodes.length === 0 ? (
                        <span className="text-[12px] text-muted">
                          {item.variantType === "custom" ? "审核后生成" : "—"}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {item.instanceCodes.map((code) => (
                            <span key={code} className="tag tnum bg-brand-soft text-brand">
                              {code}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="td" />
                  <td className="td text-[12.5px] text-muted">合计 {doc.itemCount} 行</td>
                  <td className="td tnum text-right font-semibold">
                    {doc.totalQty}
                    <span className="ml-0.5 text-[11.5px] font-normal text-muted">{unit}</span>
                  </td>
                  <td className="td" colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* 单据信息 */}
        <div className="space-y-4">
          <section className="card p-4 sm:p-5">
            <h2 className="mb-3 text-[13.5px] font-semibold text-ink">单据信息</h2>
            <dl className="space-y-2.5 text-[12.5px]">
              <Row icon={FileText} label="单号" value={doc.docNo} mono />
              <Row icon={Info} label="业务日期" value={doc.bizDate} mono />
              <Row icon={Warehouse} label="入库仓位" value={doc.locationName ?? "—"} />
              <Row icon={User} label="制单人" value={doc.createdByName ?? "—"} />
              <Row
                icon={Check}
                label="审核"
                value={
                  doc.approvedByName
                    ? `${doc.approvedByName} · ${doc.approvedAt ? formatDateTime(doc.approvedAt) : ""}`
                    : "待审核"
                }
              />
            </dl>

            {doc.remark ? (
              <div className="mt-3 rounded-lg bg-[#fbfcfd] px-3 py-2.5 text-[12px] leading-5 text-ink-2">
                <div className="mb-0.5 text-[11.5px] text-muted">备注</div>
                {doc.remark}
              </div>
            ) : null}
          </section>

          <Link
            href="/inbound/new"
            className="flex items-center justify-between rounded-card border border-line bg-white px-4 py-3 text-[13px] text-ink transition-colors hover:border-[#d6dae1]"
          >
            再开一张入库单
            <ArrowRight size={14} className="text-muted" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={14} strokeWidth={1.7} className="mt-0.5 shrink-0 text-[#b9bfc9]" />
      <dt className="w-[62px] shrink-0 text-muted">{label}</dt>
      <dd className={`min-w-0 flex-1 text-ink ${mono ? "tnum" : ""}`}>{value}</dd>
    </div>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}
