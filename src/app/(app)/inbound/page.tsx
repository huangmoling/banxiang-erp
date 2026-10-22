import { inboundService } from "@/modules/inbound/inbound.service";
import { InboundClient } from "./inbound-client";

export const dynamic = "force-dynamic";

export default async function InboundPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const initialStatus =
    status === "draft" || status === "approved" ? status : ("all" as const);

  const initial = await inboundService.list({
    q: "",
    status: initialStatus,
    page: 1,
    pageSize: 20,
  });

  return <InboundClient initial={initial} initialStatus={initialStatus} />;
}
