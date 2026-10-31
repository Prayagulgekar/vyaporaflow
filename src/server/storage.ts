import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";
import { AppError } from "@/server/errors";
import { createSupabaseServerClient } from "@/server/auth/supabase";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function sniff(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * Store a product image or logo under <companyId>/<kind>/<uuid>.<ext>.
 * Demo mode writes to DEMO_UPLOAD_DIR (served by /api/files). Production
 * uploads to Supabase Storage as the signed-in user, so the bucket policies
 * (owners/managers of that company only) apply. Callers must authorize first.
 */
export async function saveCompanyImage(companyId: string, kind: "products" | "logo", file: File): Promise<string> {
  if (!/^[0-9a-f-]{36}$/.test(companyId)) throw new AppError("validation", "Invalid company");
  if (file.size === 0) throw new AppError("validation", "Choose an image to upload");
  if (file.size > MAX_IMAGE_BYTES) throw new AppError("validation", "Images must be 2 MB or smaller");
  const buf = Buffer.from(await file.arrayBuffer());
  const type = sniff(buf);
  if (!type) throw new AppError("validation", "Upload a PNG, JPEG or WebP image");
  const rel = `${companyId}/${kind}/${randomUUID()}.${TYPES[type]}`;
  const env = getEnv();
  if (env.APP_MODE === "demo") {
    const target = path.join(path.resolve(env.DEMO_UPLOAD_DIR), rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buf);
    return rel;
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).upload(rel, buf, { contentType: type, upsert: false });
  if (error) throw new AppError("forbidden", `Upload failed: ${error.message}`);
  return rel;
}

/** Public URL for a stored image path. */
export function imageUrl(p: string | null | undefined): string | null {
  if (!p) return null;
  const env = getEnv();
  if (env.APP_MODE === "demo") return `/api/files/${p}`;
  return `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${env.SUPABASE_STORAGE_BUCKET}/${p}`;
}
