import { defineRoute } from "@/lib/api-handler";
import { outboundService } from "@/modules/outbound/outbound.service";

const WRITE_ROLES = ["admin", "manager", "keeper"];

export const GET = defineRoute<{ id: string }>(async ({ params }) => {
  return outboundService.detail(params.id);
});

export const DELETE = defineRoute<{ id: string }>(
  async ({ params, user }) => {
    await outboundService.remove(params.id, { userId: user.id });
    return { ok: true };
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
