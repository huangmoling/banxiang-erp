import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const skuSelect = {
  id: true,
  productId: true,
  colorName: true,
  variantType: true,
  skuCode: true,
  barcode: true,
  safetyStock: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.SkuSelect;

export const productSelect = {
  id: true,
  name: true,
  namePinyin: true,
  nameInitials: true,
  category: true,
  unit: true,
  imageUrl: true,
  description: true,
  profileStatus: true,
  usageCount: true,
  lastUsedAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  skus: {
    where: { isActive: true },
    // 按录入顺序展示：用户先填的那一行就在最上面，不做字母/类型重排
    orderBy: [{ createdAt: "asc" }],
    select: skuSelect,
  },
} satisfies Prisma.ProductSelect;

export type ProductRecord = Prisma.ProductGetPayload<{ select: typeof productSelect }>;
export type SkuRecord = Prisma.SkuGetPayload<{ select: typeof skuSelect }>;

export type CreateSkuData = {
  colorName: string | null;
  variantType: string;
  skuCode: string;
  safetyStock: number;
};

export const productRepository = {
  findById(id: string): Promise<ProductRecord | null> {
    return prisma.product.findFirst({
      where: { id, isActive: true },
      select: productSelect,
    });
  },

  findByName(name: string) {
    return prisma.product.findFirst({
      where: { name, isActive: true },
      select: { id: true, name: true, skus: { where: { isActive: true }, select: skuSelect } },
    });
  },

  countAll(): Promise<number> {
    return prisma.product.count({ where: { isActive: true } });
  },

  countPending(): Promise<number> {
    return prisma.product.count({ where: { isActive: true, profileStatus: "pending" } });
  },

  createWithSkus(
    data: {
      name: string;
      namePinyin: string;
      nameInitials: string;
      category: string | null;
      unit: string;
      imageUrl: string | null;
      description: string | null;
      profileStatus: string;
      createdById: string | null;
    },
    skus: CreateSkuData[],
  ): Promise<ProductRecord> {
    return prisma.$transaction(async (tx) => {
      const created = await tx.product.create({ data });
      for (const sku of skus) {
        await tx.sku.create({ data: { ...sku, productId: created.id } });
      }
      return tx.product.findUniqueOrThrow({ where: { id: created.id }, select: productSelect });
    });
  },

  updateWithSkus(
    id: string,
    data: Prisma.ProductUpdateInput,
    changes: {
      create: CreateSkuData[];
      update: { id: string; colorName: string | null; variantType: string; safetyStock: number }[];
      removeIds: string[];
    },
  ): Promise<ProductRecord> {
    return prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data });

      for (const item of changes.update) {
        await tx.sku.update({
          where: { id: item.id },
          data: {
            colorName: item.colorName,
            variantType: item.variantType,
            safetyStock: item.safetyStock,
          },
        });
      }

      for (const skuId of changes.removeIds) {
        // 软删除：保留历史引用（P2 起若有流水，绝不能物理删除）
        await tx.sku.update({ where: { id: skuId }, data: { isActive: false } });
      }

      for (const sku of changes.create) {
        await tx.sku.create({ data: { ...sku, productId: id } });
      }

      return tx.product.findUniqueOrThrow({ where: { id }, select: productSelect });
    });
  },

  softDelete(id: string) {
    return prisma.product.update({ where: { id }, data: { isActive: false } });
  },

  async list(params: {
    q: string;
    status: "all" | "pending" | "complete";
    category?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: ProductRecord[]; total: number }> {
    const q = params.q.trim();
    const lower = q.toLowerCase();

    const where: Prisma.ProductWhereInput = {
      isActive: true,
      ...(params.status !== "all" ? { profileStatus: params.status } : {}),
      ...(params.category ? { category: params.category } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { namePinyin: { contains: lower } },
              { nameInitials: { contains: lower } },
              { category: { contains: q } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: productSelect,
        orderBy: [{ updatedAt: "desc" }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      prisma.product.count({ where }),
    ]);

    return { items, total };
  },

  /** 选品搜索的候选集：多取一些，排序交给服务层（前缀命中优先） */
  searchCandidates(q: string, take: number): Promise<ProductRecord[]> {
    const lower = q.toLowerCase();
    return prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: q } },
          { namePinyin: { contains: lower } },
          { nameInitials: { contains: lower } },
        ],
      },
      select: productSelect,
      orderBy: [{ usageCount: "desc" }, { updatedAt: "desc" }],
      take,
    });
  },

  listAll(): Promise<ProductRecord[]> {
    return prisma.product.findMany({
      where: { isActive: true },
      select: productSelect,
      orderBy: [{ name: "asc" }],
    });
  },

  /** 历史颜色名：用于录入时的自动补全，避免「米白 / 米白色」分裂成两个色 */
  listColorNames(): Promise<string[]> {
    return prisma.sku
      .findMany({
        where: { isActive: true, colorName: { not: null } },
        select: { colorName: true },
        distinct: ["colorName"],
      })
      .then((rows) =>
        rows.map((r) => r.colorName).filter((c): c is string => !!c && c.trim().length > 0).sort(),
      );
  },

  listCategories(): Promise<string[]> {
    return prisma.product
      .findMany({
        where: { isActive: true, category: { not: null } },
        select: { category: true },
        distinct: ["category"],
      })
      .then((rows) => rows.map((r) => r.category).filter((c): c is string => !!c).sort());
  },

  touchUsage(id: string) {
    return prisma.product.update({
      where: { id },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    });
  },
};
