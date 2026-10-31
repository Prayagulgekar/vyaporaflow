import { Money } from "@/components/ui";
import { formatDate, formatQuantity } from "@/lib/format";
import type { InvoiceDetail } from "@/server/billing";
import { Totals } from "./order-view";

/** Printable GST tax invoice. */
export function InvoiceDocument({ inv }: { inv: InvoiceDetail }) {
  const inter = inv.supply_type === "inter_state";
  return (
    <article className="card p-6 print:border-0 print:p-0 print:shadow-none" aria-label={`Tax invoice ${inv.invoice_number}`}>
      <header className="flex flex-col justify-between gap-4 border-b border-line pb-4 sm:flex-row">
        <div>
          <p className="font-display text-2xl">{inv.seller.name}</p>
          <p className="text-sm text-ink-muted">
            {inv.seller.line1}
            {inv.seller.line2 ? `, ${inv.seller.line2}` : ""}, {inv.seller.city} {inv.seller.pincode}, {inv.seller.state_name} ({inv.seller.state_code})
          </p>
          <p className="text-sm">GSTIN: {inv.seller.gstin ?? "Not registered"}{inv.seller.phone ? ` · ${inv.seller.phone}` : ""}</p>
        </div>
        <div className="text-sm sm:text-right">
          <p className="text-lg font-semibold">{inv.status === "void" ? "VOID: " : ""}Tax invoice</p>
          <p>No. <strong>{inv.invoice_number}</strong></p>
          <p>Date {formatDate(inv.invoice_date)} · Due {formatDate(inv.due_date)}</p>
          <p>Order {inv.order_number}</p>
        </div>
      </header>
      <section className="grid gap-4 border-b border-line py-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Bill to</p>
          <p className="font-medium">{inv.buyer.name}</p>
          <p>{inv.buyer.line1}{inv.buyer.line2 ? `, ${inv.buyer.line2}` : ""}, {inv.buyer.city} {inv.buyer.pincode}</p>
          <p>{inv.buyer.state_name} ({inv.buyer.state_code}) · GSTIN: {inv.buyer.gstin ?? "Unregistered"}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Place of supply</p>
          <p>{inv.place_of_supply_name} ({inv.place_of_supply})</p>
          <p>{inter ? "Inter-state supply: IGST" : "Intra-state supply: CGST + SGST"}</p>
        </div>
      </section>
      <div className="overflow-x-auto">
        <table className="data-table mt-2 text-sm">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Description</th>
              <th scope="col">HSN</th>
              <th scope="col" className="num">Qty</th>
              <th scope="col" className="num">Rate</th>
              <th scope="col" className="num">Taxable</th>
              <th scope="col" className="num">GST %</th>
              {inter ? <th scope="col" className="num">IGST</th> : <><th scope="col" className="num">CGST</th><th scope="col" className="num">SGST</th></>}
              <th scope="col" className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((i) => (
              <tr key={i.line_no}>
                <td>{i.line_no}</td>
                <td>{i.description}</td>
                <td>{i.hsn_code ?? "–"}</td>
                <td className="num">{formatQuantity(i.quantity, i.unit_code)}</td>
                <td className="num"><Money value={i.unit_price} /></td>
                <td className="num"><Money value={i.taxable_amount} /></td>
                <td className="num">{Number(i.tax_rate)}</td>
                {inter ? <td className="num"><Money value={i.igst_amount} /></td> : <><td className="num"><Money value={i.cgst_amount} /></td><td className="num"><Money value={i.sgst_amount} /></td></>}
                <td className="num"><Money value={i.line_total} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4">
        <Totals
          rows={[
            ["Taxable value", inv.taxable_total],
            ...((inter ? [["IGST", inv.igst_total]] : [["CGST", inv.cgst_total], ["SGST", inv.sgst_total]]) as [string, string][]),
            ["Delivery charge", inv.delivery_charge],
          ]}
          total={["Invoice total", inv.grand_total]}
        />
      </div>
      <footer className="mt-6 border-t border-line pt-3 text-xs text-ink-muted">
        Computer-generated invoice from VyaporaFlow. This is not an e-invoice (no IRN). Tax rates and HSN codes are as entered by the seller.
      </footer>
    </article>
  );
}

export function InvoiceSettlement({ inv, paymentHref }: { inv: InvoiceDetail; paymentHref?: (id: string) => string }) {
  return (
    <div className="space-y-3 text-sm">
      <dl className="space-y-1">
        <div className="flex justify-between"><dt className="text-ink-muted">Invoice total</dt><dd><Money value={inv.grand_total} /></dd></div>
        <div className="flex justify-between"><dt className="text-ink-muted">Credit notes</dt><dd>−<Money value={inv.credited} /></dd></div>
        <div className="flex justify-between"><dt className="text-ink-muted">Paid</dt><dd>−<Money value={inv.paid} /></dd></div>
        <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>Amount due</dt><dd><Money value={inv.due} /></dd></div>
      </dl>
      {inv.allocations.length ? (
        <ul className="space-y-1">
          {inv.allocations.map((a, i) => (
            <li key={i} className={a.reversal ? "text-danger" : ""}>
              {paymentHref ? <a href={paymentHref(a.payment_id)} className="link">{a.payment_number}</a> : a.payment_number}: <Money value={a.amount} /> {a.reversal ? "(reversed)" : ""} · {formatDate(a.received_at)}
            </li>
          ))}
        </ul>
      ) : null}
      {inv.credit_notes.length ? (
        <ul className="space-y-1">
          {inv.credit_notes.map((c) => (
            <li key={c.id}>{c.credit_note_number}: <Money value={c.amount} /> · {c.reason}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
