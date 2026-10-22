import { defineRoute } from "@/lib/api-handler";
import { returnService } from "@/modules/returns/return.service";

const WRITE_ROLES = ["admin", "manager", "keeper"];

export const GET = defineRoute<{ id: string }>(async ({ params }) => {
  return returnService.detail(params.id);
});

export const DELETE = defineRoute<{ id: string }>(
  async ({ params, user }) => {
    await returnService.remove(params.id, { userId: user.id });
    return { ok: true };
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
