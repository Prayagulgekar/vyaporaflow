import { NextResponse, type NextRequest } from "next/server";
import { csvEscape, exportProductsCsv } from "@/server/catalog";
import { exportInvoicesCsv, exportOrdersCsv, resolvePeriod } from "@/server/reports";
import { getViewer } from "@/server/viewer";
import { cookies } from "next/headers";
import { ACTIVE_COMPANY_COOKIE } from "@/server/viewer";

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "\n";
  const headers = Object.keys(rows[0]!);
  return [headers.join(","), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(","))].join("\n") + "\n";
}

/** CSV downloads for the signed-in wholesaler. Data is read through RLS as the user. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const preferred = (await cookies()).get(ACTIVE_COMPANY_COOKIE)?.value;
  const staff = viewer.memberships.filter((m) => m.companyKind === "wholesaler" && m.role !== "delivery_worker");
  const company = staff.find((m) => m.companyId === preferred) ?? staff[0];
  if (!company) return NextResponse.json({ error: "Not a wholesaler" }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const period = resolvePeriod(sp.get("period") ?? undefined, sp.get("from") ?? undefined, sp.get("to") ?? undefined);
  let body: string;
  if (kind === "products") body = await exportProductsCsv(viewer.userId, company.companyId);
  else if (kind === "orders") body = toCsv(await exportOrdersCsv(viewer.userId, company.companyId, period));
  else if (kind === "invoices") body = toCsv(await exportInvoicesCsv(viewer.userId, company.companyId, period));
  else return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  const name = `${company.companySlug}-${kind}${kind === "products" ? "" : `-${period.from}-to-${period.to}`}.csv`;
  return new NextResponse("﻿" + body, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
