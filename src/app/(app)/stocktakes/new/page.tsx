import { stocktakeService } from "@/modules/stocktake/stocktake.service";
import { StocktakeForm } from "../stocktake-form";

export const dynamic = "force-dynamic";

export default async function NewStocktakePage() {
  const meta = await stocktakeService.meta();
  return <StocktakeForm meta={meta} />;
}
