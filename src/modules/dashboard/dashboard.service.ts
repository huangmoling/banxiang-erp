import "server-only";
import { prisma } from "@/lib/prisma";
import { startOfMonth } from "@/lib/date";
import { stockRepository } from "@/modules/inventory/stock.repository";

export type DashboardOverview = {
  /** 库存与流水口径的数字：全部由 stock_movements 推导，没有任何可编辑的库存字段 */
  stock: {
    /** 可售在库（主仓），不含次品区 */
    onHand: number;
    /** 次品区当前件数，单独统计 */
    defective: number;
    inboundThisMonth: number;
    outboundThisMonth: number;
    returnedThisMonth: number;
  };
  /** 流水是否已接入（P2 起为 true） */
  flowReady: boolean;
  products: {
    total: number;
    skuTotal: number;
    pending: number;
    categories: number;
  };
  recent: {
    id: string;
    summary: string;
    actor: string;
    at: string;
  }[];
};

export const dashboardService = {
  async overview(): Promise<DashboardOverview> {
    const monthStart = startOfMonth();

    const [
      onHand,
      defective,
      inboundThisMonth,
      outboundThisMonth,
      returnedThisMonth,
      total,
      pending,
      skuTotal,
      categoryRows,
      recentLogs,
    ] = await Promise.all([
      stockRepository.onHand(),
      stockRepository.defectiveQty(),
      stockRepository.sumByBizTypesSince(["inbound"], monthStart),
      stockRepository.sumByBizTypesSince(["outbound"], monthStart, "out"),
      stockRepository.sumByBizTypesSince(["return_in"], monthStart),
      prisma.product.count({ where: { isActive: true } }),
      prisma.product.count({ where: { isActive: true, profileStatus: "pending" } }),
      prisma.sku.count({ where: { isActive: true } }),
      prisma.product.findMany({
        where: { isActive: true, category: { not: null } },
        select: { category: true },
        distinct: ["category"],
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          summary: true,
          createdAt: true,
          user: { select: { displayName: true } },
        },
      }),
    ]);

    return {
      stock: {
        onHand,
        defective,
        inboundThisMonth,
        outboundThisMonth,
        returnedThisMonth,
      },
      flowReady: true,
      products: {
        total,
        skuTotal,
        pending,
        categories: categoryRows.length,
      },
      recent: recentLogs.map((l) => ({
        id: l.id,
        summary: l.summary,
        actor: l.user?.displayName ?? "系统",
        at: l.createdAt.toISOString(),
      })),
    };
  },
};
