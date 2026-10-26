import { notFound } from "next/navigation";
import { Check, FileText, Info, Package, Printer, Send, User, Warehouse } from "lucide-react";
import { outboundService } from "@/modules/outbound/outbound.service";
import { isAppError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { formatDateTime } from "@/lib/date";
import type { OutboundDocView } from "@/modules/outbound/outbound.types";
import { OutboundDocActions } from "../outbound-doc-actions";
import { OutboundLines } from "../outbound-lines";
import { VoidedNotice } from "@/components/voided-notice";
import { Badge } from "@/components/ui/badge";
import { AgainLink, DocTitle, InfoRow, RemarkBlock, SectionCard, StateBar } from "@/components/ui/doc";

export const dynamic = "force-dynamic";

export default async function OutboundDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let doc: OutboundDocView;
  try {
    doc = await outboundService.detail(id);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }

  const user = await getSession();

  const unit = doc.items[0]?.unit ?? "件";
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
        backHref="/outbound"
        backTitle="返回出库列表"
        title={doc.docNo}
        statusBadge={
          doc.pendingShip ? (
            <Badge tone="danger" dot>
              待发货
            </Badge>
          ) : doc.status === "approved" ? (
            <Badge tone="ok">已生效</Badge>
          ) : doc.status === "voided" ? (
            <Badge tone="neutral">已作废</Badge>
          ) : doc.hasShipped ? (
            <Badge tone="brand">
              已发 <span className="tnum">{doc.shippedCount}</span>/
              <span className="tnum">{doc.itemCount}</span>
            </Badge>
          ) : (
            <Badge tone="warn">草稿</Badge>
          )
        }
        meta={
          <>
            业务日期 {doc.bizDate} · {doc.itemCount} 个包裹 · 合计{" "}
            <span className="tnum font-medium text-ink-2">{doc.totalQty}</span> {unit}
            {doc.hasShipped ? ` · 已发 ${doc.shippedCount}` : ""}
            {doc.pendingShip && doc.submittedByName ? ` · ${doc.submittedByName} 提交` : ""}
          </>
        }
        actions={<OutboundDocActions doc={doc} role={user?.role ?? "viewer"} />}
      />

      {doc.pendingShip ? (
        <StateBar tone="danger">
          内勤交来的<b>待发货工单</b>
          {doc.submittedAt ? `（${formatDateTime(doc.submittedAt)} 提交）` : ""}，
          <b>库存还没扣</b>。下面每个商品就是一个包裹：照收货信息找货、打包，
          发掉哪几个就在前面打勾，点「确认发出」——没发的留着，明天到货再发。
        </StateBar>
      ) : doc.status === "draft" && doc.hasShipped ? (
        <StateBar tone="brand">
          这张单<b>已经发出 {doc.shippedCount} 个包裹</b>、库存已扣，还有{" "}
          <b>{doc.pendingCount} 个</b>没发。剩下的发完，或者客户取消了就删掉那一行，单据会自动结案。
        </StateBar>
      ) : doc.status === "draft" ? (
        <StateBar tone="warn">
          这张单还是草稿，<b>库存没有变动</b>。勾选要发的行、点「确认发出」之后，才会按实际发出的数量扣库存。
        </StateBar>
      ) : doc.status === "voided" ? null : (
        <StateBar tone="ok">
          已生效：{doc.totalQty} {unit} 已出库
          {doc.approvedByName ? `，由 ${doc.approvedByName} 审核` : ""}
          {doc.approvedAt ? `（${formatDateTime(doc.approvedAt)}）` : ""}。
          {customQty > 0 ? ` 其中 ${customQty} 件定制款已标记为已出库。` : ""}
        </StateBar>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* 明细：一行一个包裹，勾选→确认发出 */}
        <OutboundLines doc={doc} role={user?.role ?? "viewer"} />

        <div className="space-y-3">
          <SectionCard title="单据信息">
            <dl className="space-y-2.5">
              <InfoRow icon={FileText} label="单号" value={doc.docNo} mono />
              <InfoRow icon={Info} label="业务日期" value={doc.bizDate} mono />
              <InfoRow icon={Warehouse} label="发货仓位" value={doc.locationName ?? "—"} />
              <InfoRow
                icon={Package}
                label="包裹数"
                value={
                  <>
                    <span className="tnum">{doc.itemCount}</span> 个
                    {doc.hasShipped ? `（已发 ${doc.shippedCount} 个）` : ""}
                  </>
                }
              />
              <InfoRow icon={User} label="制单人" value={doc.createdByName ?? "—"} />
              {doc.submittedAt ? (
                <InfoRow
                  icon={Send}
                  label="内勤提交"
                  value={`${doc.submittedByName ?? "—"} · ${formatDateTime(doc.submittedAt)}`}
                />
              ) : null}
              <InfoRow
                icon={Check}
                label={doc.hasShipped ? "发货" : "状态"}
                value={
                  doc.allShipped
                    ? `全部发完${doc.approvedByName ? ` · ${doc.approvedByName}` : ""}${
                        doc.approvedAt ? ` · ${formatDateTime(doc.approvedAt)}` : ""
                      }`
                    : doc.hasShipped
                      ? `已发 ${doc.shippedCount} / ${doc.itemCount}，还有 ${doc.pendingCount} 个待发`
                      : "还没发出任何一个包裹"
                }
              />
            </dl>

            {/* 收货信息现在在每一行上；这里只在填了「整单通用地址」时才有值 */}
            {doc.receiverName ? (
              <div className="mt-3 flex gap-2 rounded-lg bg-sunken px-3 py-2.5 text-[12px] leading-[1.7]">
                <User size={13} className="mt-[3px] shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 text-[11.5px] text-muted">
                    整单通用地址（行上没填的沿用它）
                  </div>
                  <div className="break-words whitespace-pre-line text-ink">{doc.receiverName}</div>
                </div>
              </div>
            ) : null}

            {doc.remark ? <RemarkBlock remark={doc.remark} /> : null}
          </SectionCard>

          <AgainLink href={`/print/outbound/${doc.id}?mode=pick`} icon={Printer}>
            打印出货单（按地址拆页）
          </AgainLink>

          <AgainLink href="/outbound/new">再开一张出库单</AgainLink>

          <p className="px-1 text-[11.5px] leading-relaxed text-muted">
            打印页是独立页面，不跟随主题、不带导航栏——它的用途是直接送打印机。
          </p>
        </div>
      </div>
    </div>
  );
}
