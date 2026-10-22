import { defineRoute } from "@/lib/api-handler";
import { scrapStockQuerySchema } from "@/modules/scrap/scrap.schema";
import { scrapService } from "@/modules/scrap/scrap.service";

/**
 * 某个源仓位里现有的货（处置单的候选行）。
 * 次品区打开时就是「次品区里现在堆着什么」，这也是次品区页面的数据来源。
 */
export const GET = defineRoute(async ({ req }) => {
  const query = scrapStockQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  return scrapService.stock(query.locationId);
});

export const runtime = "nodejs";
