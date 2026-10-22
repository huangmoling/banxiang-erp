import { defineRoute } from "@/lib/api-handler";
import { searchProductsQuerySchema } from "@/modules/product/product.schema";
import { productService } from "@/modules/product/product.service";

/** 选品搜索：入库/出库页的商品下拉都走这里 */
export const GET = defineRoute(async ({ req }) => {
  const { q, limit } = searchProductsQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  return { items: await productService.search(q, limit) };
});

export const runtime = "nodejs";
