import { defineRoute } from "@/lib/api-handler";
import { createStocktakeSchema, listStocktakeQuerySchema } from "@/modules/stocktake/stocktake.schema";
import { stocktakeService } from "@/modules/stocktake/stocktake.service";

/** 能开单、能审核的角色。viewer 只能看 */
const WRITE_ROLES = ["admin", "manager", "keeper"];

export const GET = defineRoute(async ({ req }) => {
  const query = listStocktakeQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  return stocktakeService.list(query);
});

export const POST = defineRoute(
  async ({ req, user }) => {
    const body = createStocktakeSchema.parse(await req.json());
    return stocktakeService.create(body, { userId: user.id });
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
