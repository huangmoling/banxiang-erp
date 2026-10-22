import { outboundService } from "@/modules/outbound/outbound.service";
import { OutboundForm } from "../outbound-form";

export const dynamic = "force-dynamic";

export default async function NewOutboundPage() {
  const meta = await outboundService.meta();
  return <OutboundForm meta={meta} />;
}
