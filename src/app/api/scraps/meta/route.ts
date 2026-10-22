import { defineRoute } from "@/lib/api-handler";
import { scrapService } from "@/modules/scrap/scrap.service";

/** 建单页的上下文：可选源仓位 + 今天日期 */
export const GET = defineRoute(async () => {
  return scrapService.meta();
});

export const runtime = "nodejs";
