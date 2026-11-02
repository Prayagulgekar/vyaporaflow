import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/server/errors";
import {
  loadBalanceDue,
  loadInvoicePdf,
  loadReceipt,
  loadStatement,
  renderBalanceDue,
  renderReceipt,
  renderStatement,
  resolveStatementPeriod,
  type PdfFile,
} from "@/server/documents";
import { ACTIVE_COMPANY_COOKIE, getViewer } from "@/server/viewer";
import { pdfResponse } from "@/server/pdf/response";

/**
 * PDF documents for the signed-in wholesaler's office staff:
 *   /w/documents/balance-due/<retailerId>
 *   /w/documents/statement/<retailerId>?from=YYYY-MM-DD&to=YYYY-MM-DD  or  ?month=YYYY-MM
 *   /w/documents/invoice/<invoiceId>
 *   /w/documents/receipt/<paymentId>
 * Add ?download=1 to save the file instead of opening it.
 * Data is read through RLS as the user; another company's records are 404.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const preferred = (await cookies()).get(ACTIVE_COMPANY_COOKIE)?.value;
  const staff = viewer.memberships.filter((m) => m.companyKind === "wholesaler" && m.role !== "delivery_worker");
  const company = staff.find((m) => m.companyId === preferred) ?? staff[0];
  if (!company) return NextResponse.json({ error: "Not a wholesaler" }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  try {
    let file: PdfFile;
    if (kind === "balance-due") file = await renderBalanceDue(await loadBalanceDue(viewer.userId, company.companyId, id));
    else if (kind === "statement") {
      const range = resolveStatementPeriod({ month: sp.get("month"), from: sp.get("from"), to: sp.get("to") });
      file = await renderStatement(await loadStatement(viewer.userId, company.companyId, id, range));
    } else if (kind === "invoice") {
      const { inv, file: f } = await loadInvoicePdf(viewer.userId, id);
      if (inv.wholesaler_id !== company.companyId) throw new AppError("not_found", "Invoice not found");
      file = f;
    } else if (kind === "receipt") {
      const m = await loadReceipt(viewer.userId, id);
      if (m.payment.wholesaler_id !== company.companyId) throw new AppError("not_found", "Payment not found");
      file = await renderReceipt(m);
    } else return NextResponse.json({ error: "Unknown document" }, { status: 404 });
    return pdfResponse(file, sp.get("download") === "1");
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: err.kind === "forbidden" ? 404 : err.status });
    throw err;
  }
}
