import "server-only";
import { DEFAULT_RADIUS_KM, SEARCH_RADII_KM, isValidCoordinate, isValidPincode, type Coverage } from "@/domain/geo";
import { asAnon, asUser } from "@/server/db";
import { toAppError } from "@/server/errors";
import { callFn } from "@/server/rpc";

export interface SearchLocation {
  lat: number;
  lng: number;
  label: string;
  pincode: string | null;
  source: "device" | "city" | "pincode" | "shop";
}

export interface WholesalerResult {
  company_id: string;
  slug: string;
  name: string;
  logo_path: string | null;
  city: string;
  state_code: string;
  pincode: string;
  distance_km: string;
  business_category: string;
  categories: string[];
  product_count: number;
  matching_products: number;
  offers_delivery: boolean;
  coverage: Coverage;
  min_order_value: string;
  delivery_charge: string;
  free_delivery_above: string | null;
  is_open: boolean | null;
  verification_status: string;
  name_match: boolean;
  total_count: number;
}

async function run<T>(userId: string | null, fn: Parameters<typeof asAnon<T>>[0]): Promise<T> {
  try {
    return userId ? await asUser(userId, fn) : await asAnon(fn);
  } catch (err) {
    throw toAppError(err);
  }
}

export async function listCities() {
  return run(null, (q) =>
    q.query<{ name: string; state_code: string; latitude: string; longitude: string }>(
      "select name, state_code, latitude, longitude from public.geo_places where kind = 'city' order by name",
    ),
  );
}

/** Resolve a location from explicit coordinates, a city name or a PIN code (bundled approximate lookup). */
export async function resolveLocation(params: {
  lat?: string;
  lng?: string;
  city?: string;
  pincode?: string;
  label?: string;
}): Promise<{ location: SearchLocation | null; error: string | null }> {
  const lat = Number(params.lat);
  const lng = Number(params.lng);
  if (params.lat && params.lng && isValidCoordinate(lat, lng)) {
    return {
      location: { lat, lng, label: params.label?.slice(0, 80) || "Your current location", pincode: params.pincode && isValidPincode(params.pincode) ? params.pincode : null, source: "device" },
      error: null,
    };
  }
  if (params.pincode) {
    const pin = params.pincode.trim();
    if (!isValidPincode(pin)) return { location: null, error: "Enter a valid 6-digit PIN code" };
    const rows = await run(null, (q) =>
      q.query<{ name: string; latitude: string; longitude: string }>(
        "select name, latitude, longitude from public.geo_places where kind = 'pincode' and pincode = $1",
        [pin],
      ),
    );
    if (!rows[0]) {
      return {
        location: null,
        error: `PIN code ${pin} is not in the built-in location list yet. Choose a nearby city or use your device location.`,
      };
    }
    return { location: { lat: Number(rows[0].latitude), lng: Number(rows[0].longitude), label: `${rows[0].name} (${pin})`, pincode: pin, source: "pincode" }, error: null };
  }
  if (params.city) {
    const rows = await run(null, (q) =>
      q.query<{ name: string; latitude: string; longitude: string }>(
        "select name, latitude, longitude from public.geo_places where kind = 'city' and lower(name) = lower($1)",
        [params.city!.trim()],
      ),
    );
    if (!rows[0]) return { location: null, error: "That city is not in the location list. Try a PIN code or your device location." };
    return { location: { lat: Number(rows[0].latitude), lng: Number(rows[0].longitude), label: rows[0].name, pincode: null, source: "city" }, error: null };
  }
  return { location: null, error: null };
}

export function normaliseRadius(raw: unknown): number {
  const n = Number(raw);
  return (SEARCH_RADII_KM as readonly number[]).includes(n) ? n : DEFAULT_RADIUS_KM;
}

export async function searchWholesalers(
  userId: string | null,
  loc: SearchLocation,
  opts: { radius: number; q?: string; category?: string; page?: number; pageSize?: number },
) {
  const size = opts.pageSize ?? 12;
  const page = Math.max(1, opts.page ?? 1);
  const rows = await run(userId, (q) =>
    q.query<WholesalerResult>("select * from app.search_wholesalers($1, $2, $3, $4, $5, $6, $7, $8)", [
      loc.lat,
      loc.lng,
      opts.radius,
      opts.q?.trim() || null,
      opts.category || null,
      loc.pincode,
      size,
      (page - 1) * size,
    ]),
  );
  const total = rows[0]?.total_count ?? 0;
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / size)) };
}

export interface PublicWholesaler {
  id: string;
  slug: string;
  name: string;
  logo_path: string | null;
  phone: string | null;
  verification_status: string;
  gstin_registered: boolean;
  is_open: boolean | null;
  profile: {
    business_category: string;
    description: string | null;
    offers_delivery: boolean;
    min_order_value: string;
    delivery_charge: string;
    free_delivery_above: string | null;
    payment_terms_days: number;
    whatsapp_number: string | null;
    opening_hours: Record<string, [string, string]> | null;
  };
  address: { city: string; state_code: string; pincode: string; latitude: number; longitude: number; line1: string };
  zones: { name: string; kind: string; radius_km: number | null; pincodes: string[] }[];
  can_view_prices: boolean;
  products: {
    id: string;
    name: string;
    description: string | null;
    image_path: string | null;
    category: string;
    category_slug: string;
    brand: string | null;
    variants: { id: string; name: string; units: { id: string; unit_code: string; factor_to_base: number; base_unit: string; min_order_qty: number; price: number | null; mrp: number | null }[] | null }[] | null;
  }[];
}

export async function getPublicWholesaler(userId: string | null, slug: string): Promise<PublicWholesaler | null> {
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) return null;
  return run(userId, (q) => callFn<PublicWholesaler | null>(q, "wholesaler_public", [slug]));
}

export async function coverageFor(userId: string | null, wholesalerId: string, loc: SearchLocation | null) {
  if (!loc) return null;
  return run(userId, (q) => callFn<Coverage>(q, "delivery_coverage", [wholesalerId, loc.lat, loc.lng, loc.pincode]));
}

/** The retailer's shop location, used as the default search point when signed in. */
export async function shopLocation(userId: string, retailerId: string): Promise<SearchLocation | null> {
  const rows = await run(userId, (q) =>
    q.query<{ latitude: string | null; longitude: string | null; city: string; pincode: string }>(
      "select latitude, longitude, city, pincode from public.business_addresses where company_id = $1 and is_primary",
      [retailerId],
    ),
  );
  const r = rows[0];
  if (!r) return null;
  if (r.latitude && r.longitude) {
    return { lat: Number(r.latitude), lng: Number(r.longitude), label: `Your shop, ${r.city}`, pincode: r.pincode, source: "shop" };
  }
  const resolved = await resolveLocation({ pincode: r.pincode });
  return resolved.location ? { ...resolved.location, label: `Your shop, ${r.city}`, source: "shop" } : null;
}
