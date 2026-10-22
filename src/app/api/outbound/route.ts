import { defineRoute } from "@/lib/api-handler";
import { createOutboundSchema, listOutboundQuerySchema } from "@/modules/outbound/outbound.schema";
import { outboundService } from "@/modules/outbound/outbound.service";

/** 能开单、能审核的角色。viewer 只能看 */
const WRITE_ROLES = ["admin", "manager", "keeper"];

export const GET = defineRoute(async ({ req }) => {
  const query = listOutboundQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  return outboundService.list(query);
});

export const POST = defineRoute(
  async ({ req, user }) => {
    const body = createOutboundSchema.parse(await req.json());
    return outboundService.create(body, { userId: user.id });
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
