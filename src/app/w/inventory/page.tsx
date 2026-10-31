import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, Pagination } from "@/components/ui";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/ui/client";
import { params, type SearchParams } from "@/features/shared/util";
import { adjustStockAction, reconcileAction } from "@/features/wholesaler/actions";
import { formatDate, formatDateTime, formatQuantity, humanize } from "@/lib/format";
import { ADJUSTMENT_TYPES, listInventory, listMovements } from "@/server/inventory";
import { requireWholesaler } from "@/server/viewer";

const FILTERS = [["all", "All items"], ["low", "Low stock"], ["out", "Out of stock"], ["expiring", "Expiring in 30 days"]] as const;

function signed(v: string, unit: string) {
  const n = Number(v);
  return `${n > 0 ? "+" : ""}${formatQuantity(v, unit)}`;
}

export default async function Inventory({ searchParams }: { searchParams: SearchParams }) {
  const sp = await params(searchParams);
  const { viewer, company } = await requireWholesaler();
  const [inv, moves] = await Promise.all([
    listInventory(viewer.userId, company.companyId, sp),
    listMovements(viewer.userId, company.companyId, { variantId: sp.variant, pageSize: 25 }),
  ]);
  const selected = sp.variant ? inv.rows.find((r) => r.variant_id === sp.variant) : undefined;
  return (
    <>
      <PageHeader title="Inventory" description="On hand is what is in your godown. Reserved is held for open orders. Available is what retailers can still order." />
      <nav aria-label="Stock filter" className="mb-3 flex flex-wrap gap-1">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={`/w/inventory?filter=${k}`} aria-current={(sp.filter ?? "all") === k ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${(sp.filter ?? "all") === k ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-ink-muted"}`}>
            {label}
          </Link>
        ))}
      </nav>
      <form className="mb-4 flex gap-2" role="search">
        <input type="hidden" name="filter" value={sp.filter ?? "all"} />
        <label htmlFor="q" className="sr-only">Search stock</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Search product or SKU" className="input" />
        <button className="btn btn-secondary">Search</button>
      </form>
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div>
          <Card padded={false}>
            {inv.rows.length === 0 ? (
              <div className="p-4"><EmptyState title="Nothing to show">No stock records match this filter.</EmptyState></div>
            ) : (
              <table className="data-table stack">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className="num">On hand</th>
                    <th scope="col" className="num">Reserved</th>
                    <th scope="col" className="num">Available</th>
                    <th scope="col">Next expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.rows.map((r) => (
                    <tr key={r.variant_id}>
                      <td data-label="Item">
                        <Link href={`/w/inventory?${new URLSearchParams({ ...sp, variant: r.variant_id } as Record<string, string>).toString()}#adjust`} className="link font-medium">
                          {r.product_name} {r.variant_name}
                        </Link>
                        <span className="block text-xs text-ink-muted">{r.sku} · {r.category_name}</span>
                      </td>
                      <td data-label="On hand" className="num">{formatQuantity(r.on_hand, r.base_unit)}</td>
                      <td data-label="Reserved" className="num">{formatQuantity(r.reserved, r.base_unit)}</td>
                      <td data-label="Available" className="num">
                        {formatQuantity(r.available, r.base_unit)}
                        {Number(r.available) <= 0 ? <span className="ml-2"><Badge tone="danger">Out</Badge></span> : r.is_low ? <span className="ml-2"><Badge tone="warn">Low</Badge></span> : null}
                      </td>
                      <td data-label="Next expiry">{r.next_expiry ? formatDate(r.next_expiry) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Pagination page={inv.page} pageCount={inv.pageCount} total={inv.total} basePath="/w/inventory" params={sp} />
        </div>
        <div className="space-y-6">
          <Card title="Adjust stock">
            <div id="adjust" />
            {selected ? (
              <ActionForm action={adjustStockAction} className="space-y-3" resetOnSuccess>
                <input type="hidden" name="variant_id" value={selected.variant_id} />
                <p className="text-sm">
                  <strong>{selected.product_name} {selected.variant_name}</strong>
                  <span className="block text-ink-muted">On hand {formatQuantity(selected.on_hand, selected.base_unit)} · reserved {formatQuantity(selected.reserved, selected.base_unit)}</span>
                </p>
                <SelectField name="movement_type" label="Type of change" defaultValue="addition">
                  {Object.entries(ADJUSTMENT_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </SelectField>
                <TextField name="quantity" label={`Quantity (${selected.base_unit})`} inputMode="decimal" required hint="For a count correction, use a negative number to reduce." />
                <TextField name="note" label="Note" required placeholder="e.g. Received from supplier, invoice 4411" />
                <div className="grid grid-cols-2 gap-3">
                  <TextField name="batch_no" label="Batch" />
                  <TextField name="expiry_date" label="Expiry" type="date" />
                </div>
                <SubmitButton>Record change</SubmitButton>
                <p className="text-xs text-ink-muted">Stock cannot go below what is reserved for open orders. Every change is kept in the history.</p>
              </ActionForm>
            ) : (
              <p className="text-sm text-ink-muted">Choose an item from the list to add, remove or correct its stock.</p>
            )}
          </Card>
          <Card title="Check records">
            <ActionForm action={reconcileAction}>
              <p className="mb-3 text-sm text-ink-muted">Recalculate stock from the movement history and balances from the ledger, and compare.</p>
              <SubmitButton variant="secondary" pendingLabel="Checking…">Run check</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>

      <Card title={selected ? `Movement history: ${selected.product_name} ${selected.variant_name}` : "Recent stock movements"} className="mt-6" padded={false} actions={selected ? <Link href="/w/inventory" className="link text-sm">Show all</Link> : null}>
        <table className="data-table stack">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Item</th>
              <th scope="col">Type</th>
              <th scope="col" className="num">On hand change</th>
              <th scope="col" className="num">Reserved change</th>
              <th scope="col" className="num">On hand after</th>
              <th scope="col">Reference</th>
            </tr>
          </thead>
          <tbody>
            {moves.rows.map((m) => (
              <tr key={m.id}>
                <td data-label="When">{formatDateTime(m.created_at)}</td>
                <td data-label="Item">{m.product_name} {m.variant_name}</td>
                <td data-label="Type">{humanize(m.movement_type)}</td>
                <td data-label="On hand change" className="num">{Number(m.on_hand_delta) ? signed(m.on_hand_delta, m.base_unit) : "–"}</td>
                <td data-label="Reserved change" className="num">{Number(m.reserved_delta) ? signed(m.reserved_delta, m.base_unit) : "–"}</td>
                <td data-label="On hand after" className="num">{formatQuantity(m.on_hand_after, m.base_unit)}</td>
                <td data-label="Reference">
                  {m.order_number && m.reference_id ? <Link href={`/w/orders/${m.reference_id}`} className="link">{m.order_number}</Link> : null}
                  {m.note ? <span className="block text-xs text-ink-muted">{m.note}</span> : null}
                  {m.actor_name ? <span className="block text-xs text-ink-faint">{m.actor_name}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-2 text-xs text-ink-muted">Showing the latest {moves.rows.length} of {moves.total} movements.</p>
    </>
  );
}
