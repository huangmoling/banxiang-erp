import { inboundService } from "@/modules/inbound/inbound.service";
import { InboundForm } from "../inbound-form";

export const dynamic = "force-dynamic";

export default async function NewInboundPage() {
  const meta = await inboundService.meta();
  return <InboundForm meta={meta} />;
}
