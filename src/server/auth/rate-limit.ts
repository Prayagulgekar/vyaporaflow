/**
 * Small in-memory fixed-window limiter for login, registration and the
 * contact form. Per server instance only; use a shared store (e.g. Redis or
 * Supabase rate limits) when running several instances.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

/** Forget a key, e.g. after a successful sign-in so only failed attempts are limited. */
export function clearRateLimit(key: string) {
  buckets.delete(key);
}
