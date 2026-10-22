import { defineRoute } from "@/lib/api-handler";
import { scrapService } from "@/modules/scrap/scrap.service";

const WRITE_ROLES = ["admin", "manager", "keeper"];

export const GET = defineRoute<{ id: string }>(async ({ params }) => {
  return scrapService.detail(params.id);
});

/** 删草稿：只有草稿能删，已生效的必须走红冲 */
export const DELETE = defineRoute<{ id: string }>(
  async ({ params, user }) => {
    await scrapService.remove(params.id, { userId: user.id });
    return { id: params.id, deleted: true };
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
