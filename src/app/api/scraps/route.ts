import { defineRoute } from "@/lib/api-handler";
import { createScrapSchema, listScrapQuerySchema } from "@/modules/scrap/scrap.schema";
import { scrapService } from "@/modules/scrap/scrap.service";

const WRITE_ROLES = ["admin", "manager", "keeper"];

/** 处置单列表：按单号 / 商品名 / 备注搜，按业务日期倒序 */
export const GET = defineRoute(async ({ req }) => {
  const query = listScrapQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  return scrapService.list(query);
});

/** 建处置单：可以只存草稿，也可以保存即生效 */
export const POST = defineRoute(
  async ({ req, user }) => {
    const body = await req.json().catch(() => ({}));
    const input = createScrapSchema.parse(body);
    return scrapService.create(input, { userId: user.id });
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
