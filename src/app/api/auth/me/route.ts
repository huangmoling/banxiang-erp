import { defineRoute } from "@/lib/api-handler";

export const GET = defineRoute(async ({ user }) => {
  return { user };
});
