import { defineRoute } from "@/lib/api-handler";
import { updateOutboundItemSchema } from "@/modules/outbound/outbound.schema";
import { outboundService } from "@/modules/outbound/outbound.service";

/** 能开单 / 改自己整理的单。内勤也在里面，服务层限制他只能动自己开的单 */
const WRITE_ROLES = ["admin", "manager", "keeper", "clerk"];

type Params = { id: string; itemId: string };

/**
 * 改某一行的收货信息 / 订单号 / 物流单号。
 * 一张单里几十个买家，地址填错了要能单独改一行，不能逼人删整单重录。
 * 已发出的行会被服务层拒绝：货在路上了，改地址只会让账和箱子对不上。
 */
export const PATCH = defineRoute<Params>(
  async ({ params, req, user }) => {
    const body = updateOutboundItemSchema.parse(await req.json());
    return outboundService.updateItemInfo(params.id, params.itemId, body, {
      userId: user.id,
      role: user.role,
    });
  },
  { roles: WRITE_ROLES },
);

/**
 * 删掉某一行（只限没发出去的）。
 * 客户取消、货彻底没有了就走这里；删完如果剩下的行都发过了，单据自动结案。
 */
export const DELETE = defineRoute<Params>(
  async ({ params, user }) => {
    return outboundService.removeItem(params.id, params.itemId, {
      userId: user.id,
      role: user.role,
    });
  },
  { roles: WRITE_ROLES },
);

export const runtime = "nodejs";
