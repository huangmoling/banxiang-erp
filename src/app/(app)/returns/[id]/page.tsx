import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, FileText, Info, Undo2, User, Warehouse } from "lucide-react";
import { returnService } from "@/modules/returns/return.service";
import { isAppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/date";
import {
  DESTINATION_LABEL,
  DESTINATION_TONE,
  colorText,
  type ReturnDestination,
  type ReturnDocView,
} from "@/modules/returns/return.types";
import { ReturnDocActions } from "../return-doc-actions";
import { VoidedNotice } from "@/components/voided-notice";
import { Badge } from "@/components/ui/badge";
import {
  AgainLink,
  DocTitle,
  InfoRow,
  RemarkBlock,
  SectionCard,
  StateBar,
  VariantTag,
} from "@/components/ui/doc";

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
    <div className="space-y-3">
      <VoidedNotice
        voidedAt={doc.voidedAt}
        voidReason={doc.voidReason}
        voidedByName={doc.voidedByName}
      />

      <DocTitle
        backHref="/returns"
        backTitle="返回退货列表"
        title={doc.docNo}
        statusBadge={
          doc.status === "approved" ? (
            <Badge tone="ok">已生效</Badge>
          ) : doc.status === "voided" ? (
            <Badge tone="neutral">已作废</Badge>
          ) : (
            <Badge tone="warn">草稿</Badge>
          )
        }
        meta={
          <>
            退货日期 {doc.bizDate} · {doc.itemCount} 行 · 合计{" "}
            <span className="tnum font-medium text-ink-2">{doc.totalQty}</span> {unit}
            {doc.originDocNo ? ` · 原单 ${doc.originDocNo}` : ""}
          </>
        }
        actions={
          <ReturnDocActions
            id={doc.id}
            docNo={doc.docNo}
            status={doc.status}
            totalQty={doc.totalQty}
            unit={unit}
          />
        }
      />

      {doc.status === "draft" ? (
        <StateBar tone="warn">
          这张单还是草稿，<b>库存没有变动</b>。点右上角「审核入库」之后，{doc.totalQty} {unit}
          才会按去向回到对应仓位。
        </StateBar>
      ) : doc.status === "voided" ? null : (
        <StateBar tone="ok">
          已生效：{doc.totalQty} {unit} 已按去向入库
          {doc.approvedByName ? `，由 ${doc.approvedByName} 审核` : ""}
          {doc.approvedAt ? `（${formatDateTime(doc.approvedAt)}）` : ""}。
        </StateBar>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
        <SectionCard
          padded={false}
          title="退货明细"
          hint="一色一行 · 每行一个去向"
          actions={
            dests.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {dests.map((d) => (
                  <span key={d} className={`tag tnum ${DESTINATION_TONE[d]}`}>
                    {DESTINATION_LABEL[d]} {doc.destinationQty[d]}
                  </span>
                ))}
              </div>
            ) : null
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[660px] border-collapse">
              <thead className="bg-sunken/60">
                <tr>
                  <th className="th w-[44px]">#</th>
                  <th className="th">产品 / 颜色</th>
                  <th className="th w-[80px] text-right">退货数量</th>
                  <th className="th w-[96px]">去向</th>
                  <th className="th w-[100px]">原单行</th>
                  <th className="th w-[34%]">退回的件</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((item) => (
                  <tr key={item.id} className="hover:bg-sunken/60">
                    <td className="td tnum text-muted">{item.lineNo}</td>
                    <td className="td">
                      <div className="font-medium text-ink">{item.productName}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`text-[11.5px] ${item.colorName ? "text-ink-2" : "text-muted"}`}
                        >
                          {colorText(item.colorName)}
                        </span>
                        <VariantTag variant={item.variantType} />
                      </div>
                    </td>
                    <td className="td text-right">
                      <span className="tnum font-medium">{item.qty}</span>
                      <span className="ml-1 text-[11.5px] text-muted">{item.unit}</span>
                    </td>
                    <td className="td">
                      <span className={`tag ${DESTINATION_TONE[item.destination]}`}>
                        {DESTINATION_LABEL[item.destination]}
                      </span>
                    </td>
                    <td className="td tnum whitespace-nowrap text-[12px] text-ink-2">
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
                            <span
                              key={code}
                              className="tag tnum bg-brand-soft font-normal text-brand-ink"
                            >
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
                <tr className="bg-sunken/40">
                  <td className="td border-b-0" />
                  <td className="td border-b-0 text-[12.5px] text-muted">
                    合计 {doc.itemCount} 行
                  </td>
                  <td className="td tnum border-b-0 text-right font-semibold">
                    {doc.totalQty}
                    <span className="ml-1 text-[11.5px] font-normal text-muted">{unit}</span>
                  </td>
                  <td className="td border-b-0" colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </SectionCard>

        <div className="space-y-3">
          <SectionCard title="单据信息">
            <dl className="space-y-2.5">
              <InfoRow icon={FileText} label="单号" value={doc.docNo} mono />
              <InfoRow icon={Info} label="退货日期" value={doc.bizDate} mono />
              <InfoRow
                icon={Undo2}
                label="原出库单"
                value={
                  doc.originDocumentId && doc.originDocNo ? (
                    <Link
                      href={`/outbound/${doc.originDocumentId}`}
                      className="tnum text-brand-ink hover:underline"
                      title="查看原出库单"
                    >
                      {doc.originDocNo}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )
                }
              />
              <InfoRow icon={Warehouse} label="淘宝单号" value={doc.externalNo ?? "—"} mono />
              <InfoRow icon={Warehouse} label="退回物流" value={doc.trackingNo ?? "—"} mono />
              <InfoRow icon={User} label="退回人" value={doc.receiverName ?? "—"} />
              <InfoRow icon={User} label="制单人" value={doc.createdByName ?? "—"} />
              <InfoRow
                icon={Check}
                label="审核"
                value={
                  doc.approvedByName
                    ? `${doc.approvedByName}${doc.approvedAt ? ` · ${formatDateTime(doc.approvedAt)}` : ""}`
                    : "待审核"
                }
              />
            </dl>
            {doc.remark ? <RemarkBlock remark={doc.remark} /> : null}
          </SectionCard>

          <div className="rounded-card border border-line bg-sunken px-4 py-3.5 text-[12px] leading-[1.85] text-ink-2">
            <div className="mb-1 text-[11.5px] font-medium text-ink">这件货后续</div>
            次品区的货不计入可售库存，可以线下出售或转报废。
            良品回架的货已经回到主仓，可以正常发货。
            <span className="text-ink">定制件即使回架，也不会重新变成可售库存。</span>
          </div>

          <AgainLink href="/returns/new">再开一张退货单</AgainLink>
        </div>
      </div>
    </div>
  );
}
