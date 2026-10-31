-- =============================================================================
-- 0300 Orders, carts, invoices, payments, ledger, deliveries, purchasing
-- All money is NUMERIC(14,2) in INR. Quantities are NUMERIC(12/14,3).
-- =============================================================================

create type public.order_status as enum (
  'placed', 'accepted', 'preparing', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'cancelled'
);
create type public.delivery_status as enum (
  'assigned', 'out_for_delivery', 'delivered', 'partially_delivered', 'failed', 'cancelled'
);
create type public.payment_method as enum ('cash', 'bank_transfer', 'upi', 'cheque', 'other');

-- -----------------------------------------------------------------------------
-- Carts: one cart per (retailer, wholesaler). Not authoritative for pricing.
-- -----------------------------------------------------------------------------
create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.companies(id) on delete cascade,
  wholesaler_id uuid not null references public.companies(id) on delete cascade,
  variant_unit_id uuid not null references public.variant_units(id) on delete cascade,
  quantity numeric(12, 3) not null check (quantity > 0 and quantity <= 100000),
  added_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (retailer_id, variant_unit_id)
);
create index cart_items_cart_idx on public.cart_items (retailer_id, wholesaler_id);

-- Keep wholesaler_id consistent with the product owner, so a cart can never
-- mix wholesalers.
create or replace function app.cart_item_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company uuid;
begin
  select company_id into v_company from public.variant_units where id = new.variant_unit_id;
  if v_company is null or v_company <> new.wholesaler_id then
    raise exception using errcode = 'VF422', message = 'Cart item does not belong to this wholesaler';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger cart_items_check before insert or update on public.cart_items
  for each row execute function app.cart_item_check();

-- -----------------------------------------------------------------------------
-- Orders
-- -----------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  wholesaler_id uuid not null references public.companies(id),
  retailer_id uuid not null references public.companies(id),
  placed_by uuid references auth.users(id),
  status public.order_status not null default 'placed',
  delivery_address jsonb not null,
  place_of_supply text not null references public.indian_states(code),
  items_count int not null check (items_count > 0),
  subtotal numeric(14, 2) not null check (subtotal >= 0),
  discount_total numeric(14, 2) not null default 0 check (discount_total >= 0),
  taxable_total numeric(14, 2) not null check (taxable_total >= 0),
  tax_total numeric(14, 2) not null check (tax_total >= 0),
  delivery_charge numeric(14, 2) not null default 0 check (delivery_charge >= 0),
  grand_total numeric(14, 2) not null check (grand_total >= 0),
  notes text check (char_length(notes) <= 1000),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  partially_delivered boolean not null default false,
  cancel_reason text,
  placed_at timestamptz not null default now(),
  accepted_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (wholesaler_id, order_number),
  unique (retailer_id, idempotency_key),
  check (wholesaler_id <> retailer_id),
  check (grand_total = taxable_total + tax_total + delivery_charge)
);
create index orders_wholesaler_idx on public.orders (wholesaler_id, placed_at desc);
create index orders_wholesaler_status_idx on public.orders (wholesaler_id, status);
create index orders_retailer_idx on public.orders (retailer_id, placed_at desc);

