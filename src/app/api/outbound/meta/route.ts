import { defineRoute } from "@/lib/api-handler";
import { outboundService } from "@/modules/outbound/outbound.service";

export const GET = defineRoute(async () => {
  return outboundService.meta();
});

export const runtime = "nodejs";
