import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ButtonLink, Card, EmptyState, Money, Notice, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton, TextareaField } from "@/components/ui/client";
import { clearCartAction, placeOrderAction, setCartAction } from "@/features/retailer/actions";
import { AddToCart } from "@/features/retailer/add-to-cart";
import { Totals } from "@/features/shared/order-view";
import { formatQuantity } from "@/lib/format";
import { getCarts } from "@/server/cart";
import { requireRetailer } from "@/server/viewer";

export default async function Cart({ searchParams }: { searchParams: Promise<{ reordered?: string; skipped?: string }> }) {
  const sp = await searchParams;
  const { viewer, company } = await requireRetailer();
  const carts = await getCarts(viewer.userId, company.companyId);
  return (
    <>
      <PageHeader title="Cart" description="Each wholesaler gets a separate order. Prices, GST and delivery charges are calculated by the wholesaler's current settings." />
      {sp.reordered ? (
        <div className="mb-4"><Notice tone="ok">Added {sp.reordered} items from your previous order at today&apos;s prices.{Number(sp.skipped) > 0 ? ` ${sp.skipped} items are no longer available and were left out.` : ""}</Notice></div>
      ) : null}
      {carts.length === 0 ? (
        <EmptyState title="Your cart is empty" action={<ButtonLink href="/r/wholesalers">Browse my wholesalers</ButtonLink>} />
      ) : (
        <div className="space-y-6">
          {carts.map((c) => {
            const q = c.quote;
            const blocked = !q || q.errors.length > 0 || q.lines.some((l) => l.issues.length > 0);
            return (
              <section key={c.wholesaler_id} id={`w-${c.wholesaler_id}`} aria-labelledby={`h-${c.wholesaler_id}`} className="scroll-mt-20">
                <Card
                  title={<span id={`h-${c.wholesaler_id}`}>Order from {c.wholesaler_name}</span>}
                  actions={
                    <form action={clearCartAction}>
                      <input type="hidden" name="wholesaler_id" value={c.wholesaler_id} />
                      <button className="btn btn-ghost btn-sm">Empty this cart</button>
                    </form>
                  }
                >
                  {c.quoteError ? <Notice tone="danger">{c.quoteError}</Notice> : null}
                  {q ? (
                    <>
                      <ul className="divide-y divide-line">
                        {q.lines.map((l) => (
                          <li key={l.variant_unit_id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium">{l.product_name} <span className="text-ink-muted">{l.variant_name}</span></p>
                              <p className="text-xs text-ink-muted">
                                <Money value={l.unit_price} /> / {l.unit_code}
                                {Number(l.unit_factor) !== 1 ? ` (${formatQuantity(l.unit_factor, l.base_unit)})` : ""} · GST {Number(l.tax_rate)}%
                                {Number(l.discount_percent) > 0 ? ` · ${Number(l.discount_percent)}% off` : ""}
                              </p>
                              {l.issues.map((i) => <p key={i} className="text-sm text-danger">{i}</p>)}
                            </div>
                            <div className="flex items-center gap-4">
                              <AddToCart action={setCartAction} variantUnitId={l.variant_unit_id} unit={l.unit_code} min="0" step="any" inCart={l.quantity} label={`${l.product_name} ${l.variant_name}`} />
                              <span className="w-24 text-right font-medium tabular-nums"><Money value={l.line_total} /></span>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 border-t border-line pt-3">
                        <Totals
                          rows={[
                            ["Items", q.subtotal],
                            ...(Number(q.discount_total) > 0 ? ([["Discount", `-${q.discount_total}`]] as [string, string][]) : []),
                            ["GST", q.tax_total],
                            ["Delivery charge", q.delivery_charge],
                          ]}
                          total={["Total", q.grand_total]}
                        />
                      </div>
                      {q.errors.map((e) => <div key={e} className="mt-3"><Notice tone="warn">{e}</Notice></div>)}
                      <ActionForm action={placeOrderAction} className="mt-4 space-y-3">
                        <input type="hidden" name="wholesaler_id" value={c.wholesaler_id} />
                        <input type="hidden" name="idempotency_key" value={randomUUID()} />
                        {q.lines.map((l) => <input key={l.variant_unit_id} type="hidden" name={`qty:${l.variant_unit_id}`} value={l.quantity} />)}
                        <TextareaField name="notes" label="Note for the wholesaler" rows={2} placeholder="e.g. Deliver before 11 am" />
                        <SubmitButton pendingLabel="Placing order…" disabled={blocked}>Place order · ₹{q.grand_total}</SubmitButton>
                        {blocked ? <p className="text-sm text-ink-muted">Fix the items marked above to place this order.</p> : <p className="text-xs text-ink-muted">Totals are checked again when you place the order. Payment is settled with the wholesaler directly; there is no online payment.</p>}
                      </ActionForm>
                    </>
                  ) : null}
                  <p className="mt-3 text-sm"><Link href={`/r/wholesalers/${c.wholesaler_id}`} className="link">Add more from {c.wholesaler_name}</Link></p>
                </Card>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
