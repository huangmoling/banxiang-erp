import { defineRoute } from "@/lib/api-handler";
import { returnService } from "@/modules/returns/return.service";

export const GET = defineRoute(async () => {
  return returnService.meta();
});

export const runtime = "nodejs";
