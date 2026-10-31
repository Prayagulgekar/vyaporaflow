"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, bool, isNavigationError, str, type ActionState } from "@/lib/action-state";
import { allocatePayment, createCreditNote, generateInvoice, recordPayment, reconcileReceivables, reversePayment, voidInvoice } from "@/server/billing";
import {
  addVariant,
  createBrand,
  createCategory,
  createProduct,
  importProductsCsv,
  productInputSchema,
  variantInputSchema,
  setArchived,
  setProductImage,
  updateProduct,
  updateVariant,
  upsertVariantUnit,
} from "@/server/catalog";
import { confirmHandover, reverseHandover } from "@/server/collections";
import {
  addZone,
  createInvitation,
  deleteZone,
  requestVerification,
  setLogo,
  setMemberStatus,
  setZoneActive,
  updateCompany,
  updatePrimaryAddress,
  updateWholesalerSettings,
} from "@/server/companies";
import { assignDelivery } from "@/server/deliveries";
import { AppError } from "@/server/errors";
import { adjustStock, reconcileInventory } from "@/server/inventory";
import { transitionOrder } from "@/server/orders";
import { createPurchaseOrder, createSupplier, receiveGoods } from "@/server/purchasing";
import { decideRelationship } from "@/server/relationships";
import { saveCompanyImage } from "@/server/storage";
import { fieldErrors } from "@/server/validation";
import { requireWholesaler } from "@/server/viewer";

async function ctx() {
  const { viewer, company } = await requireWholesaler();
  return { userId: viewer.userId, companyId: company.companyId };
}

/** Run an action body, mapping errors to an ActionState and letting redirects through. */
async function run(fn: () => Promise<ActionState | void>, ok: ActionState = { ok: true, message: "Saved" }): Promise<ActionState> {
  try {
    return (await fn()) ?? ok;
  } catch (err) {
    if (isNavigationError(err)) throw err;
    return actionError(err);
  }
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export async function transitionOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    const id = str(fd, "order_id");
    await transitionOrder(userId, id, str(fd, "to"), str(fd, "note") || null);
    revalidatePath(`/w/orders/${id}`);
    return { ok: true, message: "Order updated" };
  });
}

export async function assignDeliveryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    const id = str(fd, "order_id");
    if (!str(fd, "worker_id")) throw new AppError("validation", "Choose who will deliver", { worker_id: ["Choose a person"] });
    await assignDelivery(userId, id, str(fd, "worker_id"), str(fd, "note") || null);
    revalidatePath(`/w/orders/${id}`);
    revalidatePath("/w/delivery");
    return { ok: true, message: "Delivery assigned" };
  });
}

export async function generateInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    const terms = str(fd, "due_days");
    const invoiceId = await generateInvoice(userId, str(fd, "order_id"), terms === "" ? null : Number(terms));
    redirect(`/w/billing/${invoiceId}`);
  });
}

// ---------------------------------------------------------------------------
// Billing and payments
// ---------------------------------------------------------------------------
export async function voidInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    const id = str(fd, "invoice_id");
    await voidInvoice(userId, id, str(fd, "reason"));
    revalidatePath(`/w/billing/${id}`);
    return { ok: true, message: "Invoice voided" };
  });
}

export async function creditNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    const id = str(fd, "invoice_id");
    await createCreditNote(userId, { invoice_id: id, amount: str(fd, "amount"), kind: str(fd, "kind"), reason: str(fd, "reason") });
    revalidatePath(`/w/billing/${id}`);
    return { ok: true, message: "Credit note issued" };
  });
}

export async function recordPaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, companyId } = await ctx();
    const allocations: { invoice_id: string; amount: string }[] = [];
    for (const [k, v] of fd.entries()) {
      if (k.startsWith("alloc:") && typeof v === "string" && v.trim()) allocations.push({ invoice_id: k.slice(6), amount: v.trim() });
    }
    const paymentId = await recordPayment(userId, {
      wholesaler_id: companyId,
      retailer_id: str(fd, "retailer_id"),
      amount: str(fd, "amount"),
      method: str(fd, "method"),
      reference: str(fd, "reference"),
      received_on: str(fd, "received_on"),
      notes: str(fd, "notes"),
      idempotency_key: str(fd, "idempotency_key"),
      allocation_mode: str(fd, "allocation_mode") || "auto",
      allocations,
    });
    redirect(`/w/payments/${paymentId}?recorded=1`);
  });
}

