import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Liveness and database check for load balancers. Reveals no configuration values. */
export async function GET() {
  try {
    const env = getEnv();
    const db = await getDb();
    await db.transaction({ kind: "anon" }, (q) => q.query("select 1"));
    return NextResponse.json({ ok: true, mode: env.APP_MODE });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
