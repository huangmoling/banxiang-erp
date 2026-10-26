import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  FileText,
  Info,
  Package,
  Printer,
  Send,
  User,
  Warehouse,
} from "lucide-react";
import { outboundService } from "@/modules/outbound/outbound.service";
import { isAppError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { formatDateTime } from "@/lib/date";
import {
  DOC_STATUS_LABEL,
  DOC_STATUS_TONE,
  type OutboundDocView,
} from "@/modules/outbound/outbound.types";
import { OutboundDocActions } from "../outbound-doc-actions";
import { OutboundLines } from "../outbound-lines";

import { VoidedNotice } from "@/components/voided-notice";

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
    <div className="space-y-4">
      <VoidedNotice
        voidedAt={doc.voidedAt}
        voidReason={doc.voidReason}
        voidedByName={doc.voidedByName}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href="/outbound"
            className="rounded-md p-1.5 text-muted hover:bg-line-2 hover:text-ink"
            title="返回出库列表"
          >
            <ArrowLeft size={16} />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="tnum text-[19px] font-semibold tracking-tight text-ink">{doc.docNo}</h1>
              {doc.pendingShip ? (
                <span className="tag bg-danger-soft text-danger">待发货</span>
              ) : (
                <span className={`tag ${DOC_STATUS_TONE[doc.status]}`}>
                  {DOC_STATUS_LABEL[doc.status]}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted">
              业务日期 {doc.bizDate} · {doc.itemCount} 个包裹 · 合计 {doc.totalQty} {unit}
              {doc.hasShipped ? ` · 已发 ${doc.shippedCount}` : ""}
              {doc.pendingShip && doc.submittedByName ? ` · ${doc.submittedByName} 提交` : ""}
            </p>
          </div>
        </div>

        <OutboundDocActions doc={doc} role={user?.role ?? "viewer"} />
      </div>

      {doc.pendingShip ? (
        <div className="flex items-start gap-2.5 rounded-card border border-danger/30 bg-danger-soft px-3.5 py-3 text-[12.5px] leading-5 text-danger">
          <CircleAlert size={15} className="mt-0.5 shrink-0" />
          <div>
            内勤交来的<b>待发货工单</b>
            {doc.submittedAt ? `（${formatDateTime(doc.submittedAt)} 提交）` : ""}，
            <b>库存还没扣</b>。下面每个商品就是一个包裹：照收货信息找货、打包，
            发掉哪几个就在前面打勾，点「确认发出」——没发的留着，明天到货再发。
          </div>
        </div>
      ) : doc.status === "draft" && doc.hasShipped ? (
        <div className="flex items-start gap-2.5 rounded-card border border-brand/30 bg-brand-soft px-3.5 py-3 text-[12.5px] leading-5 text-brand-ink">
          <CircleAlert size={15} className="mt-0.5 shrink-0" />
          <div>
            这张单<b>已经发出 {doc.shippedCount} 个包裹</b>、库存已扣，
            还有 <b>{doc.pendingCount} 个</b>没发。剩下的发完，或者客户取消了就删掉那一行，
            单据会自动结案。
          </div>
        </div>
      ) : doc.status === "draft" ? (
        <div className="flex items-start gap-2.5 rounded-card border border-warn/40 bg-warn-soft px-3.5 py-3 text-[12.5px] leading-5 text-warn">
          <CircleAlert size={15} className="mt-0.5 shrink-0" />
          <div>
            这张单还是草稿，<b>库存没有变动</b>。勾选要发的行、点「确认发出」之后，才会按实际发出的数量扣库存。
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-card border border-ok/40 bg-ok-soft px-3.5 py-3 text-[12.5px] leading-5 text-ok">
          <Check size={15} className="mt-0.5 shrink-0" />
          <div>
            已生效：{doc.totalQty} {unit} 已出库
            {doc.approvedByName ? `，由 ${doc.approvedByName} 审核` : ""}
            {doc.approvedAt ? `（${formatDateTime(doc.approvedAt)}）` : ""}。
            {customQty > 0 ? ` 其中 ${customQty} 件定制款已标记为已出库。` : ""}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* 明细：一行一个包裹，勾选→确认发出 */}
        <OutboundLines doc={doc} role={user?.role ?? "viewer"} />

        {/* 单据信息 */}
        <div className="space-y-4">
          <section className="card p-4 sm:p-5">
            <h2 className="mb-3 text-[13.5px] font-semibold text-ink">单据信息</h2>
            <dl className="space-y-2.5 text-[12.5px]">
              <Row icon={FileText} label="单号" value={doc.docNo} mono />
              <Row icon={Info} label="业务日期" value={doc.bizDate} mono />
              <Row icon={Warehouse} label="发货仓位" value={doc.locationName ?? "—"} />
              <Row
                icon={Package}
                label="包裹数"
                value={`${doc.itemCount} 个${doc.hasShipped ? `（已发 ${doc.shippedCount} 个）` : ""}`}
              />
              <Row icon={User} label="制单人" value={doc.createdByName ?? "—"} />
              {doc.submittedAt ? (
                <Row
                  icon={Send}
                  label="内勤提交"
                  value={`${doc.submittedByName ?? "—"} · ${formatDateTime(doc.submittedAt)}`}
                />
              ) : null}
              <Row
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
                  <div className="whitespace-pre-line break-words text-ink">{doc.receiverName}</div>
                </div>
              </div>
            ) : null}

            {doc.remark ? (
              <div className="mt-3 rounded-lg bg-sunken px-3 py-2.5 text-[12px] leading-5 text-ink-2">
                <div className="mb-0.5 text-[11.5px] text-muted">备注</div>
                {doc.remark}
              </div>
            ) : null}
          </section>

          <Link
            href={`/print/outbound/${doc.id}?mode=pick`}
            className="flex items-center justify-between rounded-card border border-line bg-card px-4 py-3 text-[13px] text-ink transition-colors hover:border-line"
          >
            打印出货单（按地址拆页）
            <Printer size={14} className="text-muted" />
          </Link>

          <Link
            href="/outbound/new"
            className="flex items-center justify-between rounded-card border border-line bg-card px-4 py-3 text-[13px] text-ink transition-colors hover:border-line"
          >
            再开一张出库单
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
