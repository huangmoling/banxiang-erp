import { defineRoute } from "@/lib/api-handler";
import { outboundService } from "@/modules/outbound/outbound.service";

/** 内勤、仓管、店长、管理员都能提交工单 */
const SUBMIT_ROLES = ["admin", "manager", "keeper", "clerk"];

/**
 * 提交发货工单：草稿 → 待发货。
 * 只打一个提交时间戳，库存、批次、定制件一概不动。
 * 顺带跑一次缺货体检，返回 warnings 给界面做黄色提醒（提醒但不拦）。
 */
export const POST = defineRoute<{ id: string }>(
  async ({ params, user }) => {
    return outboundService.submit(params.id, { userId: user.id, role: user.role });
  },
  { roles: SUBMIT_ROLES },
);

export const runtime = "nodejs";
