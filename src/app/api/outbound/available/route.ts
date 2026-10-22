import { defineRoute } from "@/lib/api-handler";
import { availabilityQuerySchema } from "@/modules/outbound/outbound.schema";
import { outboundService } from "@/modules/outbound/outbound.service";

/**
 * 可出库明细：常规款给批次余量，定制款给在库件列表。
 * 加一行就查一次，skuIds 支持逗号分隔批量查。
 */
export const GET = defineRoute(async ({ req }) => {
  const { skuIds } = availabilityQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  return outboundService.availability(skuIds);
});

export const runtime = "nodejs";
