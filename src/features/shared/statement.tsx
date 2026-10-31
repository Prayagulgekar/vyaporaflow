import { Card, Money } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { StatementLine } from "@/server/billing";

const KIND: Record<StatementLine["kind"], string> = {
  invoice: "Invoice",
  credit_note: "Credit note",
  payment: "Payment",
  payment_reversal: "Reversal",
  invoice_void: "Void",
};

export function StatementTable({ lines, totals }: { lines: StatementLine[]; totals: { debit: string; credit: string; balance: string } }) {
  return (
    <Card title="Account statement" padded={false} actions={<span className="text-xs text-ink-muted">Positive balance = amount owed to the wholesaler</span>}>
      <table className="data-table stack">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Document</th>
            <th scope="col">Details</th>
            <th scope="col" className="num">Debit</th>
            <th scope="col" className="num">Credit</th>
            <th scope="col" className="num">Balance</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr><td colSpan={6} className="text-center text-ink-muted">No invoices or payments yet.</td></tr>
          ) : (
            lines.map((l, i) => (
              <tr key={i}>
                <td data-label="Date">{formatDate(l.date)}</td>
                <td data-label="Document">{KIND[l.kind]} <span className="text-ink-muted">{l.reference}</span></td>
                <td data-label="Details">{l.description}</td>
                <td data-label="Debit" className="num">{Number(l.debit) ? <Money value={l.debit} /> : ""}</td>
                <td data-label="Credit" className="num">{Number(l.credit) ? <Money value={l.credit} /> : ""}</td>
                <td data-label="Balance" className="num font-medium"><Money value={l.balance} /></td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td colSpan={3}>Totals</td>
            <td className="num"><Money value={totals.debit} /></td>
            <td className="num"><Money value={totals.credit} /></td>
            <td className="num"><Money value={totals.balance} /></td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}
