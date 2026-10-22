import { returnService } from "@/modules/returns/return.service";
import { ReturnsClient } from "./returns-client";

export const dynamic = "force-dynamic";

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const initialStatus =
    status === "draft" || status === "approved" ? status : ("all" as const);

  const initial = await returnService.list({
    q: "",
    status: initialStatus,
    page: 1,
    pageSize: 20,
  });

  return <ReturnsClient initial={initial} initialStatus={initialStatus} />;
}
