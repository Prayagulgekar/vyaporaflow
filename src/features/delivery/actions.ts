"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, isNavigationError, str, type ActionState } from "@/lib/action-state";
import { completeDelivery, recordCollection } from "@/server/collections";
import { updateDelivery } from "@/server/deliveries";
import { requireDeliveryWorker } from "@/server/viewer";

const MESSAGES: Record<string, string> = {
  out_for_delivery: "Delivery started. The retailer can see the order is on the way.",
  delivered: "Marked as delivered.",
  partially_delivered: "Partial delivery recorded. Undelivered items go back to stock.",
  failed: "Failed attempt recorded. The office will arrange another attempt.",
};

export async function updateDeliveryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const viewer = await requireDeliveryWorker();
  const to = str(fd, "to");
  const items: { order_item_id: string; delivered_quantity: string }[] = [];
  for (const [k, v] of fd.entries()) if (k.startsWith("del:") && typeof v === "string") items.push({ order_item_id: k.slice(4), delivered_quantity: v.trim() || "0" });
  try {
    await updateDelivery(viewer.userId, {
      delivery_id: str(fd, "delivery_id"),
      to,
      note: str(fd, "note"),
      failure_reason: str(fd, "failure_reason"),
      recipient_name: str(fd, "recipient_name"),
      empties_collected: str(fd, "empties_collected"),
      items: to === "partially_delivered" ? items : undefined,
    });
  } catch (err) {
    return actionError(err);
  }
  revalidatePath("/d", "layout");
  return { ok: true, message: MESSAGES[to] ?? "Updated" };
}

function collectionInput(fd: FormData) {
  return {
    delivery_id: str(fd, "delivery_id"),
    amount: str(fd, "amount"),
    method: str(fd, "method") || "cash",
    reference: str(fd, "reference"),
    collection_note: str(fd, "collection_note"),
    collected_at: str(fd, "collected_at"),
    idempotency_key: str(fd, "idempotency_key"),
  };
}

/** Deliver and record the money collected, in one database transaction. */
export async function completeDeliveryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const viewer = await requireDeliveryWorker();
  const to = str(fd, "to");
  const items: { order_item_id: string; delivered_quantity: string }[] = [];
  for (const [k, v] of fd.entries()) if (k.startsWith("del:") && typeof v === "string") items.push({ order_item_id: k.slice(4), delivered_quantity: v.trim() || "0" });
  const deliveryId = str(fd, "delivery_id");
  try {
    const r = await completeDelivery(viewer.userId, {
      ...collectionInput(fd),
      to,
      note: str(fd, "note"),
      recipient_name: str(fd, "recipient_name"),
      empties_collected: str(fd, "empties_collected"),
      items: to === "partially_delivered" ? items : undefined,
    });
    revalidatePath("/d", "layout");
    redirect(`/d/${deliveryId}?recorded=${r.id}`);
  } catch (err) {
    if (isNavigationError(err)) throw err;
    return actionError(err);
  }
}

/** Record money collected on a delivery that is already marked delivered. */
export async function recordCollectionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const viewer = await requireDeliveryWorker();
  const deliveryId = str(fd, "delivery_id");
  try {
    const r = await recordCollection(viewer.userId, collectionInput(fd));
    revalidatePath("/d", "layout");
    redirect(`/d/${deliveryId}?recorded=${r.id}`);
  } catch (err) {
    if (isNavigationError(err)) throw err;
    return actionError(err);
  }
}
