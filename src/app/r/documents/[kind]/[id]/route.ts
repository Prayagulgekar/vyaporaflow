import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/server/errors";
import { loadInvoicePdf, loadStatement, renderStatement, resolveStatementPeriod, type PdfFile } from "@/server/documents";
import { ACTIVE_COMPANY_COOKIE, getViewer } from "@/server/viewer";
import { pdfResponse } from "@/server/pdf/response";

/**
 * PDF documents for the signed-in retailer:
 *   /r/documents/invoice/<invoiceId>
 *   /r/documents/statement/<wholesalerId>?from=&to=  or  ?month=YYYY-MM
 * Data is read through RLS as the user; other shops' records are 404.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const preferred = (await cookies()).get(ACTIVE_COMPANY_COOKIE)?.value;
  const shops = viewer.memberships.filter((m) => m.companyKind === "retailer");
  const company = shops.find((m) => m.companyId === preferred) ?? shops[0];
  if (!company) return NextResponse.json({ error: "Not a retailer" }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  try {
    let file: PdfFile;
    if (kind === "invoice") {
      const { inv, file: f } = await loadInvoicePdf(viewer.userId, id);
      if (inv.retailer_id !== company.companyId) throw new AppError("not_found", "Invoice not found");
      file = f;
    } else if (kind === "statement") {
      const range = resolveStatementPeriod({ month: sp.get("month"), from: sp.get("from"), to: sp.get("to") });
      file = await renderStatement(await loadStatement(viewer.userId, id, company.companyId, range));
    } else return NextResponse.json({ error: "Unknown document" }, { status: 404 });
    return pdfResponse(file, sp.get("download") === "1");
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: err.kind === "forbidden" ? 404 : err.status });
    throw err;
  }
}
