import "server-only";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { buildPinyinIndex } from "@/lib/pinyin";
import { generateSkuCode } from "@/lib/sku-code";
import { stockRepository } from "@/modules/inventory/stock.repository";
import { productRepository, type ProductRecord } from "./product.repository";
import type {
  CreateProductInput,
  ColorRowInput,
  ListProductsQuery,
  UpdateProductInput,
} from "./product.schema";

import type { ProductSkuView, ProductView } from "./product.types";

export type { ProductSkuView, ProductView };

/**
 * 库存一律现算：按 SKU 汇总流水（只算可售仓位）。
 * 库里没有「当前库存」这种字段可以写，因此不存在改数字这条路。
 */
async function loadStock(records: ProductRecord[]): Promise<Map<string, number>> {
  const skuIds = records.flatMap((p) => p.skus.map((s) => s.id));
  return stockRepository.stockBySkuIds(skuIds);
}

function toView(p: ProductRecord, stockMap?: Map<string, number>): ProductView {
  const colors: ProductSkuView[] = p.skus.map((s) => ({
    id: s.id,
    colorName: s.colorName,
    variantType: s.variantType === "custom" ? "custom" : "normal",
    skuCode: s.skuCode,
    barcode: s.barcode,
    safetyStock: s.safetyStock,
    stock: stockMap?.get(s.id) ?? 0,
  }));

  return {
    id: p.id,
    name: p.name,
    category: p.category,
    unit: p.unit,
    imageUrl: p.imageUrl,
    description: p.description,
    profileStatus: p.profileStatus === "complete" ? "complete" : "pending",
    usageCount: p.usageCount,
    updatedAt: p.updatedAt.toISOString(),
    colors,
    totalStock: colors.reduce((sum, c) => sum + c.stock, 0),
    colorCount: colors.length,
  };
}

/** 空字符串一律按「清空」处理，避免库里出现 "" 与 null 两种空值 */
function blankToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** 待完善判定：没有主图即视为待完善（其余信息可选） */
function resolveProfileStatus(imageUrl: string | null): "complete" | "pending" {
  return imageUrl ? "complete" : "pending";
}

function normalizeColors(colors: ColorRowInput[]): ColorRowInput[] {
  return colors.map((c) => ({
    ...c,
    colorName: c.colorName ?? null,
    variantType: c.variantType ?? "normal",
    safetyStock: c.safetyStock ?? 0,
  }));
}

