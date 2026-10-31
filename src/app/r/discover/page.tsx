import Link from "next/link";
import { RelationshipBadge } from "@/components/status";
import { PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { requestConnectionAction } from "@/features/retailer/actions";
import { loadMarketplace } from "@/features/shared/marketplace-data";
import { MarketplaceResults, MarketplaceSearchForm } from "@/features/shared/marketplace-search";
import { params, type SearchParams } from "@/features/shared/util";
import { shopLocation } from "@/server/marketplace";
import { listMyWholesalers } from "@/server/relationships";
import { requireRetailer } from "@/server/viewer";

export default async function Discover({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireRetailer();
  const [shop, mine] = await Promise.all([shopLocation(viewer.userId, company.companyId), listMyWholesalers(viewer.userId, company.companyId)]);
  const m = await loadMarketplace(viewer.userId, sp, shop);
  const rel = new Map(mine.map((w) => [w.wholesaler_id, w.status]));
  return (
    <>
      <PageHeader title="Find wholesalers" description={shop ? "Searching from your shop unless you choose another location." : "Add coordinates to your shop profile to search from your shop by default."} />
      <MarketplaceSearchForm action="/r/discover" s={m.s} cities={m.cities} categories={m.categories} />
      <div className="mt-6">
        <MarketplaceResults
          loc={m.loc}
          error={m.error}
          results={m.results}
          radius={m.s.radius}
          linkFor={(w) => (rel.get(w.company_id) === "approved" ? `/r/wholesalers/${w.company_id}` : `/marketplace/${w.slug}`)}
          actionFor={(w) => {
            const status = rel.get(w.company_id);
            if (status === "approved") return <Link href={`/r/wholesalers/${w.company_id}`} className="btn btn-primary btn-sm">Order</Link>;
            if (status) return <RelationshipBadge status={status} />;
            return (
              <ActionForm action={requestConnectionAction}>
                <input type="hidden" name="wholesaler_id" value={w.company_id} />
                <SubmitButton size="sm" variant="secondary" pendingLabel="Sending…">Ask to connect</SubmitButton>
              </ActionForm>
            );
          }}
        />
      </div>
    </>
  );
}
