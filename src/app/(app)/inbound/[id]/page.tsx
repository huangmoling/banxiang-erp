import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, FileText, Info, User, Warehouse } from "lucide-react";
import { inboundService } from "@/modules/inbound/inbound.service";
import { isAppError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { colorText, type InboundDocView } from "@/modules/inbound/inbound.types";
import { InboundDocActions } from "../inbound-doc-actions";
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
import { formatDateTime } from "@/lib/date";

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
    <div className="space-y-3">
      <VoidedNotice
        voidedAt={doc.voidedAt}
        voidReason={doc.voidReason}
        voidedByName={doc.voidedByName}
      />

      <DocTitle
        backHref="/inbound"
        backTitle="返回入库列表"
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
            业务日期 {doc.bizDate} · {doc.itemCount} 行 · 合计{" "}
            <span className="tnum font-medium text-ink-2">{doc.totalQty}</span> {unit}
            {customQty > 0 ? ` · 其中 ${customQty} 件定制款按件追踪` : ""}
          </>
        }
        actions={
          <InboundDocActions
            id={doc.id}
            docNo={doc.docNo}
            status={doc.status}
            totalQty={doc.totalQty}
            unit={unit}
            canDelete={canDelete}
          />
        }
      />

      {doc.status === "draft" ? (
        <StateBar tone="warn">
          这张单还是草稿，<b>库存没有变动</b>。点右上角「审核入库」之后，{doc.totalQty} {unit}
          才算真正入账。
        </StateBar>
      ) : doc.status === "voided" ? null : (
        <StateBar tone="ok">
          已生效：{doc.totalQty} {unit} 已入账
          {doc.approvedByName ? `，由 ${doc.approvedByName} 审核` : ""}
          {doc.approvedAt ? `（${formatDateTime(doc.approvedAt)}）` : ""}。
          {customQty > 0 ? ` 其中 ${customQty} 件定制款已生成唯一编号。` : ""}
        </StateBar>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
        <SectionCard
          padded={false}
          title="入库明细"
          hint="一色一行 · 数量按各自单位"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse">
              <thead className="bg-sunken/60">
                <tr>
                  <th className="th w-[44px]">#</th>
                  <th className="th">产品 / 颜色</th>
                  <th className="th w-[88px] text-right">数量</th>
                  <th className="th w-[110px]">生产日期</th>
                  <th className="th w-[100px]">批次</th>
                  <th className="th w-[40%]">单件编号</th>
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
                    <td className="td tnum whitespace-nowrap text-ink-2">
                      {item.productionDate ?? "—"}
                    </td>
                    <td className="td tnum whitespace-nowrap text-[12.5px] text-ink-2">
                      {item.batchNo ?? "—"}
                    </td>
                    <td className="td">
                      {item.instanceCodes.length === 0 ? (
                        <span className="text-[12px] text-muted">
                          {item.variantType === "custom" ? "审核后生成" : "—"}
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
              <InfoRow icon={Info} label="业务日期" value={doc.bizDate} mono />
              <InfoRow icon={Warehouse} label="入库仓位" value={doc.locationName ?? "—"} />
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

          <AgainLink href="/inbound/new">再开一张入库单</AgainLink>

          <p className="px-1 text-[11.5px] leading-relaxed text-muted">
            入库单生效后不能改数量，只能整单红冲再重开——这是为了让库存流水永远可倒查。
          </p>
        </div>
      </div>
    </div>
  );
}
