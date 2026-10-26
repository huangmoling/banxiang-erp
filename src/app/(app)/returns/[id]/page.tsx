import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  FileText,
  Info,
  Undo2,
  User,
  Warehouse,
} from "lucide-react";
import { returnService } from "@/modules/returns/return.service";
import { isAppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/date";
import {
  DESTINATION_LABEL,
  DESTINATION_TONE,
  DOC_STATUS_LABEL,
  DOC_STATUS_TONE,
  colorText,
  type ReturnDestination,
  type ReturnDocView,
} from "@/modules/returns/return.types";
import { ReturnDocActions } from "../return-doc-actions";

import { VoidedNotice } from "@/components/voided-notice";

export const dynamic = "force-dynamic";

export default async function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let doc: ReturnDocView;
  try {
    doc = await returnService.detail(id);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }

  const unit = doc.items[0]?.unit ?? "件";
  const dests = (Object.keys(doc.destinationQty) as ReturnDestination[]).filter(
    (d) => doc.destinationQty[d] > 0,
  );

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
            href="/returns"
            className="rounded-md p-1.5 text-muted hover:bg-line-2 hover:text-ink"
            title="返回退货列表"
          >
            <ArrowLeft size={16} />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="tnum text-[19px] font-semibold tracking-tight text-ink">{doc.docNo}</h1>
              <span className={`tag ${DOC_STATUS_TONE[doc.status]}`}>{DOC_STATUS_LABEL[doc.status]}</span>
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted">
              退货日期 {doc.bizDate} · {doc.itemCount} 行 · 合计 {doc.totalQty} {unit}
            </p>
          </div>
        </div>

        <ReturnDocActions
          id={doc.id}
          docNo={doc.docNo}
          status={doc.status}
          totalQty={doc.totalQty}
          unit={unit}
        />
      </div>

      {doc.status === "draft" ? (
        <div className="flex items-start gap-2.5 rounded-card border border-warn/40 bg-warn-soft px-3.5 py-3 text-[12.5px] leading-5 text-warn">
          <CircleAlert size={15} className="mt-0.5 shrink-0" />
          <div>
            这张单还是草稿，<b>库存没有变动</b>。点右上角「审核入库」之后，{doc.totalQty} {unit} 才会按去向回到对应仓位。
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-card border border-ok/40 bg-ok-soft px-3.5 py-3 text-[12.5px] leading-5 text-ok">
          <Check size={15} className="mt-0.5 shrink-0" />
          <div>
            已生效：{doc.totalQty} {unit} 已按去向入库
            {doc.approvedByName ? `，由 ${doc.approvedByName} 审核` : ""}
            {doc.approvedAt ? `（${formatDateTime(doc.approvedAt)}）` : ""}。
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* 明细 */}
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="text-[14px] font-semibold text-ink">退货明细</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {dests.map((d) => (
                <span key={d} className={`tag tnum ${DESTINATION_TONE[d]}`}>
                  {DESTINATION_LABEL[d]} {doc.destinationQty[d]}
                </span>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse">
              <thead>
                <tr>
                  <th className="th w-[42px]">#</th>
                  <th className="th">产品 / 颜色</th>
                  <th className="th w-[76px] text-right">退货数量</th>
                  <th className="th w-[92px]">去向</th>
                  <th className="th w-[96px]">原单行</th>
                  <th className="th w-[34%]">退回的件</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((item) => (
                  <tr key={item.id}>
                    <td className="td tnum text-muted">{item.lineNo}</td>
                    <td className="td">
                      <div className="font-medium text-ink">{item.productName}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                        <span className={item.colorName ? "text-ink-2" : ""}>
                          {colorText(item.colorName)}
                        </span>
                        {item.variantType === "custom" ? (
                          <span className="tag bg-warn-soft text-warn">定制·按件</span>
                        ) : (
                          <span className="tag bg-sunken text-ink-2">常规·按数量</span>
                        )}
                      </div>
                    </td>
                    <td className="td tnum text-right font-medium">
                      {item.qty}
                      <span className="ml-0.5 text-[11.5px] font-normal text-muted">{item.unit}</span>
                    </td>
                    <td className="td">
                      <span className={`tag ${DESTINATION_TONE[item.destination]}`}>
                        {DESTINATION_LABEL[item.destination]}
                      </span>
                    </td>
                    <td className="td tnum text-[12px] text-ink-2">
                      {item.originLineNo === null ? (
                        "—"
                      ) : (
                        <span title={`原单发了 ${item.originQty}，已退 ${item.originReturnedQty}`}>
                          第 {item.originLineNo} 行
                        </span>
                      )}
                    </td>
                    <td className="td">
                      {item.instanceCodes.length === 0 ? (
                        <span className="text-[12px] text-muted">
                          {item.variantType === "custom" ? "无" : "—"}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {item.instanceCodes.map((code) => (
                            <span key={code} className="tag tnum bg-brand-soft text-brand-ink">
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
              <Row icon={Info} label="退货日期" value={doc.bizDate} mono />
              <div className="flex items-start gap-2.5">
                <Undo2 size={14} strokeWidth={1.7} className="mt-0.5 shrink-0 text-muted" />
                <dt className="w-[62px] shrink-0 text-muted">原出库单</dt>
                <dd className="min-w-0 flex-1">
                  {doc.originDocumentId && doc.originDocNo ? (
                    <Link
                      href={`/outbound/${doc.originDocumentId}`}
                      className="tnum text-brand-ink hover:underline"
                      title="查看原出库单"
                    >
                      {doc.originDocNo}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </dd>
              </div>
              <Row icon={Warehouse} label="淘宝单号" value={doc.externalNo ?? "—"} mono />
              <Row icon={Warehouse} label="退回物流" value={doc.trackingNo ?? "—"} mono />
              <Row icon={User} label="退回人" value={doc.receiverName ?? "—"} />
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
              <div className="mt-3 rounded-lg bg-sunken px-3 py-2.5 text-[12px] leading-5 text-ink-2">
                <div className="mb-0.5 text-[11.5px] text-muted">备注</div>
                {doc.remark}
              </div>
            ) : null}
          </section>

          <div className="rounded-card border border-line bg-card px-4 py-3 text-[12px] leading-[1.85] text-ink-2">
            <div className="mb-1 text-[11.5px] text-muted">这件货后续</div>
            次品区的货不计入可售库存，可以线下出售或转报废（后续阶段开放）。
            良品回架的货已经回到主仓，可以正常发货。
          </div>

          <Link
            href="/returns/new"
            className="flex items-center justify-between rounded-card border border-line bg-card px-4 py-3 text-[13px] text-ink transition-colors hover:border-line"
          >
            再开一张退货单
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
      <Icon size={14} strokeWidth={1.7} className="mt-0.5 shrink-0 text-muted" />
      <dt className="w-[62px] shrink-0 text-muted">{label}</dt>
      <dd className={`min-w-0 flex-1 text-ink ${mono ? "tnum" : ""}`}>{value}</dd>
    </div>
  );
}
