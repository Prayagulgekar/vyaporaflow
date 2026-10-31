import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/**
 * Demo mode only: serves uploaded product images and logos from DEMO_UPLOAD_DIR.
 * Paths are strictly validated (<uuid>/<products|logo>/<uuid>.<ext>), so this
 * cannot read anything else on disk. Production images come from Supabase Storage.
 */
export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const env = getEnv();
  if (env.APP_MODE !== "demo") return new NextResponse("Not found", { status: 404 });
  const parts = (await params).path;
  const rel = parts.join("/");
  const m = /^[0-9a-f-]{36}\/(products|logo)\/[0-9a-f-]{36}\.(png|jpg|webp)$/.exec(rel);
  if (!m) return new NextResponse("Not found", { status: 404 });
  try {
    const buf = await readFile(path.join(path.resolve(env.DEMO_UPLOAD_DIR), rel));
    return new NextResponse(new Uint8Array(buf), {
      headers: { "content-type": TYPES[m[2]!]!, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
