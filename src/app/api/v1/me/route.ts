import { NextResponse } from "next/server";
import { getViewer } from "@/server/viewer";

export const dynamic = "force-dynamic";

export async function GET() {
  const v = await getViewer();
  if (!v) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return NextResponse.json({
    id: v.userId,
    email: v.email,
    accountType: v.accountType,
    isAdmin: v.isAdmin,
    memberships: v.memberships.map((m) => ({ companyId: m.companyId, companyName: m.companyName, kind: m.companyKind, role: m.role })),
  });
}
