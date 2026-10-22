import { scrapService } from "@/modules/scrap/scrap.service";
import { ScrapForm } from "../scrap-form";

export const dynamic = "force-dynamic";

export default async function NewScrapPage({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string; skuId?: string; disposition?: string }>;
}) {
  const [meta, sp] = await Promise.all([scrapService.meta(), searchParams]);

  // 从次品区页面点某一行进来时，直接把仓位和那个款带上，少点两次
  const initialLocationId =
    sp.locationId && meta.locations.some((l) => l.id === sp.locationId)
      ? sp.locationId
      : (meta.defectiveId ?? meta.locations[0]?.id ?? null);

  const presetDisposition =
    sp.disposition === "scrap" || sp.disposition === "offline_sale" || sp.disposition === "self_dispose"
      ? sp.disposition
      : null;

  return (
    <ScrapForm
      meta={meta}
      initialLocationId={initialLocationId}
      presetSkuId={sp.skuId ?? null}
      presetDisposition={presetDisposition}
    />
  );
}
