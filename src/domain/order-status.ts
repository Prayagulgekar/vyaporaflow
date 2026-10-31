/**
 * Order lifecycle. Mirrors app.order_transition_allowed(); the database is the
 * authority and rejects anything else.
 */
export const ORDER_STATUSES = [
  "placed",
  "accepted",
  "preparing",
  "ready_for_delivery",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  placed: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready_for_delivery", "cancelled"],
  ready_for_delivery: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered", "ready_for_delivery"],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  placed: "Placed",
  accepted: "Accepted",
  preparing: "Preparing",
  ready_for_delivery: "Ready for delivery",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** The forward action a wholesaler takes from each status (delivery steps happen on the delivery screen). */
export const WHOLESALER_NEXT_ACTION: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  placed: { to: "accepted", label: "Accept order" },
  accepted: { to: "preparing", label: "Start preparing" },
  preparing: { to: "ready_for_delivery", label: "Mark ready for delivery" },
};

export function isOpen(status: OrderStatus): boolean {
  return status !== "delivered" && status !== "cancelled";
}

export const DELIVERY_STATUSES = ["assigned", "out_for_delivery", "delivered", "partially_delivered", "failed", "cancelled"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

const DELIVERY_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  assigned: ["out_for_delivery"],
  out_for_delivery: ["delivered", "partially_delivered", "failed"],
  delivered: [],
  partially_delivered: [],
  failed: [],
  cancelled: [],
};

export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return DELIVERY_TRANSITIONS[from].includes(to);
}

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  assigned: "Assigned",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  partially_delivered: "Partially delivered",
  failed: "Failed attempt",
  cancelled: "Cancelled",
};
