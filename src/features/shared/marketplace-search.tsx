import Link from "next/link";
import { CoverageBadge, VerificationBadge } from "@/components/status";
import { Badge, Card, EmptyState, Money, Notice } from "@/components/ui";
import { DEFAULT_RADIUS_KM, SEARCH_RADII_KM } from "@/domain/geo";
import type { SearchLocation, WholesalerResult } from "@/server/marketplace";
import { LocationButton } from "./location-button";

export interface SearchState {
  q?: string;
  city?: string;
  pincode?: string;
  lat?: string;
  lng?: string;
  radius: number;
  category?: string;
}

/** Location + radius + keyword search form. GET form: works without JavaScript; GPS is opt-in via a button. */
export function MarketplaceSearchForm({ action, s, cities, categories }: { action: string; s: SearchState; cities: { name: string }[]; categories: { slug: string; name: string }[] }) {
  return (
    <form action={action} className="card space-y-3 p-4" role="search" aria-label="Find wholesalers">
      <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_8rem]">
        <div>
          <label htmlFor="q" className="label">Product, brand or wholesaler</label>
          <input id="q" name="q" defaultValue={s.q} placeholder="e.g. basmati rice, biscuits, 19 kg cylinder" className="input" />
        </div>
        <div>
          <label htmlFor="pincode" className="label">PIN code</label>
          <input id="pincode" name="pincode" defaultValue={s.lat ? "" : s.pincode} inputMode="numeric" maxLength={6} placeholder="e.g. 411038" className="input" />
        </div>
        <div>
          <label htmlFor="city" className="label">or city</label>
          <select id="city" name="city" defaultValue={s.lat ? "" : (s.city ?? "")} className="input">
            <option value="">Choose a city</option>
            {cities.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="radius" className="label">Within</label>
          <select id="radius" name="radius" defaultValue={String(s.radius)} className="input">
            {SEARCH_RADII_KM.map((r) => <option key={r} value={r}>{r} km{r === DEFAULT_RADIUS_KM ? " (default)" : ""}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="category" className="label">Category</label>
          <select id="category" name="category" defaultValue={s.category ?? ""} className="input">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
        <input type="hidden" name="lat" defaultValue={s.lat ?? ""} />
        <input type="hidden" name="lng" defaultValue={s.lng ?? ""} />
        <button className="btn btn-primary">Search</button>
        <LocationButton latName="lat" lngName="lng" label="Use my current location" submit clearNames={["pincode", "city"]} />
      </div>
      <p className="text-xs text-ink-muted">Your location is used only for this search and is not saved. PIN code and city locations are approximate.</p>
    </form>
  );
}

export function MarketplaceResults({
  loc,
  error,
  results,
  radius,
  linkFor,
  actionFor,
}: {
  loc: SearchLocation | null;
  error: string | null;
  results: { rows: WholesalerResult[]; total: number } | null;
  radius: number;
  linkFor: (w: WholesalerResult) => string;
  actionFor?: (w: WholesalerResult) => React.ReactNode;
}) {
  if (error) return <Notice tone="warn">{error}</Notice>;
  if (!loc || !results) return <Notice tone="info">Enter a PIN code, choose a city or use your location to see wholesalers near you.</Notice>;
  return (
    <div>
      <p className="mb-3 text-sm text-ink-muted" role="status">
        {results.total} wholesaler{results.total === 1 ? "" : "s"} within {radius} km of <strong className="text-ink">{loc.label}</strong>. Nearest first among equally relevant results.
      </p>
      {results.rows.length === 0 ? (
        <EmptyState title="No wholesalers found">Try a larger radius or a different product name.</EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {results.rows.map((w) => (
            <li key={w.company_id}>
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold"><Link href={linkFor(w)} className="hover:underline">{w.name}</Link></h2>
                    <p className="text-sm text-ink-muted">{w.business_category} · {w.city} {w.pincode}</p>
                  </div>
                  <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{Number(w.distance_km).toFixed(1)} km</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <CoverageBadge coverage={w.coverage} />
                  {w.verification_status === "verified" ? <VerificationBadge status="verified" /> : null}
                  {w.is_open === true ? <Badge tone="ok">Open now</Badge> : w.is_open === false ? <Badge>Closed now</Badge> : null}
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  {w.product_count} products{w.matching_products && w.matching_products !== w.product_count ? ` · ${w.matching_products} match your search` : ""}
                  {Number(w.min_order_value) > 0 ? <> · minimum order <Money value={w.min_order_value} /></> : null}
                  {w.offers_delivery ? <> · delivery {Number(w.delivery_charge) > 0 ? <Money value={w.delivery_charge} /> : "free"}{w.free_delivery_above ? <>, free above <Money value={w.free_delivery_above} /></> : null}</> : null}
                </p>
                {w.categories?.length ? <p className="mt-1 text-xs text-ink-faint">{w.categories.slice(0, 5).join(" · ")}</p> : null}
                {actionFor ? <div className="mt-3">{actionFor(w)}</div> : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
