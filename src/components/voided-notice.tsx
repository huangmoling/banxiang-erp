import { Undo2 } from "lucide-react";
import { formatDateTime } from "@/lib/date";

/**
 * 已红冲提示条。四种单据详情页共用。
 * 单据被冲之后必须让人一眼看到原因，否则翻到一张「已作废」的单只会一头雾水。
 */
export function VoidedNotice({
  voidedAt,
  voidReason,
  voidedByName,
}: {
  voidedAt: string | null;
  voidReason: string | null;
  voidedByName: string | null;
}) {
  if (!voidedAt) return null;

  return (
    <div className="card flex items-start gap-3 border-[#e8dcc4] bg-[#fdfbf4] px-4 py-3">
      <Undo2 size={16} className="mt-0.5 shrink-0 text-[#9a7b34]" />
      <div className="text-[13px] leading-6 text-[#7a5a1a]">
        <p className="font-medium">
          这张单已红冲（{formatDateTime(voidedAt)}）
          {voidedByName ? ` · ${voidedByName}` : ""}
        </p>
        <p className="text-[12.5px]">原因：{voidReason ?? "—"}</p>
        <p className="text-[12.5px]">
          库存已按原路退回。原始流水一条都没删，红冲流水与它一正一反并排留着，可以在单据的库存流水里核对。
        </p>
      </div>
    </div>
  );
}
