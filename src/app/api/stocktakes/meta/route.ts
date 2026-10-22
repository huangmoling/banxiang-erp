import { defineRoute } from "@/lib/api-handler";
import { stocktakeService } from "@/modules/stocktake/stocktake.service";

/** 盘点建单需要的东西：有哪几个仓位、现在几点、截止时点最早能填到哪天 */
export const GET = defineRoute(async () => {
  return stocktakeService.meta();
});

export const runtime = "nodejs";
