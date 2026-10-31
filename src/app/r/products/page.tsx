import Link from "next/link";
import { Card, EmptyState, Money, PageHeader } from "@/components/ui";
import { params, type SearchParams } from "@/features/shared/util";
import { searchApprovedProducts } from "@/server/cart";
import { requireRetailer } from "@/server/viewer";

export default async function ProductSearch({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireRetailer();
  const rows = sp.q ? await searchApprovedProducts(viewer.userId, company.companyId, sp.q) : [];
  return (
    <>
      <PageHeader title="Search products" description="Compare products across the wholesalers that approved your shop." />
      <form className="mb-4 flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">Product name</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="e.g. toor dal, sunflower oil, 20 L water" className="input" autoFocus />
        <button className="btn btn-primary">Search</button>
      </form>
      {!sp.q ? <p className="text-sm text-ink-muted">Type a product, brand or category.</p> : rows.length === 0 ? <EmptyState title="No matching products" /> : (
        <Card padded={false}>
          <table className="data-table stack">
            <thead><tr><th scope="col">Product</th><th scope="col">Wholesaler</th><th scope="col" className="num">From</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product_id}>
                  <td data-label="Product"><span className="font-medium">{r.product_name}</span><span className="block text-xs text-ink-muted">{[r.brand_name, r.category_name].filter(Boolean).join(" · ")}</span></td>
                  <td data-label="Wholesaler"><Link href={`/r/wholesalers/${r.wholesaler_id}?q=${encodeURIComponent(r.product_name)}`} className="link">{r.wholesaler_name}</Link></td>
                  <td data-label="From" className="num">{r.from_price ? <><Money value={r.from_price} /> / {r.unit_code}</> : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