export async function allocatePaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    const id = str(fd, "payment_id");
    await allocatePayment(userId, id, str(fd, "invoice_id"), str(fd, "amount"));
    revalidatePath(`/w/payments/${id}`);
    return { ok: true, message: "Payment applied to the invoice" };
  });
}

export async function reversePaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    const id = str(fd, "payment_id");
    await reversePayment(userId, id, str(fd, "reason"));
    revalidatePath(`/w/payments/${id}`);
    return { ok: true, message: "Payment reversed" };
  });
}

// ---------------------------------------------------------------------------
// Cash collections and handovers
// ---------------------------------------------------------------------------
export async function confirmHandoverAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, companyId } = await ctx();
    const id = await confirmHandover(userId, {
      wholesaler_id: companyId,
      worker_id: str(fd, "worker_id"),
      collection_ids: fd.getAll("collection_id").filter((v): v is string => typeof v === "string"),
      expected: str(fd, "expected"),
      received: str(fd, "received"),
      note: str(fd, "note"),
      idempotency_key: str(fd, "idempotency_key"),
    });
    revalidatePath("/w/cash-collections", "layout");
    redirect(`/w/cash-collections/handovers/${id}?saved=1`);
  });
}

export async function reverseHandoverAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    const id = str(fd, "handover_id");
    await reverseHandover(userId, id, str(fd, "reason"));
    revalidatePath("/w/cash-collections", "layout");
    return { ok: true, message: "Handover reversed. Its cash is pending again." };
  });
}

export async function reconcileAction(_: ActionState): Promise<ActionState> {
  return run(async () => {
    const { userId, companyId } = await ctx();
    const [rec, inv] = await Promise.all([reconcileReceivables(userId, companyId), reconcileInventory(userId, companyId)]);
    const badR = rec.filter((r) => Number(r.difference) !== 0).length;
    const badI = inv.length; // reconcileInventory returns only rows that disagree
    return {
      ok: badR === 0 && badI === 0,
      message:
        badR === 0 && badI === 0
          ? `Checked ${rec.length} retailer balances and every stock record: the ledger, invoices, payments and stock movements all agree.`
          : `${badR} retailer balances and ${badI} stock records do not agree with their history. Contact support with this result.`,
    };
  });
}

// ---------------------------------------------------------------------------
// Retailers
// ---------------------------------------------------------------------------
export async function decideRelationshipAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    const decision = str(fd, "decision");
    await decideRelationship(userId, str(fd, "relationship_id"), decision, str(fd, "credit_limit") || null, str(fd, "note") || null);
    revalidatePath("/w/retailers");
    return { ok: true, message: decision === "approved" ? "Retailer approved" : decision === "blocked" ? "Retailer blocked" : decision === "rejected" ? "Request declined" : "Saved" };
  });
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------
/** Form row numbers of the selling-unit rows that are filled in (unused rows are skipped). */
function unitRowsFrom(fd: FormData): number[] {
  const rows: number[] = [];
  for (let i = 0; i < 6; i++) if (str(fd, `units.${i}.unit_code`)) rows.push(i);
  return rows;
}

/** Map `units.<n>.*` error keys from the submitted list back to the form's row numbers. */
function remapUnitErrors(fe: Record<string, string[]>, rows: number[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(fe)) {
    const m = /^units\.(\d+)\.(.+)$/.exec(k);
    out[m ? `units.${rows[Number(m[1])] ?? m[1]}.${m[2]}` : k] = v;
  }
  return out;
}

