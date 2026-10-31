import { NextResponse, type NextRequest } from "next/server";
import { apiError, assertSameOrigin } from "@/server/api";
import { getSessionUser } from "@/server/auth/session";
import { getOrder, placeOrder } from "@/server/orders";

export const dynamic = "force-dynamic";

/**
 * Place an order. Body: { retailer_id, wholesaler_id, items: [{variant_unit_id, quantity}], idempotency_key, notes? }.
 * Any price or total fields in the body are ignored; the database computes them.
 * Repeating a request with the same idempotency_key returns the same order instead of creating another.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
    const id = await placeOrder(user.id, {
      retailer_id: body.retailer_id,
      wholesaler_id: body.wholesaler_id,
      items: body.items,
      idempotency_key: body.idempotency_key,
      notes: body.notes,
    });
    const order = await getOrder(user.id, id);
    return NextResponse.json({ id, order_number: order.order_number, status: order.status, grand_total: order.grand_total }, { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}
