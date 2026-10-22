import { defineRoute } from "@/lib/api-handler";
import { outboundService } from "@/modules/outbound/outbound.service";

/**
 * 待发货张数：仪表台横幅和侧栏角标共用。
 * 单独开一个轻接口，是为了让角标能每 60 秒刷一次而不用把整个仪表台重算一遍。
 */
export const GET = defineRoute(async () => {
  return outboundService.pendingSummary();
});

export const runtime = "nodejs";
