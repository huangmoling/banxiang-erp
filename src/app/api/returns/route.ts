import { defineRoute } from "@/lib/api-handler";
import { createReturnSchema, listReturnQuerySchema } from "@/modules/returns/return.schema";
import { returnService } from "@/modules/returns/return.service";

/** 能开单、能审核的角色。viewer 只能看 */
const WRITE_ROLES = ["admin", "manager", "keeper"];

export const GET = defineRoute(async ({ req }) => {
  const query = listReturnQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  return returnService.list(query);
});

export const POST = defineRoute(
  async ({ req, user }) => {
    const body = createReturnSchema.parse(await req.json());
    return returnService.create(body, { userId: user.id });
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
