import { defineRoute } from "@/lib/api-handler";
import { createProductSchema, listProductsQuerySchema } from "@/modules/product/product.schema";
import { productService } from "@/modules/product/product.service";

export const GET = defineRoute(async ({ req }) => {
  const query = listProductsQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  return productService.list(query);
});

export const POST = defineRoute(async ({ req, user }) => {
  const body = createProductSchema.parse(await req.json());
  return productService.create(body, { userId: user.id });
});

export const runtime = "nodejs";
