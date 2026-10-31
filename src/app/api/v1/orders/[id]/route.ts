import { NextResponse } from "next/server";
import { apiError } from "@/server/api";
import { getOrder } from "@/server/orders";
import { getSessionUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/** An order, read through RLS as the signed-in user. Other businesses' orders return 404. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    return NextResponse.json(await getOrder(user.id, (await params).id));
  } catch (err) {
    return apiError(err);
  }
}
