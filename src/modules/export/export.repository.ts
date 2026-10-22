import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/** 导出专用仓储层：只负责把「要导出的原始行」取回来，格式交出去 */
export const exportRepository = {
  documents(params: { type?: string; from?: Date; to?: Date }) {
    const where: Prisma.DocumentWhereInput = {
      ...(params.type && params.type !== "all" ? { type: params.type } : {}),
      ...(params.from || params.to
        ? {
            bizDate: {
              ...(params.from ? { gte: params.from } : {}),
              ...(params.to ? { lte: params.to } : {}),
            },
          }
        : {}),
    };

    return prisma.document.findMany({
      where,
      select: {
        docNo: true,
        type: true,
        status: true,
        bizDate: true,
        itemCount: true,
        totalQty: true,
        remark: true,
        externalNo: true,
        receiverName: true,
        approvedAt: true,
        voidedAt: true,
        voidReason: true,
        location: { select: { name: true } },
        createdBy: { select: { displayName: true } },
        approvedBy: { select: { displayName: true } },
        voidedBy: { select: { displayName: true } },
      },
      orderBy: [{ bizDate: "desc" }, { createdAt: "desc" }],
      take: 5000,
    });
  },

  /** 处置单明细：损耗台账的原始行 */
  disposalItems(params: { from?: Date; to?: Date }) {
    return prisma.documentItem.findMany({
      where: {
        document: {
          type: "scrap",
          ...(params.from || params.to
            ? {
                bizDate: {
                  ...(params.from ? { gte: params.from } : {}),
                  ...(params.to ? { lte: params.to } : {}),
                },
              }
            : {}),
        },
      },
      select: {
        qty: true,
        disposition: true,
        remark: true,
        sku: {
          select: { colorName: true, variantType: true, product: { select: { name: true, unit: true } } },
        },
        document: {
          select: {
            docNo: true,
            status: true,
            bizDate: true,
            location: { select: { name: true } },
            createdBy: { select: { displayName: true } },
            approvedBy: { select: { displayName: true } },
          },
        },
      },
      orderBy: [{ document: { bizDate: "desc" } }],
      take: 5000,
    });
  },
};

export type ExportRepository = typeof exportRepository;
