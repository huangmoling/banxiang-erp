import { outboundService } from "@/modules/outbound/outbound.service";
import { OutboundClient } from "./outbound-client";

export const dynamic = "force-dynamic";

export default async function OutboundPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const initialStatus =
    status === "draft" || status === "approved" ? status : ("all" as const);

  const initial = await outboundService.list({
    q: "",
    status: initialStatus,
    page: 1,
    pageSize: 20,
  });

  return <OutboundClient initial={initial} initialStatus={initialStatus} />;
}
