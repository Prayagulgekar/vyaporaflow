import Link from "next/link";
import { DeliveryStatusBadge, OrderStatusBadge, PaymentStatusBadge } from "@/components/status";
import { ButtonLink, Card, DefinitionList, Money, Notice, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmSubmit, SelectField, SubmitButton, TextField } from "@/components/ui/client";
import { WHOLESALER_NEXT_ACTION, isOpen } from "@/domain/order-status";
import { AddressBlock, OrderItemsTable, OrderTimeline } from "@/features/shared/order-view";
import { orNotFound } from "@/features/shared/util";
import { assignDeliveryAction, generateInvoiceAction, transitionOrderAction } from "@/features/wholesaler/actions";
import { formatDateTime, whatsappLink, PAYMENT_METHOD_LABEL } from "@/lib/format";
import { listAssignableMembers } from "@/server/deliveries";
import { getOrder } from "@/server/orders";
import { requireWholesaler } from "@/server/viewer";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, company } = await requireWholesaler();
  const order = await orNotFound(getOrder(viewer.userId, id));
  if (order.wholesaler_id !== company.companyId) return <Notice tone="warn">This order belongs to another business. Switch business from the account menu to view it.</Notice>;
  const next = WHOLESALER_NEXT_ACTION[order.status];
  const canAssign = ["accepted", "preparing", "ready_for_delivery"].includes(order.status) && (!order.delivery_status || ["failed", "cancelled", "assigned"].includes(order.delivery_status));
  const members = canAssign ? await listAssignableMembers(viewer.userId, company.companyId) : [];
  const wa = whatsappLink(order.retailer.phone, `Hello ${order.retailer.contact_name ?? ""}, about your order ${order.order_number} from ${company.companyName}: `);
  const suspended = company.companyStatus === "suspended";

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/w/orders" className="link">Orders</Link>}
        title={`Order ${order.order_number}`}
        description={`Placed ${formatDateTime(order.placed_at)}${order.placed_by_name ? ` by ${order.placed_by_name}` : ""}`}
        actions={
          <>
            <OrderStatusBadge status={order.status} partial={order.partially_delivered} />
            <PaymentStatusBadge status={order.payment_status} />
          </>
        }
      />
      {order.status === "cancelled" ? (
        <div className="mb-4">
          <Notice tone="warn" title="Cancelled">{order.cancel_reason ?? "No reason recorded."} Reserved stock was released.</Notice>
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {isOpen(order.status) && !suspended ? (
            <Card title="Next step">
              <div className="flex flex-wrap items-start gap-3">
                {next ? (
                  <ActionForm action={transitionOrderAction}>
                    <input type="hidden" name="order_id" value={order.id} />
                    <input type="hidden" name="to" value={next.to} />
                    <SubmitButton pendingLabel="Updating…">{next.label}</SubmitButton>
                  </ActionForm>
                ) : !order.delivery_id || order.delivery_status === "cancelled" ? (
                  <ActionForm action={transitionOrderAction}>
                    <input type="hidden" name="order_id" value={order.id} />
                    <input type="hidden" name="to" value={order.status === "ready_for_delivery" ? "out_for_delivery" : "delivered"} />
                    <SubmitButton pendingLabel="Updating…">{order.status === "ready_for_delivery" ? "Hand over without a delivery person" : "Mark delivered"}</SubmitButton>
                    <p className="hint">For pickup by the retailer, or when you deliver yourself without assigning anyone.</p>
                  </ActionForm>
                ) : (
                  <p className="text-sm text-ink-muted">
                    {order.status === "ready_for_delivery" ? "Waiting for the delivery person to start the delivery." : "Out for delivery. The delivery person will record the result."}
                  </p>
                )}
                {order.status !== "out_for_delivery" ? (
                  <ActionForm action={transitionOrderAction}>
                    <input type="hidden" name="order_id" value={order.id} />
                    <input type="hidden" name="to" value="cancelled" />
                    <ConfirmSubmit label="Cancel order" title={`Cancel order ${order.order_number}?`} body="Reserved stock will be released. The retailer will be notified. This cannot be undone." confirmLabel="Cancel order">
                      <TextField name="note" label="Reason (shown to the retailer)" required />
                    </ConfirmSubmit>
                  </ActionForm>
                ) : null}
              </div>
            </Card>
          ) : null}

          {canAssign && !suspended ? (
            <Card title={order.assigned_worker_name ? "Change delivery person" : "Assign delivery"}>
              {order.assigned_worker_name ? <p className="mb-3 text-sm">Currently assigned to <strong>{order.assigned_worker_name}</strong>.</p> : null}
              <ActionForm action={assignDeliveryAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <input type="hidden" name="order_id" value={order.id} />
                <SelectField name="worker_id" label="Delivered by" required defaultValue={order.assigned_worker_id ?? ""}>
                  <option value="">Choose a person</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name} ({m.role.replace("_", " ")}, {m.active_deliveries} active)
                    </option>
                  ))}
                </SelectField>
                <TextField name="note" label="Note for the delivery person" />
                <SubmitButton variant="secondary">Assign</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}

          <OrderItemsTable order={order} />

          {order.status === "delivered" && !order.invoice_id && !suspended ? (
            <Card title="Invoice">
              <ActionForm action={generateInvoiceAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="order_id" value={order.id} />
                <div className="w-40">
                  <TextField name="due_days" label="Payment terms (days)" type="number" min={0} max={180} placeholder="Default" hint="Blank uses your default" />
                </div>
                <SubmitButton pendingLabel="Generating…">Generate GST invoice</SubmitButton>
              </ActionForm>
              <p className="mt-2 text-xs text-ink-muted">The invoice uses the delivered quantities and the prices fixed on this order.</p>
            </Card>
          ) : null}
          {order.invoice_id ? (
            <Card title="Invoice and payments">
              <p className="text-sm">
                Invoice <Link className="link font-medium" href={`/w/billing/${order.invoice_id}`}>{order.invoice_number}</Link>
                {order.invoice_due !== null ? <> · due <Money value={order.invoice_due} /></> : null}
              </p>
              {order.payments.length ? (
                <ul className="mt-2 space-y-1 text-sm text-ink-muted">
                  {order.payments.map((p, i) => (
                    <li key={i}>
                      {p.payment_number}: <Money value={p.amount} /> by {PAYMENT_METHOD_LABEL[p.method] ?? p.method} on {formatDateTime(p.received_at)}
                    </li>
                  ))}
                </ul>
              ) : null}
              <ButtonLink href={`/w/payments/new?retailer=${order.retailer_id}`} variant="secondary" size="sm" className="mt-3">Record a payment</ButtonLink>
            </Card>
          ) : null}
        </div>
        <div className="space-y-6">
          <Card title="Retailer">
            <DefinitionList
              items={[
                ["Business", <Link key="r" href={`/w/retailers/${order.retailer_id}`} className="link">{order.retailer.name}</Link>],
                ["Contact", order.retailer.contact_name ?? "–"],
                ["Phone", order.retailer.phone ? <a href={`tel:${order.retailer.phone}`} className="link">{order.retailer.phone}</a> : "–"],
                ["GSTIN", order.retailer.gstin ?? "Not registered"],
              ]}
            />
            {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm mt-3">Message on WhatsApp</a> : null}
          </Card>
          <Card title="Delivery">
            <AddressBlock a={order.delivery_address} />
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {order.delivery_status ? <DeliveryStatusBadge status={order.delivery_status} /> : <span className="text-ink-muted">Not assigned yet</span>}
              {order.assigned_worker_name ? <span>{order.assigned_worker_name}</span> : null}
            </div>
            {order.notes ? <p className="mt-3 rounded bg-sunken p-2 text-sm">Retailer note: {order.notes}</p> : null}
          </Card>
          <OrderTimeline order={order} />
        </div>
      </div>
    </>
  );
}
