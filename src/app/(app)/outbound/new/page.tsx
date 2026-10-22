import { getSession } from "@/lib/session";
import { outboundService } from "@/modules/outbound/outbound.service";
import { OutboundForm } from "../outbound-form";

export const dynamic = "force-dynamic";

export default async function NewOutboundPage() {
  const [meta, user] = await Promise.all([outboundService.meta(), getSession()]);
  // 内勤只能提交工单：按钮按角色少给一个是一个，但真正的拦截在后端
  return <OutboundForm meta={meta} role={user?.role ?? "viewer"} />;
}
