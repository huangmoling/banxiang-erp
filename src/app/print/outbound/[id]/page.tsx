import { notFound } from "next/navigation";
import { isAppError } from "@/lib/errors";
import { outboundService } from "@/modules/outbound/outbound.service";
import { PrintSheet } from "./print-sheet";

export const dynamic = "force-dynamic";

type Mode = "pick" | "label";
type Scope = "unshipped" | "shipped" | "all";

/**
 * 打印页：故意放在 (app) 组外面——没有侧栏、没有顶栏，
 * 屏幕上看到的就是纸上会印出来的样子，打印时不用再藏一堆界面元素。
 */
export default async function PrintOutboundPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string; scope?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  let doc;
  try {
    doc = await outboundService.detail(id);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }

  const mode: Mode = sp.mode === "label" ? "label" : "pick";
  const scope: Scope =
    sp.scope === "shipped" || sp.scope === "all" ? sp.scope : "unshipped";

  return <PrintSheet doc={doc} mode={mode} scope={scope} />;
}
