import { defineRoute } from "@/lib/api-handler";
import { productService } from "@/modules/product/product.service";

/** 商品页的筛选元数据：分类列表、待完善数量 */
export const GET = defineRoute(async () => {
  const [categories, colors] = await Promise.all([
    productService.categories(),
    productService.colorNames(),
  ]);
  return { categories, colors };
});

export const runtime = "nodejs";