function unitsFrom(fd: FormData) {
  const units: Record<string, unknown>[] = [];
  for (let i = 0; i < 6; i++) {
    const code = str(fd, `units.${i}.unit_code`);
    if (!code) continue;
    units.push({
      unit_code: code,
      factor_to_base: str(fd, `units.${i}.factor_to_base`) || "1",
      price: str(fd, `units.${i}.price`),
      mrp: str(fd, `units.${i}.mrp`),
      discount_percent: str(fd, `units.${i}.discount_percent`),
      min_order_qty: str(fd, `units.${i}.min_order_qty`),
      qty_step: str(fd, `units.${i}.qty_step`),
      is_default: str(fd, "default_unit") === String(i),
    });
  }
  return units;
}

function attributesFrom(fd: FormData) {
  const attrs: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("attr.") && typeof v === "string" && v.trim()) attrs[k.slice(5)] = v.trim();
  return attrs;
}

function productFrom(fd: FormData) {
  return {
    name: str(fd, "name"),
    description: str(fd, "description"),
    category_id: str(fd, "category_id"),
    brand_id: str(fd, "brand_id"),
    new_brand: str(fd, "new_brand"),
    tax_class_id: str(fd, "tax_class_id"),
    hsn_code: str(fd, "hsn_code"),
    price_includes_tax: bool(fd, "price_includes_tax"),
    attributes: attributesFrom(fd),
  };
}

function variantFrom(fd: FormData) {
  return {
    name: str(fd, "variant.name"),
    sku: str(fd, "variant.sku"),
    base_unit: str(fd, "variant.base_unit"),
    barcode: str(fd, "variant.barcode"),
    low_stock_threshold: str(fd, "variant.low_stock_threshold"),
    track_batches: bool(fd, "variant.track_batches"),
    opening_stock: str(fd, "variant.opening_stock"),
    batch_no: str(fd, "variant.batch_no"),
    expiry_date: str(fd, "variant.expiry_date"),
    units: unitsFrom(fd),
  };
}

/** Field errors from the variant schema come back as "name", "units.0.price"...; prefix them to match the form. */
function prefixVariantErrors(err: unknown, rows: number[]): ActionState {
  const s = actionError(err);
  if (!s.fieldErrors) return s;
  const fe: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(s.fieldErrors)) fe[k.startsWith("units") ? k : `variant.${k}`] = v;
  return { ...s, fieldErrors: remapUnitErrors(fe, rows) };
}

async function maybeUpload(fd: FormData, companyId: string, kind: "products" | "logo"): Promise<string | null> {
  const f = fd.get("image");
  if (!(f instanceof File) || f.size === 0) return null;
  return saveCompanyImage(companyId, kind, f);
}

export async function createProductAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let productId: string;
  try {
    const { userId, companyId } = await ctx();
    const product = productFrom(fd);
    const variant = variantFrom(fd);
    const p = productInputSchema.safeParse(product);
    const v = variantInputSchema.safeParse(variant);
    if (!p.success || !v.success) {
      const fe: Record<string, string[]> = { ...(p.success ? {} : fieldErrors(p.error)) };
      if (!v.success) for (const [k, msgs] of Object.entries(fieldErrors(v.error))) fe[k.startsWith("units") ? k : `variant.${k}`] = msgs;
      return { ok: false, message: "Please correct the highlighted fields", fieldErrors: remapUnitErrors(fe, unitRowsFrom(fd)) };
    }
    productId = await createProduct(userId, companyId, product, variant);
    const img = await maybeUpload(fd, companyId, "products");
    if (img) await setProductImage(userId, productId, img);
  } catch (err) {
    return prefixVariantErrors(err, unitRowsFrom(fd));
  }
  redirect(`/w/products/${productId}?created=1`);
}

export async function updateProductAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, companyId } = await ctx();
    const id = str(fd, "product_id");
    await updateProduct(userId, id, productFrom(fd));
    const img = await maybeUpload(fd, companyId, "products");
    if (img) await setProductImage(userId, id, img);
    revalidatePath(`/w/products/${id}`);
    return { ok: true, message: "Product saved" };
  });
}

export async function addVariantAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { userId } = await ctx();
    const id = str(fd, "product_id");
    await addVariant(userId, id, variantFrom(fd));
    revalidatePath(`/w/products/${id}`);
    return { ok: true, message: "Variant added" };
  } catch (err) {
    return prefixVariantErrors(err, unitRowsFrom(fd));
  }
}

