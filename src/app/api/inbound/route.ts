import { defineRoute } from "@/lib/api-handler";
import { createInboundSchema, listInboundQuerySchema } from "@/modules/inbound/inbound.schema";
import { inboundService } from "@/modules/inbound/inbound.service";

/** 能开单、能审核的角色。viewer 只能看 */
const WRITE_ROLES = ["admin", "manager", "keeper"];

export const GET = defineRoute(async ({ req }) => {
  const query = listInboundQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  return inboundService.list(query);
});

export const POST = defineRoute(
  async ({ req, user }) => {
    const body = createInboundSchema.parse(await req.json());
    return inboundService.create(body, { userId: user.id });
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
