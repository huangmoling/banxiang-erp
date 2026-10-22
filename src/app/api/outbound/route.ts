import { defineRoute } from "@/lib/api-handler";
import { createOutboundSchema, listOutboundQuerySchema } from "@/modules/outbound/outbound.schema";
import { outboundService } from "@/modules/outbound/outbound.service";

/**
 * 能开单的角色。内勤（clerk）也在里面，但他**只能存成草稿/工单**：
 * 服务层会把 approveNow 强制按 false 处理，内勤永远没法自己发货。
 */
const WRITE_ROLES = ["admin", "manager", "keeper", "clerk"];

export const GET = defineRoute(async ({ req }) => {
  const query = listOutboundQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  return outboundService.list(query);
});

export const POST = defineRoute(
  async ({ req, user }) => {
    const body = createOutboundSchema.parse(await req.json());
    return outboundService.create(body, { userId: user.id, role: user.role });
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
