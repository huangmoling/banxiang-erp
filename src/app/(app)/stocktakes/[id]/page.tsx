import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  ClipboardCheck,
  FileText,
  Info,
  User,
  Warehouse,
} from "lucide-react";
import { stocktakeService } from "@/modules/stocktake/stocktake.service";
import { isAppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/date";
import {
  DOC_STATUS_LABEL,
  DOC_STATUS_TONE,
  LOCATION_TYPE_LABEL,
  LOCATION_TYPE_TONE,
  colorText,
  type StocktakeDocView,
} from "@/modules/stocktake/stocktake.types";
import { StocktakeDocActions } from "../stocktake-doc-actions";

export const dynamic = "force-dynamic";

export default async function StocktakeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let doc: StocktakeDocView;
  try {
    doc = await stocktakeService.detail(id);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }

  const unit = doc.items[0]?.unit ?? "件";
  const hasAfter = doc.items.some((i) => i.afterQty !== 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href="/stocktakes"
            className="rounded-md p-1.5 text-muted hover:bg-line-2 hover:text-ink"
            title="返回盘点列表"
          >
            <ArrowLeft size={16} />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="tnum text-[19px] font-semibold tracking-tight text-ink">{doc.docNo}</h1>
              <span className={`tag ${DOC_STATUS_TONE[doc.status]}`}>
                {DOC_STATUS_LABEL[doc.status]}
              </span>
              {doc.locationType ? (
                <span className={`tag ${LOCATION_TYPE_TONE[doc.locationType]}`}>
                  {doc.locationName} · {doc.isSellable ? "可售" : "不可售"}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted">
              截止 {doc.snapshotAt ? formatDateTime(doc.snapshotAt) : doc.bizDate} · 盘了{" "}
              {doc.itemCount} 行 · 账面 {doc.bookTotal} {unit} / 实盘 {doc.totalQty} {unit}
            </p>
          </div>
        </div>

        <StocktakeDocActions
          id={doc.id}
          docNo={doc.docNo}
          status={doc.status}
          diffLines={doc.diffLines}
        />
      </div>

      {doc.status === "draft" ? (
        <div className="flex items-start gap-2.5 rounded-card border border-warn/40 bg-warn-soft px-3.5 py-3 text-[12.5px] leading-5 text-warn">
          <CircleAlert size={15} className="mt-0.5 shrink-0" />
          <div>
            这张单还是草稿，<b>库存没有变动</b>。点右上角「审核并调账」之后，
            {doc.diffLines === 0 ? "账实相符，不会有任何调整" : `${doc.diffLines} 行的差异才会记到账上`}
            。
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-card border border-ok/40 bg-ok-soft px-3.5 py-3 text-[12.5px] leading-5 text-ok">
          <Check size={15} className="mt-0.5 shrink-0" />
          <div>
            已生效：
            {doc.diffLines === 0 ? (
              <>账实相符，没有产生调整流水。</>
            ) : (
              <>
                {doc.gainQty > 0 ? <b>盘盈 {doc.gainQty} {unit}</b> : null}
                {doc.gainQty > 0 && doc.lossQty > 0 ? "、" : ""}
                {doc.lossQty > 0 ? <b>盘亏 {doc.lossQty} {unit}</b> : null}
                ，差异已按截止时点记入库存。
              </>
            )}
            {doc.approvedByName ? ` 审核人 ${doc.approvedByName}` : ""}
            {doc.approvedAt ? `（${formatDateTime(doc.approvedAt)}）` : ""}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="text-[14px] font-semibold text-ink">盘点明细</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {doc.gainQty > 0 ? (
                <span className="tag tnum bg-ok-soft text-ok">盘盈 +{doc.gainQty}</span>
              ) : null}
              {doc.lossQty > 0 ? (
                <span className="tag tnum bg-danger-soft text-danger">盘亏 -{doc.lossQty}</span>
              ) : null}
              {doc.diffLines === 0 ? (
                <span className="tag bg-sunken text-ink-2">账实相符</span>
              ) : null}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse">
              <thead>
                <tr>
                  <th className="th w-[42px]">#</th>
                  <th className="th">产品 / 颜色</th>
                  <th className="th w-[76px] text-right">账面</th>
                  <th className="th w-[76px] text-right">实盘</th>
                  <th className="th w-[76px] text-right">差异</th>
                  <th className="th w-[80px] text-right">截止后</th>
                  <th className="th w-[24%]">盘亏件</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((item) => (
                  <tr key={item.id} className={item.diffQty !== 0 ? "bg-warn-soft" : undefined}>
                    <td className="td tnum text-muted">{item.lineNo}</td>
                    <td className="td">
                      <div className="font-medium text-ink">{item.productName}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                        <span className={item.colorName ? "text-ink-2" : ""}>
                          {colorText(item.colorName)}
                        </span>
                        {item.variantType === "custom" ? (
                          <span className="tag bg-warn-soft text-warn">定制·按件</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="td tnum text-right text-ink-2">{item.bookQty}</td>
                    <td className="td tnum text-right font-medium">{item.countedQty}</td>
                    <td className="td tnum text-right font-medium">
                      {item.diffQty === 0 ? (
                        <span className="text-muted">0</span>
                      ) : (
                        <span className={item.diffQty > 0 ? "text-ok" : "text-danger"}>
                          {item.diffQty > 0 ? "+" : ""}
                          {item.diffQty}
                        </span>
                      )}
                    </td>
                    <td className="td tnum text-right text-[12.5px] text-muted">
                      {item.afterQty === 0
                        ? "—"
                        : `${item.afterQty > 0 ? "+" : ""}${item.afterQty}`}
                    </td>
                    <td className="td">
                      {item.instanceCodes.length === 0 ? (
                        <span className="text-[12px] text-muted">
                          {item.variantType === "custom" ? "无" : "—"}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {item.instanceCodes.map((code) => (
                            <span key={code} className="tag tnum bg-danger-soft text-danger">
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
                  <td className="td tnum text-right text-[12.5px] text-ink-2">{doc.bookTotal}</td>
                  <td className="td tnum text-right font-semibold">{doc.totalQty}</td>
                  <td className="td tnum text-right font-semibold">
                    {doc.gainQty - doc.lossQty === 0 ? (
                      <span className="text-muted">0</span>
                    ) : (
                      <span className={doc.gainQty > doc.lossQty ? "text-ok" : "text-danger"}>
                        {doc.gainQty - doc.lossQty > 0 ? "+" : ""}
                        {doc.gainQty - doc.lossQty}
                      </span>
                    )}
                  </td>
                  <td className="td" colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <div className="space-y-4">
          <section className="card p-4 sm:p-5">
            <h2 className="mb-3 text-[13.5px] font-semibold text-ink">单据信息</h2>
            <dl className="space-y-2.5 text-[12.5px]">
              <Row icon={FileText} label="单号" value={doc.docNo} mono />
              <Row
                icon={Info}
                label="截止时点"
                value={doc.snapshotAt ? formatDateTime(doc.snapshotAt) : "—"}
                mono
              />
              <div className="flex items-start gap-2.5">
                <Warehouse size={14} strokeWidth={1.7} className="mt-0.5 shrink-0 text-muted" />
                <dt className="w-[62px] shrink-0 text-muted">仓位</dt>
                <dd className="min-w-0 flex-1 text-ink">
                  {doc.locationName ?? "—"}
                  <span className="ml-1.5 text-[11.5px] text-muted">
                    {LOCATION_TYPE_LABEL[doc.locationType]}
                  </span>
                </dd>
              </div>
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
            <div className="mb-1 text-[11.5px] text-muted">怎么读这张单</div>
            <div>
              <b className="text-ink">账面</b>是截止时点那一刻系统上的数；
              <b className="text-ink">实盘</b>是你数出来的数；两者之差就是<b className="text-ink">差异</b>。
            </div>
            {hasAfter ? (
              <div className="mt-1.5">
                <b className="text-ink">截止后</b>是盘点开始之后这个仓位又发生的出入库净额——
                所以现在系统上的数字和「实盘」不一样，是正常的，不是系统算错了。
              </div>
            ) : null}
            <div className="mt-1.5 text-[11.5px] text-muted">
              盘盈的货会归到一个「PD-日期」批次（盘出来的货没有生产日期）；盘亏按先产的先走扣批次。
            </div>
          </div>

          <Link
            href="/stocktakes/new"
            className="flex items-center justify-between rounded-card border border-line bg-card px-4 py-3 text-[13px] text-ink transition-colors hover:border-line"
          >
            <span className="flex items-center gap-2">
              <ClipboardCheck size={15} strokeWidth={1.7} className="text-muted" />
              再盘一次
            </span>
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