export const productService = {
  async list(query: ListProductsQuery): Promise<{
    items: ProductView[];
    total: number;
    page: number;
    pageSize: number;
    pendingCount: number;
  }> {
    const [{ items, total }, pendingCount] = await Promise.all([
      productRepository.list(query),
      productRepository.countPending(),
    ]);

    const stockMap = await loadStock(items);

    return {
      items: items.map((p) => toView(p, stockMap)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      pendingCount,
    };
  },

  async detail(id: string): Promise<ProductView> {
    const product = await productRepository.findById(id);
    if (!product) throw new NotFoundError("找不到该产品，可能已被删除");
    const stockMap = await loadStock([product]);
    return toView(product, stockMap);
  },

  /**
   * 选品搜索：中文 / 全拼 / 首字母都能命中，前缀命中排最前。
   * 排序不是按字母，而是「前缀 > 常用（近 90 天使用次数）> 名称」——
   * 本月常进的那几款永远在第一屏，仓管打两个字母回车就选完。
   */
  async search(q: string, limit: number): Promise<ProductView[]> {
    const term = q.trim();
    if (!term) {
      const frequent = await productRepository.searchCandidates("", limit);
      const stockMap = await loadStock(frequent);
      return frequent.map((p) => toView(p, stockMap));
    }

    const lower = term.toLowerCase();
    const candidates = await productRepository.searchCandidates(term, Math.max(limit * 4, 40));

    const score = (p: ProductRecord): number => {
      let s = 0;
      if (p.nameInitials.startsWith(lower)) s += 100;
      if (p.namePinyin.startsWith(lower)) s += 80;
      if (p.name.startsWith(term)) s += 120;
      if (p.nameInitials.includes(lower)) s += 40;
      if (p.namePinyin.includes(lower)) s += 30;
      if (p.name.includes(term)) s += 50;
      return s;
    };

    const picked = candidates
      .map((p) => ({ p, s: score(p) }))
      .sort((a, b) => {
        if (b.s !== a.s) return b.s - a.s;
        if (b.p.usageCount !== a.p.usageCount) return b.p.usageCount - a.p.usageCount;
        return a.p.name.localeCompare(b.p.name, "zh-CN");
      })
      .slice(0, limit);

    const stockMap = await loadStock(picked.map((x) => x.p));
    return picked.map((x) => toView(x.p, stockMap));
  },

  async create(input: CreateProductInput, actor: { userId: string }): Promise<ProductView> {
    const name = input.name.trim();

    if (!input.forceCreate) {
      const existing = await productRepository.findByName(name);
      if (existing) {
        throw new ConflictError("已存在同名产品", {
          existing: {
            id: existing.id,
            name: existing.name,
            colors: existing.skus.map((s) => ({
              colorName: s.colorName,
              variantType: s.variantType,
            })),
          },
          hint: "可以直接给这个产品加颜色，而不是新建一个同名产品",
        });
      }
    }

    const colors = normalizeColors(input.colors);
    if (colors.length === 0) throw new ValidationError("至少要有一个颜色行");

    const pinyin = buildPinyinIndex(name);

    const created = await productRepository.createWithSkus(
      {
        name,
        namePinyin: pinyin.full,
        nameInitials: pinyin.initials,
        category: input.category ?? null,
        unit: input.unit,
        imageUrl: input.imageUrl ?? null,
        description: input.description ?? null,
        profileStatus: resolveProfileStatus(input.imageUrl ?? null),
        createdById: actor.userId,
      },
      colors.map((c) => ({
        colorName: c.colorName,
        variantType: c.variantType,
        safetyStock: c.safetyStock,
        skuCode: generateSkuCode(),
      })),
    );

    await writeAudit(actor.userId, "product.create", created.id, `新建产品「${created.name}」`);

    return toView(created);
  },

  async update(
    id: string,
    input: UpdateProductInput,
    actor: { userId: string },
  ): Promise<ProductView> {
    const current = await productRepository.findById(id);
    if (!current) throw new NotFoundError("找不到该产品，可能已被删除");

    const name = input.name?.trim() ?? current.name;

    if (name !== current.name) {
      const clash = await productRepository.findByName(name);
      if (clash && clash.id !== id) {
        throw new ConflictError("已存在同名产品", {
          existing: { id: clash.id, name: clash.name },
        });
      }
    }

    const pinyin = name !== current.name ? buildPinyinIndex(name) : null;

    const incoming = input.colors ? normalizeColors(input.colors) : null;
    if (incoming && incoming.length === 0) {
      throw new ValidationError("至少要保留一个颜色行");
    }

    const existingById = new Map(current.skus.map((s) => [s.id, s]));

    const createRows = (incoming ?? []).filter((c) => !c.id || !existingById.has(c.id));
    const updateRows = (incoming ?? [])
      .filter((c) => c.id && existingById.has(c.id))
      .map((c) => ({
        id: c.id!,
        colorName: c.colorName,
        variantType: c.variantType,
        safetyStock: c.safetyStock,
      }));

    const keptIds = new Set(updateRows.map((r) => r.id));
    const removeIds = incoming
      ? [...existingById.keys()].filter((skuId) => !keptIds.has(skuId))
      : [];

    // 名称/规格重复的兜底校验（前端会拦，但后端不能只靠前端）
    if (incoming) {
      const seen = new Set<string>();
      for (const row of incoming) {
        const key = `${row.colorName ?? ""}__${row.variantType}`;
        if (seen.has(key)) {
          throw new ValidationError(
            row.colorName
              ? `颜色「${row.colorName}」在同样的规格下重复了，请合并成一行`
              : "「无颜色」的行重复了",
          );
        }
        seen.add(key);
      }
    }

    const imageUrl = input.imageUrl !== undefined ? blankToNull(input.imageUrl) : current.imageUrl;

    const updated = await productRepository.updateWithSkus(
      id,
      {
        ...(input.name !== undefined ? { name } : {}),
        ...(pinyin ? { namePinyin: pinyin.full, nameInitials: pinyin.initials } : {}),
        ...(input.category !== undefined ? { category: blankToNull(input.category) } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: blankToNull(input.imageUrl) } : {}),
        ...(input.description !== undefined ? { description: blankToNull(input.description) } : {}),
        profileStatus: resolveProfileStatus(imageUrl ?? null),
      },
      {
        create: createRows.map((c) => ({
          colorName: c.colorName,
          variantType: c.variantType,
          safetyStock: c.safetyStock,
          skuCode: generateSkuCode(),
        })),
        update: updateRows,
        removeIds,
      },
    );

    await writeAudit(actor.userId, "product.update", id, `修改产品「${updated.name}」`);

    return toView(updated, await loadStock([updated]));
  },

  async remove(id: string, actor: { userId: string }): Promise<void> {
    const current = await productRepository.findById(id);
    if (!current) throw new NotFoundError("找不到该产品，可能已被删除");

    await productRepository.softDelete(id);
    await writeAudit(actor.userId, "product.delete", id, `删除产品「${current.name}」`);
  },

  async categories(): Promise<string[]> {
    return productRepository.listCategories();
  },

  async colorNames(): Promise<string[]> {
    return productRepository.listColorNames();
  },
};

/** 审计日志：写失败不能影响主流程，只记错误 */
async function writeAudit(
  userId: string,
  action: string,
  entityId: string,
  summary: string,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { userId, action, entityType: "product", entityId, summary },
    });
  } catch {
    // 审计失败不阻断业务，但不应静默——P2 接入统一日志后在此上报
  }
}