-- Immutable line snapshots: names, units, prices and tax as they were when the
-- order was placed. Only delivered_quantity is written later (on delivery).
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  wholesaler_id uuid not null references public.companies(id),
  line_no int not null check (line_no > 0),
  product_id uuid not null references public.products(id),
  variant_id uuid not null references public.product_variants(id),
  variant_unit_id uuid references public.variant_units(id) on delete set null,
  product_name text not null,
  variant_name text not null,
  sku text not null,
  hsn_code text,
  unit_code text not null references public.units_of_measure(code),
  unit_factor numeric(14, 3) not null check (unit_factor > 0),
  base_unit text not null references public.units_of_measure(code),
  quantity numeric(12, 3) not null check (quantity > 0),
  base_quantity numeric(14, 3) not null check (base_quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  price_includes_tax boolean not null,
  discount_percent numeric(5, 2) not null default 0,
  line_amount numeric(14, 2) not null,
  discount_amount numeric(14, 2) not null,
  taxable_amount numeric(14, 2) not null,
  tax_rate numeric(5, 2) not null,
  tax_amount numeric(14, 2) not null,
  line_total numeric(14, 2) not null,
  delivered_quantity numeric(12, 3) check (delivered_quantity is null or (delivered_quantity >= 0 and delivered_quantity <= quantity)),
  unique (order_id, line_no),
  check (line_total = taxable_amount + tax_amount),
  check (base_quantity = quantity * unit_factor)
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_variant_idx on public.order_items (variant_id);

create or replace function app.order_items_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'VF409', message = 'Order lines cannot be deleted';
  end if;
  if (new.quantity, new.unit_price, new.line_total, new.tax_amount, new.taxable_amount, new.product_name, new.variant_id)
     is distinct from
     (old.quantity, old.unit_price, old.line_total, old.tax_amount, old.taxable_amount, old.product_name, old.variant_id) then
    raise exception using errcode = 'VF409', message = 'Order line snapshots are immutable';
  end if;
  return new;
end $$;
create trigger order_items_guard before update or delete on public.order_items
  for each row execute function app.order_items_guard();

create or replace function app.orders_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'VF409', message = 'Orders cannot be deleted; cancel them instead';
  end if;
  if (new.grand_total, new.subtotal, new.tax_total, new.taxable_total, new.discount_total, new.delivery_charge,
      new.wholesaler_id, new.retailer_id, new.order_number)
     is distinct from
     (old.grand_total, old.subtotal, old.tax_total, old.taxable_total, old.discount_total, old.delivery_charge,
      old.wholesaler_id, old.retailer_id, old.order_number) then
    raise exception using errcode = 'VF409', message = 'Confirmed order totals and parties cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger orders_guard before update or delete on public.orders
  for each row execute function app.orders_guard();

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null check (event_type in (
    'placed', 'status_changed', 'delivery_assigned', 'delivery_updated', 'invoice_issued',
    'payment_applied', 'credit_note_issued', 'note')),
  from_status public.order_status,
  to_status public.order_status,
  note text check (char_length(note) <= 1000),
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, id);
create trigger order_events_append_only before update or delete on public.order_events
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Invoices (one per order) and credit notes
-- -----------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null,
  wholesaler_id uuid not null references public.companies(id),
  retailer_id uuid not null references public.companies(id),
  order_id uuid not null references public.orders(id),
  invoice_date date not null,
  due_date date not null,
  supply_type text not null check (supply_type in ('intra_state', 'inter_state')),
  place_of_supply text not null references public.indian_states(code),
  seller jsonb not null,  -- snapshot: name, gstin, address, state_code
  buyer jsonb not null,   -- snapshot: name, gstin, address, state_code
  subtotal numeric(14, 2) not null,
  discount_total numeric(14, 2) not null,
  taxable_total numeric(14, 2) not null,
  cgst_total numeric(14, 2) not null default 0,
  sgst_total numeric(14, 2) not null default 0,
  igst_total numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null,
  delivery_charge numeric(14, 2) not null default 0,
  grand_total numeric(14, 2) not null check (grand_total >= 0),
  status text not null default 'issued' check (status in ('issued', 'void')),
  void_reason text,
  voided_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (wholesaler_id, invoice_number),
  check (due_date >= invoice_date),
  check (tax_total = cgst_total + sgst_total + igst_total),
  check (grand_total = taxable_total + tax_total + delivery_charge),
  check ((supply_type = 'intra_state' and igst_total = 0) or (supply_type = 'inter_state' and cgst_total = 0 and sgst_total = 0))
);
-- At most one live (non-void) invoice per order.
create unique index invoices_one_live_per_order on public.invoices (order_id) where status = 'issued';
create index invoices_wholesaler_idx on public.invoices (wholesaler_id, invoice_date desc);
create index invoices_retailer_idx on public.invoices (retailer_id, invoice_date desc);
create index invoices_pair_idx on public.invoices (wholesaler_id, retailer_id);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id),
  line_no int not null,
  description text not null,
  hsn_code text,
  quantity numeric(12, 3) not null,
  unit_code text not null,
  unit_price numeric(14, 2) not null,
  discount_amount numeric(14, 2) not null,
  taxable_amount numeric(14, 2) not null,
  tax_rate numeric(5, 2) not null,
  cgst_amount numeric(14, 2) not null default 0,
  sgst_amount numeric(14, 2) not null default 0,
  igst_amount numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null,
  unique (invoice_id, line_no),
  check (line_total = taxable_amount + cgst_amount + sgst_amount + igst_amount)
);

-- Invoice financial fields are immutable after issue; only voiding is allowed.
create or replace function app.invoices_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'VF409', message = 'Invoices cannot be deleted; void them instead';
  end if;
  if (new.grand_total, new.taxable_total, new.tax_total, new.invoice_number, new.retailer_id, new.wholesaler_id, new.invoice_date)
     is distinct from
     (old.grand_total, old.taxable_total, old.tax_total, old.invoice_number, old.retailer_id, old.wholesaler_id, old.invoice_date) then
    raise exception using errcode = 'VF409', message = 'Issued invoices are immutable; use a credit note';
  end if;
  if old.status = 'void' then
    raise exception using errcode = 'VF409', message = 'Void invoices cannot be changed';
  end if;
  return new;
