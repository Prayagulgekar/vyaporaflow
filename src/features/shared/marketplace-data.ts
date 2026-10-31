import "server-only";
import { listCategories } from "@/server/catalog";
import { listCities, normaliseRadius, resolveLocation, searchWholesalers, type SearchLocation } from "@/server/marketplace";
import type { SearchState } from "./marketplace-search";

/** Shared loader for the public marketplace and the retailer discover page. */
export async function loadMarketplace(userId: string | null, sp: Record<string, string | undefined>, fallback: SearchLocation | null) {
  // Device coordinates apply only when no PIN code or city was typed, so typing one overrides an earlier GPS search.
  const gps = !sp.pincode && !sp.city;
  const s: SearchState = { q: sp.q, city: sp.city, pincode: sp.pincode, lat: gps ? sp.lat : undefined, lng: gps ? sp.lng : undefined, radius: normaliseRadius(sp.radius), category: sp.category };
  const [cities, categoryRows, resolved] = await Promise.all([listCities(), listCategories(), resolveLocation({ lat: s.lat, lng: s.lng, city: sp.city, pincode: sp.pincode })]);
  const loc = resolved.location ?? (resolved.error ? null : fallback);
  const results = loc ? await searchWholesalers(userId, loc, { radius: s.radius, q: s.q, category: s.category, page: Number(sp.page) || 1 }) : null;
  const categories = categoryRows.filter((c) => c.company_id === null).map((c) => ({ slug: c.slug, name: c.name }));
  return { s, cities, categories, loc, error: resolved.error, results };
}
