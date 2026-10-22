import { scrapService } from "@/modules/scrap/scrap.service";
import { ScrapsClient } from "./scraps-client";

export const dynamic = "force-dynamic";

export default async function ScrapsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const initialStatus =
    status === "draft" || status === "approved" || status === "voided" ? status : ("all" as const);

  const initial = await scrapService.list({
    q: "",
    status: initialStatus,
    page: 1,
    pageSize: 20,
  });

  return <ScrapsClient initial={initial} initialStatus={initialStatus} />;
}