end $$;
create trigger invoices_guard before update or delete on public.invoices
  for each row execute function app.invoices_guard();
create trigger invoice_items_append_only before update or delete on public.invoice_items
  for each row execute function app.forbid_mutation();

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  credit_note_number text not null,
  wholesaler_id uuid not null references public.companies(id),
  retailer_id uuid not null references public.companies(id),
  invoice_id uuid not null references public.invoices(id),
  kind text not null check (kind in ('return', 'short_delivery', 'discount', 'correction')),
  reason text not null check (char_length(reason) between 3 and 500),
  taxable_amount numeric(14, 2) not null check (taxable_amount >= 0),
  tax_amount numeric(14, 2) not null check (tax_amount >= 0),
  amount numeric(14, 2) not null check (amount > 0),
  issued_on date not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (wholesaler_id, credit_note_number),
  check (amount = taxable_amount + tax_amount)
);
create index credit_notes_invoice_idx on public.credit_notes (invoice_id);
create trigger credit_notes_append_only before update or delete on public.credit_notes
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Payments, allocations and reversals
-- A payment is money received from a retailer. Allocations apply it to
-- invoices. Reversals never delete history: they add a reversal record and
-- negative allocation rows.
-- -----------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_number text not null,
  wholesaler_id uuid not null references public.companies(id),
  retailer_id uuid not null references public.companies(id),
  amount numeric(14, 2) not null check (amount > 0),
  method public.payment_method not null,
  reference text check (char_length(reference) <= 100),
  notes text check (char_length(notes) <= 500),
  received_at timestamptz not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  -- A UPI or bank reference typed by a user is NOT a verified gateway
  -- transaction. verified_by_gateway stays false until a real integration exists.
  verified_by_gateway boolean not null default false,
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (wholesaler_id, payment_number),
  unique (wholesaler_id, idempotency_key)
);
create index payments_pair_idx on public.payments (wholesaler_id, retailer_id, received_at desc);
create index payments_retailer_idx on public.payments (retailer_id, received_at desc);

create or replace function app.payments_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'VF409', message = 'Payments cannot be deleted; reverse them instead';
  end if;
  if (new.amount, new.method, new.retailer_id, new.wholesaler_id, new.received_at, new.payment_number)
     is distinct from (old.amount, old.method, old.retailer_id, old.wholesaler_id, old.received_at, old.payment_number)
     or (old.status = 'reversed') then
    raise exception using errcode = 'VF409', message = 'Posted payments are immutable; record a reversal instead';
  end if;
  return new;
end $$;
create trigger payments_guard before update or delete on public.payments
  for each row execute function app.payments_guard();

create table public.payment_reversals (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments(id),
  reason text not null check (char_length(reason) between 3 and 500),
  reversed_by uuid references auth.users(id),
  reversed_at timestamptz not null default now()
);
create trigger payment_reversals_append_only before update or delete on public.payment_reversals
  for each row execute function app.forbid_mutation();

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  invoice_id uuid not null references public.invoices(id),
  wholesaler_id uuid not null references public.companies(id),
  amount numeric(14, 2) not null check (amount <> 0),
  reversal_of uuid unique references public.payment_allocations(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check ((reversal_of is null) = (amount > 0))
);
create index payment_allocations_payment_idx on public.payment_allocations (payment_id);
create index payment_allocations_invoice_idx on public.payment_allocations (invoice_id);
create trigger payment_allocations_append_only before update or delete on public.payment_allocations
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Double-entry ledger (per wholesaler). Every invoice, credit note, payment
-- and reversal posts one balanced journal. Balance is enforced at commit time
-- by a deferred constraint trigger. Accounts:
--   AR (accounts receivable, per retailer), SALES, DELIVERY_INCOME,
--   OUTPUT_CGST, OUTPUT_SGST, OUTPUT_IGST, SALES_RETURNS, CASH, BANK, UPI, CHEQUE, OTHER
-- -----------------------------------------------------------------------------
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  entry_date date not null,
  source_type text not null check (source_type in ('invoice', 'invoice_void', 'credit_note', 'payment', 'payment_reversal')),
  source_id uuid not null,
  memo text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);
create index journal_entries_company_idx on public.journal_entries (company_id, entry_date);

