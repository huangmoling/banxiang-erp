import { productService } from "@/modules/product/product.service";
import { ProductsClient } from "./products-client";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const initialStatus =
    status === "pending" || status === "complete" ? status : ("all" as const);

  const initial = await productService.list({
    q: "",
    status: initialStatus,
    page: 1,
    pageSize: 20,
  });

  return <ProductsClient initial={initial} initialStatus={initialStatus} />;
}
