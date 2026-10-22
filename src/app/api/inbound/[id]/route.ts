import { defineRoute } from "@/lib/api-handler";
import { inboundService } from "@/modules/inbound/inbound.service";

export const GET = defineRoute<{ id: string }>(async ({ params }) => {
  return inboundService.detail(params.id);
});

/**
 * 删除入库单：**只给管理员**。
 *
 * 入库错一笔，库存数字就直接失真，所以这个按钮不放在仓管手里：
 * 草稿由店长/管理员删，已生效的只有管理员能彻底删除（含回滚批次与流水）。
 * 普通账号点不到这个接口，硬敲 URL 也会被 403 拦住。
 */
export const DELETE = defineRoute<{ id: string }>(
  async ({ params, user }) => {
    return inboundService.remove(params.id, { userId: user.id });
  },
  { roles: ["admin"] },
);

export const runtime = "nodejs";
