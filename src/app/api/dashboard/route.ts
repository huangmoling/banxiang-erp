import { defineRoute } from "@/lib/api-handler";
import { dashboardService } from "@/modules/dashboard/dashboard.service";

export const GET = defineRoute(async () => {
  return dashboardService.overview();
});

export const runtime = "nodejs";
