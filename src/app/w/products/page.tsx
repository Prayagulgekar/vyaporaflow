import Link from "next/link";
import { Badge, ButtonLink, Card, EmptyState, Money, PageHeader, Pagination } from "@/components/ui";
import { params, type SearchParams } from "@/features/shared/util";
import { formatQuantity } from "@/lib/format";
import { listCategories, listProducts } from "@/server/catalog";
import { imageUrl } from "@/server/storage";
import { requireWholesaler } from "@/server/viewer";

export default async function Products({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireWholesaler();
  const [page, categories] = await Promise.all([listProducts(viewer.userId, company.companyId, sp), listCategories(company.companyId)]);
  return (
    <>
      <PageHeader
        title="Products"
        description="Your catalogue. Approved retailers see active products and their prices."
        actions={
          <>
            <ButtonLink href="/w/products/import" variant="secondary">Import or export</ButtonLink>
            <ButtonLink href="/w/products/new">Add product</ButtonLink>
          </>
        }
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]" role="search">
        <label htmlFor="q" className="sr-only">Search products</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Search name, brand or SKU" className="input" />
        <label htmlFor="category" className="sr-only">Category</label>
        <select id="category" name="category" defaultValue={sp.category ?? ""} className="input">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label htmlFor="status" className="sr-only">Status</label>
        <select id="status" name="status" defaultValue={sp.status ?? "active"} className="input">
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <button className="btn btn-secondary">Apply</button>
      </form>
      <Card padded={false}>
        {page.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title={sp.q ? "No products match" : "No products yet"} action={<ButtonLink href="/w/products/new">Add product</ButtonLink>}>
              Add products one by one or import a spreadsheet.
            </EmptyState>
          </div>
        ) : (
          <table className="data-table stack">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Category</th>
                <th scope="col">GST</th>
                <th scope="col" className="num">Price</th>
                <th scope="col" className="num">Available</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((p) => {
                const img = imageUrl(p.image_path);
                return (
                  <tr key={p.id}>
                    <td data-label="Product">
                      <div className="flex items-center gap-3">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="" className="size-10 shrink-0 rounded border border-line object-cover" />
                        ) : (
                          <span className="size-10 shrink-0 rounded border border-line bg-sunken" aria-hidden />
                        )}
                        <span>
                          <Link href={`/w/products/${p.id}`} className="link font-medium">{p.name}</Link>
                          <span className="block text-xs text-ink-muted">
                            {p.brand_name ? `${p.brand_name} · ` : ""}
                            {p.variant_count} variant{p.variant_count === 1 ? "" : "s"}
                            {p.archived_at ? " · archived" : ""}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td data-label="Category">{p.category_name}</td>
                    <td data-label="GST">
                      {Number(p.tax_rate)}%{p.hsn_code ? <span className="block text-xs text-ink-muted">HSN {p.hsn_code}</span> : null}
                    </td>
                    <td data-label="Price" className="num">
                      {p.min_price === null ? "–" : p.min_price === p.max_price ? <Money value={p.min_price} /> : <><Money value={p.min_price} /> – <Money value={p.max_price} /></>}
                    </td>
                    <td data-label="Available" className="num">
                      {formatQuantity(p.available, "")}
                      {p.low_count ? <span className="ml-2"><Badge tone="warn">Low</Badge></span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <Pagination page={page.page} pageCount={page.pageCount} total={page.total} basePath="/w/products" params={sp} />
    </>
  );
}
