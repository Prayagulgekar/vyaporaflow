"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, isNavigationError, str, type ActionState } from "@/lib/action-state";
import { clearCart, setCartQuantity } from "@/server/cart";
import { setLogo, updateCompany, updatePrimaryAddress } from "@/server/companies";
import { saveCompanyImage } from "@/server/storage";
import { placeOrder, reorder, transitionOrder } from "@/server/orders";
import { requestRelationship } from "@/server/relationships";
import { requireRetailer } from "@/server/viewer";

async function ctx() {
  const { viewer, company } = await requireRetailer();
  return { userId: viewer.userId, retailerId: company.companyId };
}

async function run(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true, message: "Saved" };
  } catch (err) {
    if (isNavigationError(err)) throw err;
    return actionError(err);
  }
}

export async function setCartAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, retailerId } = await ctx();
    const qty = str(fd, "quantity") || "0";
    await setCartQuantity(userId, retailerId, str(fd, "variant_unit_id"), qty);
    revalidatePath("/r", "layout");
    return { ok: true, message: Number(qty) === 0 ? "Removed from cart" : "Cart updated" };
  });
}

export async function clearCartAction(fd: FormData): Promise<void> {
  const { userId, retailerId } = await ctx();
  await clearCart(userId, retailerId, str(fd, "wholesaler_id"));
  revalidatePath("/r", "layout");
}

export async function placeOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, retailerId } = await ctx();
    const items: { variant_unit_id: string; quantity: string }[] = [];
    for (const [k, v] of fd.entries()) if (k.startsWith("qty:") && typeof v === "string") items.push({ variant_unit_id: k.slice(4), quantity: v });
    // Only product references and quantities are sent; the database prices the order.
    const orderId = await placeOrder(userId, {
      retailer_id: retailerId,
      wholesaler_id: str(fd, "wholesaler_id"),
      items,
      idempotency_key: str(fd, "idempotency_key"),
      notes: str(fd, "notes"),
    });
    revalidatePath("/r", "layout");
    redirect(`/r/orders/${orderId}?placed=1`);
  });
}

export async function cancelOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    const id = str(fd, "order_id");
    await transitionOrder(userId, id, "cancelled", str(fd, "note") || "Cancelled by retailer");
    revalidatePath(`/r/orders/${id}`);
    return { ok: true, message: "Order cancelled" };
  });
}

export async function reorderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, retailerId } = await ctx();
    const r = await reorder(userId, retailerId, str(fd, "order_id"));
    revalidatePath("/r", "layout");
    if (r.added === 0) return { ok: false, message: "None of these products are available any more." };
    redirect(`/r/cart?reordered=${r.added}&skipped=${r.skipped.length}#w-${r.wholesalerId}`);
  });
}

export async function requestConnectionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, retailerId } = await ctx();
    await requestRelationship(userId, retailerId, str(fd, "wholesaler_id"), str(fd, "note") || null);
    revalidatePath("/r", "layout");
    return { ok: true, message: "Request sent. You can order once the wholesaler approves you." };
  });
}

export async function updateShopAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, retailerId } = await ctx();
    await updateCompany(userId, retailerId, {
      name: str(fd, "name"),
      contact_name: str(fd, "contact_name"),
      phone: str(fd, "phone"),
      email: str(fd, "email"),
      gstin: str(fd, "gstin"),
      preferred_language: str(fd, "preferred_language") || "en",
    });
    const f = fd.get("image");
    if (f instanceof File && f.size > 0) await setLogo(userId, retailerId, await saveCompanyImage(retailerId, "logo", f));
    revalidatePath("/r", "layout");
    return { ok: true, message: "Shop details saved" };
  });
}

export async function updateShopAddressAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, retailerId } = await ctx();
    await updatePrimaryAddress(userId, retailerId, {
      line1: str(fd, "line1"),
      line2: str(fd, "line2"),
      city: str(fd, "city"),
      state_code: str(fd, "state_code"),
      pincode: str(fd, "pincode"),
      latitude: str(fd, "latitude"),
      longitude: str(fd, "longitude"),
    });
    return { ok: true, message: "Address saved" };
  });
}
