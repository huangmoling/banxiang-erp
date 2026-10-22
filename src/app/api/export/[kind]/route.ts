import { defineRoute } from "@/lib/api-handler";
import { NotFoundError } from "@/lib/errors";
import { exportQuerySchema } from "@/modules/export/export.schema";
import { EXPORT_KINDS, exportService, type ExportKind } from "@/modules/export/export.service";

/**
 * 表格导出：/api/export/inventory、/api/export/movements …
 * 返回 text/csv，浏览器直接下载。文件名带日期，导十次不会互相覆盖。
 */
export const GET = defineRoute<{ kind: string }>(async ({ req, params }) => {
  const kind = params.kind as ExportKind;
  if (!EXPORT_KINDS.includes(kind)) {
    throw new NotFoundError("不支持这种导出，请从页面上的导出按钮操作");
  }

  const query = exportQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  return exportService.build(kind, query);
});

export const runtime = "nodejs";