export async function updateVariantAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    await updateVariant(userId, str(fd, "variant_id"), {
      name: str(fd, "name"),
      low_stock_threshold: str(fd, "low_stock_threshold") || "0",
      is_active: bool(fd, "is_active"),
      track_batches: bool(fd, "track_batches"),
    });
    revalidatePath(`/w/products/${str(fd, "product_id")}`);
    return { ok: true, message: "Variant saved" };
  });
}

export async function saveUnitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    await upsertVariantUnit(
      userId,
      str(fd, "variant_id"),
      {
        unit_code: str(fd, "unit_code"),
        factor_to_base: str(fd, "factor_to_base") || "1",
        price: str(fd, "price"),
        mrp: str(fd, "mrp"),
        discount_percent: str(fd, "discount_percent"),
        min_order_qty: str(fd, "min_order_qty"),
        qty_step: str(fd, "qty_step"),
        is_default: bool(fd, "is_default"),
        is_active: fd.has("is_active") ? bool(fd, "is_active") : true,
      },
      str(fd, "unit_id") || undefined,
    );
    revalidatePath(`/w/products/${str(fd, "product_id")}`);
    return { ok: true, message: "Selling unit saved" };
  });
}

export async function archiveProductAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    const id = str(fd, "product_id");
    const archive = str(fd, "archive") === "1";
    await setArchived(userId, id, archive);
    revalidatePath(`/w/products/${id}`);
    return { ok: true, message: archive ? "Product archived. Retailers no longer see it." : "Product restored" };
  });
}

export async function createCategoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, companyId } = await ctx();
    if (str(fd, "kind") === "brand") await createBrand(userId, companyId, str(fd, "name"));
    else await createCategory(userId, companyId, str(fd, "name"));
    revalidatePath("/w/products/new");
    return { ok: true, message: "Added" };
  });
}

export async function importProductsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, companyId } = await ctx();
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new AppError("validation", "Choose a CSV file", { file: ["Choose a CSV file"] });
    if (f.size > 2 * 1024 * 1024) throw new AppError("validation", "The file is larger than 2 MB", { file: ["Maximum 2 MB"] });
    const result = await importProductsCsv(userId, companyId, await f.text());
    revalidatePath("/w/products");
    return {
      ok: true,
      message: `Imported ${result.created} products.${result.skipped ? ` ${result.skipped} rows were skipped because their SKU already exists.` : ""}`,
    };
  });
}

// ---------------------------------------------------------------------------
// Inventory and purchasing
// ---------------------------------------------------------------------------
export async function adjustStockAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    await adjustStock(userId, {
      variant_id: str(fd, "variant_id"),
      movement_type: str(fd, "movement_type"),
      quantity: str(fd, "quantity"),
      note: str(fd, "note"),
      batch_no: str(fd, "batch_no"),
      expiry_date: str(fd, "expiry_date"),
    });
    revalidatePath("/w/inventory");
    return { ok: true, message: "Stock updated and recorded in the movement history" };
  });
}

export async function createSupplierAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, companyId } = await ctx();
    await createSupplier(userId, companyId, {
      name: str(fd, "name"),
      contact_name: str(fd, "contact_name"),
      phone: str(fd, "phone"),
      email: str(fd, "email"),
      gstin: str(fd, "gstin"),
      address: str(fd, "address"),
    });
    revalidatePath("/w/purchasing");
    return { ok: true, message: "Supplier added" };
  });
}

export async function createPurchaseOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, companyId } = await ctx();
    const items: { variant_id: string; quantity: string; unit_cost: string }[] = [];
    for (let i = 0; i < 10; i++) {
      const v = str(fd, `items.${i}.variant_id`);
      if (v) items.push({ variant_id: v, quantity: str(fd, `items.${i}.quantity`), unit_cost: str(fd, `items.${i}.unit_cost`) });
    }
    const id = await createPurchaseOrder(userId, companyId, { supplier_id: str(fd, "supplier_id"), expected_on: str(fd, "expected_on"), notes: str(fd, "notes"), items });
    redirect(`/w/purchasing/${id}`);
  });
}

