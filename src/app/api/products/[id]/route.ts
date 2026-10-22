import { defineRoute } from "@/lib/api-handler";
import { updateProductSchema } from "@/modules/product/product.schema";
import { productService } from "@/modules/product/product.service";

export const GET = defineRoute<{ id: string }>(async ({ params }) => {
  return productService.detail(params.id);
});

export const PUT = defineRoute<{ id: string }>(async ({ req, params, user }) => {
  const body = updateProductSchema.parse(await req.json());
  return productService.update(params.id, body, { userId: user.id });
});

export const DELETE = defineRoute<{ id: string }>(async ({ params, user }) => {
  await productService.remove(params.id, { userId: user.id });
  return { ok: true };
});

export const runtime = "nodejs";
