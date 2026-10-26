import { notFound } from "next/navigation";
import { Check, ClipboardCheck, FileText, Info, User, Warehouse } from "lucide-react";
import { stocktakeService } from "@/modules/stocktake/stocktake.service";
import { isAppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/date";
import {
  LOCATION_TYPE_LABEL,
  colorText,
  type StocktakeDocView,
} from "@/modules/stocktake/stocktake.types";
import { StocktakeDocActions } from "../stocktake-doc-actions";
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
  const netDiff = doc.gainQty - doc.lossQty;

  return (
    <div className="space-y-3">
      <DocTitle
        backHref="/stocktakes"
        backTitle="返回盘点列表"
        title={doc.docNo}
        statusBadge={
          <>
            {doc.status === "approved" ? (
              <Badge tone="ok">已生效</Badge>
            ) : doc.status === "voided" ? (
              <Badge tone="neutral">已作废</Badge>
            ) : (
              <Badge tone="warn">草稿</Badge>
            )}
            {doc.locationType ? (
              <Badge tone={doc.isSellable ? "brand" : "warn"}>
                {doc.locationName} · {doc.isSellable ? "可售" : "不可售"}
              </Badge>
            ) : null}
          </>
        }
        meta={
          <>
            截止 {doc.snapshotAt ? formatDateTime(doc.snapshotAt) : doc.bizDate} · 盘了{" "}
            {doc.itemCount} 行 · 账面 <span className="tnum text-ink-2">{doc.bookTotal}</span>{" "}
            {unit} / 实盘 <span className="tnum text-ink-2">{doc.totalQty}</span> {unit}
          </>
        }
        actions={
          <StocktakeDocActions
            id={doc.id}
            docNo={doc.docNo}
            status={doc.status}
            diffLines={doc.diffLines}
          />
        }
      />

      {doc.status === "draft" ? (
        <StateBar tone="warn">
          这张单还是草稿，<b>库存没有变动</b>。点右上角「审核并调账」之后，
          {doc.diffLines === 0 ? "账实相符，不会有任何调整" : `${doc.diffLines} 行的差异才会记到账上`}
          。
        </StateBar>
      ) : doc.status === "voided" ? null : (
        <StateBar tone="ok">
          已生效：
          {doc.diffLines === 0 ? (
            <>账实相符，没有产生调整流水。</>
          ) : (
            <>
              {doc.gainQty > 0 ? (
                <b>
                  盘盈 {doc.gainQty} {unit}
                </b>
              ) : null}
              {doc.gainQty > 0 && doc.lossQty > 0 ? "、" : ""}
              {doc.lossQty > 0 ? (
                <b>
                  盘亏 {doc.lossQty} {unit}
                </b>
              ) : null}
              ，差异已按截止时点记入库存。
            </>
          )}
          {doc.approvedByName ? ` 审核人 ${doc.approvedByName}` : ""}
          {doc.approvedAt ? `（${formatDateTime(doc.approvedAt)}）` : ""}
        </StateBar>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
        <SectionCard
          padded={false}
          title="盘点明细"
          hint="账面 / 实盘 / 差异"
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              {doc.gainQty > 0 ? (
                <span className="tag tnum bg-ok-soft text-ok">盘盈 +{doc.gainQty}</span>
              ) : null}
              {doc.lossQty > 0 ? (
                <span className="tag tnum bg-danger-soft text-danger">盘亏 -{doc.lossQty}</span>
              ) : null}
              {doc.diffLines === 0 ? <span className="tag bg-sunken text-ink-2">账实相符</span> : null}
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse">
              <thead className="bg-sunken/60">
                <tr>
                  <th className="th w-[44px]">#</th>
                  <th className="th">产品 / 颜色</th>
                  <th className="th w-[80px] text-right">账面</th>
                  <th className="th w-[80px] text-right">实盘</th>
                  <th className="th w-[80px] text-right">差异</th>
                  <th className="th w-[84px] text-right">截止后</th>
                  <th className="th w-[24%]">盘亏件</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((item) => (
                  <tr
                    key={item.id}
                    className={item.diffQty !== 0 ? "bg-warn-soft hover:bg-warn-soft" : "hover:bg-sunken/60"}
                  >
                    <td className="td tnum text-muted">{item.lineNo}</td>
                    <td className="td">
                      <div className="font-medium text-ink">{item.productName}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`text-[11.5px] ${item.colorName ? "text-ink-2" : "text-muted"}`}
                        >
                          {colorText(item.colorName)}
                        </span>
                        {item.variantType === "custom" ? (
                          <VariantTag variant="custom" />
                        ) : null}
                      </div>
                    </td>
                    <td className="td tnum text-right text-ink-2">{item.bookQty}</td>
                    <td className="td tnum text-right font-medium">{item.countedQty}</td>
                    <td className="td tnum text-right font-semibold">
                      {item.diffQty === 0 ? (
                        <span className="font-normal text-muted">0</span>
                      ) : (
                        <span className={item.diffQty > 0 ? "text-ok" : "text-danger"}>
                          {item.diffQty > 0 ? "+" : ""}
                          {item.diffQty}
                        </span>
                      )}
                    </td>
                    <td className="td tnum text-right text-[12.5px] text-muted">
                      {item.afterQty === 0 ? "—" : `${item.afterQty > 0 ? "+" : ""}${item.afterQty}`}
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
                <tr className="bg-sunken/40">
                  <td className="td border-b-0" />
                  <td className="td border-b-0 text-[12.5px] text-muted">
                    合计 {doc.itemCount} 行
                  </td>
                  <td className="td tnum border-b-0 text-right text-[12.5px] text-ink-2">
                    {doc.bookTotal}
                  </td>
                  <td className="td tnum border-b-0 text-right font-semibold">{doc.totalQty}</td>
                  <td className="td tnum border-b-0 text-right font-semibold">
                    {netDiff === 0 ? (
                      <span className="font-normal text-muted">0</span>
                    ) : (
                      <span className={netDiff > 0 ? "text-ok" : "text-danger"}>
                        {netDiff > 0 ? "+" : ""}
                        {netDiff}
                      </span>
                    )}
                  </td>
                  <td className="td border-b-0" colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </SectionCard>

        <div className="space-y-3">
          <SectionCard title="单据信息">
            <dl className="space-y-2.5">
              <InfoRow icon={FileText} label="单号" value={doc.docNo} mono />
              <InfoRow
                icon={Info}
                label="截止时点"
                value={doc.snapshotAt ? formatDateTime(doc.snapshotAt) : "—"}
                mono
              />
              <InfoRow
                icon={Warehouse}
                label="仓位"
                value={
                  <>
                    {doc.locationName ?? "—"}
                    <span className="ml-1.5 text-[11.5px] text-muted">
                      {LOCATION_TYPE_LABEL[doc.locationType]}
                    </span>
                  </>
                }
              />
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
            <div className="mb-1 text-[11.5px] font-medium text-ink">怎么读这张单</div>
            <div>
              <b className="text-ink">账面</b>是截止时点那一刻系统上的数；<b className="text-ink">实盘</b>
              是你数出来的数；两者之差就是<b className="text-ink">差异</b>。
            </div>
            {hasAfter ? (
              <div className="mt-1.5">
                <b className="text-ink">截止后</b>是盘点开始之后这个仓位又发生的出入库净额——所以现在
                系统上的数字和「实盘」不一样，是正常的，不是系统算错了。
              </div>
            ) : null}
            <div className="mt-1.5 text-[11.5px] text-muted">
              盘盈的货会归到一个「PD-日期」批次（盘出来的货没有生产日期）；盘亏按先产的先走扣批次。
            </div>
          </div>

          <AgainLink href="/stocktakes/new" icon={ClipboardCheck}>
            再盘一次
          </AgainLink>
        </div>
      </div>
    </div>
  );
}
