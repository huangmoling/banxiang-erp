import { notFound } from "next/navigation";
import { productService } from "@/modules/product/product.service";
import { ProductForm } from "../../product-form";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const product = await productService.detail(id);
    return <ProductForm mode="edit" initial={product} />;
  } catch {
    notFound();
  }
}