export async function receiveGoodsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    const id = str(fd, "po_id");
    const items: { purchase_order_item_id: string; quantity: string; batch_no?: string; expiry_date?: string }[] = [];
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("recv:") || typeof v !== "string" || !v.trim() || Number(v) === 0) continue;
      const itemId = k.slice(5);
      items.push({ purchase_order_item_id: itemId, quantity: v.trim(), batch_no: str(fd, `batch:${itemId}`) || undefined, expiry_date: str(fd, `expiry:${itemId}`) || undefined });
    }
    if (!items.length) throw new AppError("validation", "Enter the quantity received for at least one item");
    await receiveGoods(userId, id, items, str(fd, "note") || null);
    revalidatePath(`/w/purchasing/${id}`);
    return { ok: true, message: "Goods received into stock" };
  });
}

// ---------------------------------------------------------------------------
// Business profile and settings
// ---------------------------------------------------------------------------
export async function updateCompanyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, companyId } = await ctx();
    await updateCompany(userId, companyId, {
      name: str(fd, "name"),
      contact_name: str(fd, "contact_name"),
      phone: str(fd, "phone"),
      email: str(fd, "email"),
      gstin: str(fd, "gstin"),
      preferred_language: str(fd, "preferred_language") || "en",
    });
    const logo = await maybeUpload(fd, companyId, "logo");
    if (logo) await setLogo(userId, companyId, logo);
    revalidatePath("/w", "layout");
    return { ok: true, message: "Business details saved" };
  });
}

export async function updateAddressAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, companyId } = await ctx();
    await updatePrimaryAddress(userId, companyId, {
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

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export async function updateSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, companyId } = await ctx();
    const hours: Record<string, { open: string; close: string } | null> = {};
    for (const d of DAYS) hours[d] = bool(fd, `hours.${d}.on`) ? { open: str(fd, `hours.${d}.open`), close: str(fd, `hours.${d}.close`) } : null;
    await updateWholesalerSettings(userId, companyId, {
      business_category: str(fd, "business_category"),
      description: str(fd, "description"),
      offers_delivery: bool(fd, "offers_delivery"),
      min_order_value: str(fd, "min_order_value") || "0",
      delivery_charge: str(fd, "delivery_charge") || "0",
      free_delivery_above: str(fd, "free_delivery_above"),
      auto_approve_retailers: bool(fd, "auto_approve_retailers"),
      payment_terms_days: str(fd, "payment_terms_days") || "0",
      whatsapp_number: str(fd, "whatsapp_number"),
      is_listed: bool(fd, "is_listed"),
      hours,
    });
    return { ok: true, message: "Settings saved" };
  });
}

export async function addZoneAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, companyId } = await ctx();
    await addZone(userId, companyId, { kind: str(fd, "kind"), name: str(fd, "name"), radius_km: str(fd, "radius_km"), pincodes: str(fd, "pincodes") });
    revalidatePath("/w/profile");
    return { ok: true, message: "Delivery zone added" };
  });
}

export async function zoneToggleAction(fd: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(fd, "zone_id");
  if (str(fd, "op") === "delete") await deleteZone(userId, id);
  else await setZoneActive(userId, id, str(fd, "op") === "activate");
  revalidatePath("/w/profile");
}

export async function requestVerificationAction(_: ActionState): Promise<ActionState> {
  return run(async () => {
    const { userId, companyId } = await ctx();
    await requestVerification(userId, companyId);
    revalidatePath("/w/profile");
    return { ok: true, message: "Verification requested. A platform administrator will review your GSTIN and details." };
  });
}

export async function inviteMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId, companyId } = await ctx();
    const token = await createInvitation(userId, companyId, { email: str(fd, "email"), full_name: str(fd, "full_name"), role: str(fd, "role") });
    revalidatePath("/w/settings");
    return { ok: true, message: "Invitation created. Share this link with the person; it works once and expires in 7 days.", data: { inviteLink: `/invite/${token}` } };
  });
}

export async function memberStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { userId } = await ctx();
    await setMemberStatus(userId, str(fd, "membership_id"), str(fd, "status") === "active" ? "active" : "removed");
    revalidatePath("/w/settings");
    return { ok: true, message: "Team updated" };
  });
}
