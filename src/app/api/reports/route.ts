import { defineRoute } from "@/lib/api-handler";
import { reportService } from "@/modules/report/report.service";

/** 经营报表：本月作业量、近 12 个月趋势、损耗拆解、次品消化、批次账龄、低库存 */
export const GET = defineRoute(async () => reportService.overview());

export const runtime = "nodejs";
