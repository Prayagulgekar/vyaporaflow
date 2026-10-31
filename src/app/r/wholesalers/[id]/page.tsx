import Link from "next/link";
import { AvailabilityBadge, RelationshipBadge } from "@/components/status";
import { ButtonLink, Card, EmptyState, Money, Notice, PageHeader } from "@/components/ui";
import { AddToCart } from "@/features/retailer/add-to-cart";
import { setCartAction } from "@/features/retailer/actions";
import { params, type SearchParams } from "@/features/shared/util";
import { formatQuantity, whatsappLink } from "@/lib/format";
import { getCatalog } from "@/server/cart";
import { listMyWholesalers } from "@/server/relationships";
import { imageUrl } from "@/server/storage";
import { requireRetailer } from "@/server/viewer";

export default async function WholesalerCatalog({ params: p, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await p;
  const sp = await params(searchParams);
  const { viewer, company } = await requireRetailer();
  const rel = (await listMyWholesalers(viewer.userId, company.companyId)).find((w) => w.wholesaler_id === id);
  if (!rel) return <Notice tone="warn">You are not connected to this wholesaler. Find them in <Link href="/r/discover" className="link">Find wholesalers</Link> and ask to connect.</Notice>;
  if (rel.status !== "approved") {
    return (
      <>
        <PageHeader title={rel.name} actions={<RelationshipBadge status={rel.status} />} />
        <Notice tone={rel.status === "pending" ? "info" : "warn"}>
          {rel.status === "pending" ? "Your request is waiting for the wholesaler's approval. You will be able to see prices and order once approved." : "This wholesaler is not accepting orders from your shop."}
        </Notice>
      </>
    );
  }
  const items = await getCatalog(viewer.userId, company.companyId, id, { q: sp.q, category: sp.category });
  const categories = [...new Map(items.map((i) => [i.category_slug, i.category_name])).entries()];
  const wa = whatsappLink(rel.whatsapp_number ?? rel.phone, `Hello ${rel.name}, this is ${company.companyName}. `);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/r/wholesalers" className="link">My wholesalers</Link>}
        title={rel.name}
        description={<>{rel.city}{rel.min_order_value && Number(rel.min_order_value) > 0 ? <> · minimum order <Money value={rel.min_order_value} /></> : null} · you owe <Money value={rel.outstanding} /></>}
        actions={<>{wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">WhatsApp</a> : null}<ButtonLink href={`/r/payments?wholesaler=${id}`} variant="secondary" size="sm">Statement</ButtonLink><ButtonLink href={`/r/cart#w-${id}`} size="sm">Go to cart</ButtonLink></>}
      />
      <form className="mb-3 flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search this catalogue</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Search products" className="input" />
        {sp.category ? <input type="hidden" name="category" value={sp.category} /> : null}
        <button className="btn btn-secondary">Search</button>
      </form>
      <nav aria-label="Categories" className="mb-4 flex gap-1 overflow-x-auto pb-1">
        <Link href={`/r/wholesalers/${id}`} className={`shrink-0 rounded-full border px-3 py-1 text-sm ${!sp.category ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-ink-muted"}`}>All</Link>
        {categories.map(([slug, name]) => (
          <Link key={slug} href={`/r/wholesalers/${id}?category=${slug}`} className={`shrink-0 rounded-full border px-3 py-1 text-sm ${sp.category === slug ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-ink-muted"}`}>{name}</Link>
        ))}
      </nav>
      {items.length === 0 ? <EmptyState title="No products found" /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {items.map((p) => {
            const img = imageUrl(p.image_path);
            return (
              <li key={p.product_id}>
                <Card>
                  <div className="flex gap-3">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt="" className="size-16 shrink-0 rounded border border-line object-cover" />
                    ) : null}
                    <div className="min-w-0">
                      <h2 className="font-semibold">{p.product_name}</h2>
                      <p className="text-xs text-ink-muted">{[p.brand_name, p.category_name, `GST ${Number(p.tax_rate)}%${p.price_includes_tax ? " included" : " extra"}`].filter(Boolean).join(" · ")}</p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    {p.variants.map((v) => (
                      <div key={v.id} className="border-t border-line pt-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{v.name}</span>
                          <AvailabilityBadge availability={v.availability} />
                        </div>
                        <ul className="space-y-2">
                          {v.units.map((u) => (
                            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-sm">
                                <strong><Money value={u.price} /></strong> / {u.unit_code}
                                {Number(u.factor_to_base) !== 1 ? <span className="text-ink-muted"> ({formatQuantity(u.factor_to_base, v.base_unit)})</span> : null}
                                {u.mrp ? <span className="block text-xs text-ink-muted">MRP <Money value={u.mrp} /></span> : null}
                                {Number(u.discount_percent) > 0 ? <span className="block text-xs text-ok">{Number(u.discount_percent)}% off</span> : null}
                                {Number(u.min_order_qty) > 1 ? <span className="block text-xs text-ink-muted">Minimum {formatQuantity(u.min_order_qty, u.unit_code)}</span> : null}
                              </span>
                              <AddToCart action={setCartAction} variantUnitId={u.id} unit={u.unit_code} min={u.min_order_qty} step={u.qty_step} inCart={u.in_cart} label={`${p.product_name} ${v.name}`} disabled={v.availability === "out_of_stock" && !u.in_cart} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
