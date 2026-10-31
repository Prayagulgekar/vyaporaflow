import type { Metadata } from "next";
import { MarketplaceResults, MarketplaceSearchForm } from "@/features/shared/marketplace-search";
import { loadMarketplace } from "@/features/shared/marketplace-data";
import { params, type SearchParams } from "@/features/shared/util";
import { getSessionUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Marketplace: find wholesalers near you" };

export default async function Marketplace({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const user = await getSessionUser().catch(() => null);
  const m = await loadMarketplace(user?.id ?? null, sp, null);
  return (
    <div className="mx-auto max-w-[var(--spacing-content)] px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl">Find wholesalers near you</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">Search by PIN code, city or your current location. Prices are shown to retailers after the wholesaler approves them.</p>
      <div className="mt-6"><MarketplaceSearchForm action="/marketplace" s={m.s} cities={m.cities} categories={m.categories} /></div>
      <div className="mt-6">
        <MarketplaceResults loc={m.loc} error={m.error} results={m.results} radius={m.s.radius} linkFor={(w) => `/marketplace/${w.slug}`} />
      </div>
    </div>
  );
}
