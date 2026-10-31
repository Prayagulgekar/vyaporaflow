import Link from "next/link";
import { DeliveryStatusBadge, OrderStatusBadge, PaymentStatusBadge } from "@/components/status";
import { Card, Money, Notice, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmSubmit, SubmitButton, TextField } from "@/components/ui/client";
import { cancelOrderAction, reorderAction } from "@/features/retailer/actions";
import { AddressBlock, OrderItemsTable, OrderTimeline } from "@/features/shared/order-view";
import { orNotFound } from "@/features/shared/util";
import { formatDateTime, whatsappLink } from "@/lib/format";
import { getOrder } from "@/server/orders";
import { requireRetailer } from "@/server/viewer";

export default async function RetailerOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ placed?: string }> }) {
  const { id } = await params;
  const { placed } = await searchParams;
  const { viewer, company } = await requireRetailer();
  const order = await orNotFound(getOrder(viewer.userId, id));
  if (order.retailer_id !== company.companyId) return <Notice tone="warn">This order belongs to another business.</Notice>;
  const wa = whatsappLink(order.wholesaler.whatsapp ?? order.wholesaler.phone, `Hello ${order.wholesaler.name}, about my order ${order.order_number} (${company.companyName}): `);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/r/orders" className="link">Orders</Link>}
        title={`Order ${order.order_number}`}
        description={`${order.wholesaler_name} · placed ${formatDateTime(order.placed_at)}`}
        actions={<><OrderStatusBadge status={order.status} partial={order.partially_delivered} /><PaymentStatusBadge status={order.payment_status} /></>}
      />
      {placed ? <div className="mb-4"><Notice tone="ok" title="Order placed">{order.wholesaler_name} has been notified. Stock for your order is reserved.</Notice></div> : null}
      {order.status === "cancelled" ? <div className="mb-4"><Notice tone="warn" title="Cancelled">{order.cancel_reason}</Notice></div> : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <OrderItemsTable order={order} />
          <div className="flex flex-wrap gap-2">
            <ActionForm action={reorderAction}>
              <input type="hidden" name="order_id" value={order.id} />
              <SubmitButton variant="secondary" pendingLabel="Adding…">Order these items again</SubmitButton>
            </ActionForm>
            {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">Message on WhatsApp</a> : null}
            {order.status === "placed" ? (
              <ActionForm action={cancelOrderAction}>
                <input type="hidden" name="order_id" value={order.id} />
                <ConfirmSubmit label="Cancel order" title="Cancel this order?" body="You can cancel until the wholesaler accepts it." confirmLabel="Cancel order">
                  <TextField name="note" label="Reason" />
                </ConfirmSubmit>
              </ActionForm>
            ) : null}
          </div>
        </div>
        <div className="space-y-6">
          <Card title="Delivery">
            <AddressBlock a={order.delivery_address} />
            <p className="mt-2 text-sm">{order.delivery_status ? <DeliveryStatusBadge status={order.delivery_status} /> : "Not dispatched yet"}</p>
          </Card>
          {order.invoice_id ? (
            <Card title="Invoice">
              <p className="text-sm"><Link href={`/r/invoices/${order.invoice_id}`} className="link font-medium">{order.invoice_number}</Link> · due <Money value={order.invoice_due ?? "0"} /></p>
            </Card>
          ) : null}
          <OrderTimeline order={order} />
        </div>
      </div>
    </>
  );
}
