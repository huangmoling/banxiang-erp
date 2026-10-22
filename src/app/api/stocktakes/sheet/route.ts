import { defineRoute } from "@/lib/api-handler";
import { sheetQuerySchema } from "@/modules/stocktake/stocktake.schema";
import { stocktakeService } from "@/modules/stocktake/stocktake.service";

/**
 * 生成盘点表：按仓位 + 截止时点算出每个款的账面数。
 * 截止时点不传就按「现在」算。
 */
export const GET = defineRoute(async ({ req }) => {
  const query = sheetQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  return stocktakeService.sheet(query);
});

export const runtime = "nodejs";
