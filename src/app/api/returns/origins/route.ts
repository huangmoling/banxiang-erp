import { defineRoute } from "@/lib/api-handler";
import { searchOriginQuerySchema } from "@/modules/returns/return.schema";
import { returnService } from "@/modules/returns/return.service";

/** 搜可退的原出库单：按单号 / 淘宝订单号 / 物流单号 / 收件人 / 产品名 */
export const GET = defineRoute(async ({ req }) => {
  const { q, limit } = searchOriginQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  return { items: await returnService.searchOrigins(q, limit) };
});

export const runtime = "nodejs";