create table public.journal_lines (
  id bigint generated always as identity primary key,
  journal_id uuid not null references public.journal_entries(id),
  company_id uuid not null references public.companies(id),
  account_code text not null check (account_code in (
    'AR', 'SALES', 'DELIVERY_INCOME', 'OUTPUT_CGST', 'OUTPUT_SGST', 'OUTPUT_IGST',
    'SALES_RETURNS', 'CASH', 'BANK', 'UPI', 'CHEQUE', 'OTHER')),
  retailer_id uuid references public.companies(id),
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  check ((debit = 0) <> (credit = 0)),
  check (account_code <> 'AR' or retailer_id is not null)
);
create index journal_lines_ar_idx on public.journal_lines (company_id, retailer_id) where account_code = 'AR';
create index journal_lines_journal_idx on public.journal_lines (journal_id);

create or replace function app.check_journal_balanced() returns trigger
language plpgsql as $$
declare v_diff numeric;
begin
  select coalesce(sum(debit), 0) - coalesce(sum(credit), 0) into v_diff
  from public.journal_lines where journal_id = new.journal_id;
  if v_diff <> 0 then
    raise exception using errcode = 'VF409', message = format('Journal %s is not balanced (difference %s)', new.journal_id, v_diff);
  end if;
  return null;
end $$;
create constraint trigger journal_lines_balanced after insert on public.journal_lines
  deferrable initially deferred for each row execute function app.check_journal_balanced();
create trigger journal_entries_append_only before update or delete on public.journal_entries
  for each row execute function app.forbid_mutation();
create trigger journal_lines_append_only before update or delete on public.journal_lines
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Deliveries
-- -----------------------------------------------------------------------------
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id),
  wholesaler_id uuid not null references public.companies(id),
  assigned_worker_id uuid references auth.users(id),
  status public.delivery_status not null default 'assigned',
  dispatched_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  failure_reason text check (char_length(failure_reason) <= 500),
  recipient_name text check (char_length(recipient_name) <= 120),
  notes text check (char_length(notes) <= 1000),
  -- Category workflows, e.g. empty gas cylinders collected on delivery.
  empties_collected int check (empties_collected is null or empties_collected >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deliveries_worker_idx on public.deliveries (assigned_worker_id, status);
create index deliveries_wholesaler_idx on public.deliveries (wholesaler_id, status);

create table public.delivery_assignments (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  worker_id uuid not null references auth.users(id),
  assigned_by uuid references auth.users(id),
  note text check (char_length(note) <= 500),
  assigned_at timestamptz not null default now(),
  ended_at timestamptz
);
create index delivery_assignments_delivery_idx on public.delivery_assignments (delivery_id);

create table public.delivery_events (
  id bigint generated always as identity primary key,
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  from_status public.delivery_status,
  to_status public.delivery_status not null,
  note text check (char_length(note) <= 1000),
  details jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index delivery_events_delivery_idx on public.delivery_events (delivery_id, id);
create trigger delivery_events_append_only before update or delete on public.delivery_events
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Purchasing: suppliers, purchase orders, goods received
-- -----------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  contact_name text check (char_length(contact_name) <= 120),
  phone text check (phone is null or phone ~ '^\+?[0-9]{10,13}$'),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  address text check (char_length(address) <= 300),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, company_id)
);
create index suppliers_company_idx on public.suppliers (company_id);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  po_number text not null,
  supplier_id uuid not null,
  status text not null default 'ordered' check (status in ('ordered', 'partially_received', 'received', 'cancelled')),
  expected_on date,
  notes text check (char_length(notes) <= 500),
  total_cost numeric(14, 2) not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (company_id, po_number),
  foreign key (supplier_id, company_id) references public.suppliers(id, company_id)
);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  company_id uuid not null,
  variant_id uuid not null,
  quantity numeric(14, 3) not null check (quantity > 0),  -- in base units
  unit_cost numeric(14, 2) not null check (unit_cost >= 0),
  received_quantity numeric(14, 3) not null default 0 check (received_quantity >= 0),
  foreign key (variant_id, company_id) references public.product_variants(id, company_id),
  check (received_quantity <= quantity)
);

create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  purchase_order_id uuid not null references public.purchase_orders(id),
  received_at timestamptz not null default now(),
  received_by uuid references auth.users(id),
  note text check (char_length(note) <= 500)
);

create table public.goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
  purchase_order_item_id uuid not null references public.purchase_order_items(id),
  quantity numeric(14, 3) not null check (quantity > 0),
  batch_id uuid references public.product_batches(id)
);
