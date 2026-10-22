import { defineRoute } from "@/lib/api-handler";
import { returnService } from "@/modules/returns/return.service";

/** 某张原出库单的逐行可退量（含定制件清单） */
export const GET = defineRoute<{ id: string }>(async ({ params }) => {
  return returnService.originDetail(params.id);
});

export const runtime = "nodejs";
