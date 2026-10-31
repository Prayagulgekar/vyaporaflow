import { COVERAGE_LABEL, type Coverage } from "@/domain/geo";
import { HANDOVER_STATUS_LABEL } from "@/domain/cash";
import { DELIVERY_STATUS_LABEL, ORDER_STATUS_LABEL, type DeliveryStatus, type OrderStatus } from "@/domain/order-status";
import { Badge, type Tone } from "./ui";

const ORDER_TONE: Record<OrderStatus, Tone> = {
  placed: "warn",
  accepted: "info",
  preparing: "progress",
  ready_for_delivery: "progress",
  out_for_delivery: "progress",
  delivered: "ok",
  cancelled: "neutral",
};

export function OrderStatusBadge({ status, partial }: { status: OrderStatus; partial?: boolean }) {
  return <Badge tone={ORDER_TONE[status]}>{status === "delivered" && partial ? "Partially delivered" : ORDER_STATUS_LABEL[status]}</Badge>;
}

const PAYMENT: Record<string, [Tone, string]> = {
  not_invoiced: ["neutral", "Not invoiced"],
  unpaid: ["warn", "Unpaid"],
  partially_paid: ["info", "Partly paid"],
  paid: ["ok", "Paid"],
  overdue: ["danger", "Overdue"],
  void: ["neutral", "Void"],
};

export function PaymentStatusBadge({ status }: { status: string }) {
  const [tone, label] = PAYMENT[status] ?? ["neutral", status];
  return <Badge tone={tone}>{label}</Badge>;
}

const DELIVERY_TONE: Record<DeliveryStatus, Tone> = {
  assigned: "info",
  out_for_delivery: "progress",
  delivered: "ok",
  partially_delivered: "warn",
  failed: "danger",
  cancelled: "neutral",
};

export function DeliveryStatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge tone="neutral">Not assigned</Badge>;
  const s = status as DeliveryStatus;
  return <Badge tone={DELIVERY_TONE[s] ?? "neutral"}>{DELIVERY_STATUS_LABEL[s] ?? status}</Badge>;
}

const REL: Record<string, [Tone, string]> = {
  pending: ["warn", "Awaiting approval"],
  approved: ["ok", "Approved"],
  rejected: ["danger", "Declined"],
  blocked: ["danger", "Blocked"],
};

export function RelationshipBadge({ status }: { status: string }) {
  const [tone, label] = REL[status] ?? ["neutral", status];
  return <Badge tone={tone}>{label}</Badge>;
}

const COVERAGE_TONE: Record<Coverage, Tone> = {
  available: "ok",
  needs_confirmation: "warn",
  outside: "neutral",
  pickup_only: "info",
};

export function CoverageBadge({ coverage }: { coverage: Coverage }) {
  return <Badge tone={COVERAGE_TONE[coverage]}>{COVERAGE_LABEL[coverage]}</Badge>;
}

export function AvailabilityBadge({ availability }: { availability: string }) {
  if (availability === "in_stock") return <Badge tone="ok">In stock</Badge>;
  if (availability === "low_stock") return <Badge tone="warn">Low stock</Badge>;
  return <Badge tone="danger">Out of stock</Badge>;
}

export function VerificationBadge({ status }: { status: string }) {
  if (status === "verified") return <Badge tone="ok">Verified business</Badge>;
  if (status === "pending") return <Badge tone="warn">Verification pending</Badge>;
  if (status === "rejected") return <Badge tone="danger">Verification rejected</Badge>;
  return <Badge tone="neutral">Not verified</Badge>;
}

const HANDOVER_TONE: Record<string, Tone> = {
  pending: "warn",
  partially_handed_over: "warn",
  handed_over: "ok",
  not_required: "info",
  no_payment: "neutral",
  reversed: "danger",
};

/** Where a delivery collection's cash is: with the worker, handed over, or not applicable. */
export function HandoverStatusBadge({ status }: { status: string }) {
  return <Badge tone={HANDOVER_TONE[status] ?? "neutral"}>{HANDOVER_STATUS_LABEL[status] ?? status}</Badge>;
}
