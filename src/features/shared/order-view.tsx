import { formatDateTime, formatQuantity, humanize } from "@/lib/format";
import { Card, Money } from "@/components/ui";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/domain/order-status";
import type { OrderDetail } from "@/server/orders";

export function OrderItemsTable({ order }: { order: OrderDetail }) {
  const showDelivered = order.items.some((i) => i.delivered_quantity !== null && Number(i.delivered_quantity) !== Number(i.quantity));
  return (
    <Card title={`Items (${order.items.length})`} padded={false}>
      <table className="data-table stack">
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col" className="num">Quantity</th>
            {showDelivered ? <th scope="col" className="num">Delivered</th> : null}
            <th scope="col" className="num">Rate</th>
            <th scope="col" className="num">GST</th>
            <th scope="col" className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((i) => (
            <tr key={i.id}>
              <td data-label="Product">
                <span className="font-medium">{i.product_name}</span> <span className="text-ink-muted">{i.variant_name}</span>
                <span className="block text-xs text-ink-faint">
                  {i.sku}
                  {i.hsn_code ? ` · HSN ${i.hsn_code}` : ""}
                  {Number(i.unit_factor) !== 1 ? ` · 1 ${i.unit_code} = ${formatQuantity(i.unit_factor, i.base_unit)}` : ""}
                </span>
              </td>
              <td data-label="Quantity" className="num">
                {formatQuantity(i.quantity, i.unit_code)}
              </td>
              {showDelivered ? (
                <td data-label="Delivered" className="num">
                  {i.delivered_quantity === null ? "–" : formatQuantity(i.delivered_quantity, i.unit_code)}
                </td>
              ) : null}
              <td data-label="Rate" className="num">
                <Money value={i.unit_price} />
                {Number(i.discount_percent) > 0 ? <span className="block text-xs text-ok">−{Number(i.discount_percent)}%</span> : null}
              </td>
              <td data-label="GST" className="num">
                {Number(i.tax_rate)}%
              </td>
              <td data-label="Amount" className="num">
                <Money value={i.line_total} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-line p-4">
        <Totals
          rows={[
            ["Items (before discount)", order.subtotal],
            ...(Number(order.discount_total) > 0 ? ([["Discount", `-${order.discount_total}`]] as [string, string][]) : []),
            ["Taxable value", order.taxable_total],
            ["GST", order.tax_total],
            ["Delivery charge", order.delivery_charge],
          ]}
          total={["Order total", order.grand_total]}
        />
        <p className="mt-2 text-right text-xs text-ink-muted">Prices were fixed when the order was placed.{order.items.some((i) => i.price_includes_tax) ? " Some prices include GST." : ""}</p>
      </div>
    </Card>
  );
}

export function Totals({ rows, total }: { rows: [string, string][]; total: [string, string] }) {
  return (
    <dl className="ml-auto max-w-xs space-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-6">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="tabular-nums">
            <Money value={v} />
          </dd>
        </div>
      ))}
      <div className="flex justify-between gap-6 border-t border-line pt-2 text-base font-semibold">
        <dt>{total[0]}</dt>
        <dd className="tabular-nums">
          <Money value={total[1]} />
        </dd>
      </div>
    </dl>
  );
}

const EVENT_LABEL: Record<string, string> = {
  placed: "Order placed",
  status_changed: "Status changed",
  delivery_assigned: "Delivery assigned",
  invoice_issued: "Invoice issued",
  credit_note_issued: "Credit note issued",
  payment_applied: "Payment applied",
  delivery_updated: "Delivery updated",
};

export function OrderTimeline({ order }: { order: OrderDetail }) {
  return (
    <Card title="History">
      <ol className="space-y-3 text-sm">
        {order.events.map((e) => (
          <li key={e.id} className="border-l-2 border-line pl-3">
            <p className="font-medium">
              {e.to_status && e.event_type === "status_changed" ? ORDER_STATUS_LABEL[e.to_status as OrderStatus] ?? humanize(e.to_status) : EVENT_LABEL[e.event_type] ?? humanize(e.event_type)}
            </p>
            <p className="text-xs text-ink-muted">
              {formatDateTime(e.created_at)}
              {e.actor_name ? ` · ${e.actor_name}` : ""}
            </p>
            {e.note ? <p className="mt-0.5 text-ink-muted">{e.note}</p> : null}
          </li>
        ))}
        {order.delivery_events.map((e) => (
          <li key={`d${e.id}`} className="border-l-2 border-info pl-3">
            <p className="font-medium">Delivery: {humanize(e.to_status)}</p>
            <p className="text-xs text-ink-muted">
              {formatDateTime(e.created_at)}
              {e.actor_name ? ` · ${e.actor_name}` : ""}
            </p>
            {e.note ? <p className="mt-0.5 text-ink-muted">{e.note}</p> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function AddressBlock({ a }: { a: OrderDetail["delivery_address"] }) {
  return (
    <address className="text-sm not-italic">
      {a.line1}
      {a.line2 ? <>, {a.line2}</> : null}
      <br />
      {a.city} {a.pincode}
    </address>
  );
}
