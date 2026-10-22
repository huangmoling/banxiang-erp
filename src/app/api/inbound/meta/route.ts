import { defineRoute } from "@/lib/api-handler";
import { inboundService } from "@/modules/inbound/inbound.service";

export const GET = defineRoute(async () => {
  return inboundService.meta();
});

export const runtime = "nodejs";
