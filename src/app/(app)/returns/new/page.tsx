import { returnService } from "@/modules/returns/return.service";
import { ReturnForm } from "../return-form";

export const dynamic = "force-dynamic";

export default async function NewReturnPage() {
  const meta = await returnService.meta();
  return <ReturnForm meta={meta} />;
}
