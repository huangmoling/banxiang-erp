import { stocktakeService } from "@/modules/stocktake/stocktake.service";
import { StocktakesClient } from "./stocktakes-client";

export const dynamic = "force-dynamic";

export default async function StocktakesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const initialStatus = status === "draft" || status === "approved" ? status : ("all" as const);

  const initial = await stocktakeService.list({
    q: "",
    status: initialStatus,
    page: 1,
    pageSize: 20,
  });

  return <StocktakesClient initial={initial} initialStatus={initialStatus} />;
}
