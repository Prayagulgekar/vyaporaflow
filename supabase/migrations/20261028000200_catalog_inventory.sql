-- =============================================================================
-- 0200 Catalog and inventory
-- =============================================================================

-- Units. Units in the same physical dimension (mass, volume) convert through
-- base_factor (grams, millilitres). Count units (packet, box, carton...) have no
-- universal size, so every product variant declares its own conversion in
-- variant_units. A carton is never treated as a packet unless configured.
create table public.units_of_measure (
  code text primary key check (code ~ '^[a-z_]{1,20}$'),
  name text not null,
  plural_name text not null,
  dimension text not null check (dimension in ('count', 'mass', 'volume')),
  base_factor numeric(18, 6) check (base_factor is null or base_factor > 0),
  allows_fraction boolean not null default false,
  check ((dimension = 'count') = (base_factor is null))
);

create table public.tax_classes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,  -- null = platform default
  name text not null check (char_length(name) between 2 and 80),
  rate numeric(5, 2) not null check (rate >= 0 and rate <= 50),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index tax_classes_name_key on public.tax_classes (company_id, lower(name)) nulls not distinct;

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,  -- null = platform taxonomy
  parent_id uuid references public.product_categories(id) on delete set null,
  name text not null check (char_length(name) between 2 and 80),
  slug text not null check (slug ~ '^[a-z0-9-]{2,80}$'),
  -- Category-specific attributes: [{"key":"weight_kg","label":"Net weight (kg)","type":"number","required":true}]
  attribute_schema jsonb not null default '[]'::jsonb check (jsonb_typeof(attribute_schema) = 'array'),
  -- Optional workflows, e.g. {"requires_empty_return": true} for gas cylinders.
  workflow_flags jsonb not null default '{}'::jsonb check (jsonb_typeof(workflow_flags) = 'object'),
  is_active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
create unique index product_categories_slug_key on public.product_categories (company_id, slug) nulls not distinct;

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create unique index brands_name_key on public.brands (company_id, lower(name)) nulls not distinct;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category_id uuid not null references public.product_categories(id),
  brand_id uuid references public.brands(id),
  tax_class_id uuid not null references public.tax_classes(id),
  name text not null check (char_length(name) between 2 and 160),
  description text check (char_length(description) <= 2000),
  hsn_code text check (hsn_code is null or hsn_code ~ '^[0-9]{4,8}$'),
  price_includes_tax boolean not null default false,
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  image_path text,
  archived_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id)
);
create index products_company_idx on public.products (company_id) where archived_at is null;
create index products_name_idx on public.products (company_id, lower(name));
create index products_category_idx on public.products (category_id);
create trigger products_touch before update on public.products
  for each row execute function app.touch_updated_at();

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  company_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),  -- e.g. "52 g", "25 kg bag"
  sku text not null check (sku ~ '^[A-Za-z0-9._/-]{2,40}$'),
  base_unit text not null references public.units_of_measure(code),  -- the unit stock is counted in
  barcode text check (barcode is null or barcode ~ '^[0-9]{8,14}$'),
  low_stock_threshold numeric(14, 3) not null default 0 check (low_stock_threshold >= 0),
  track_batches boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (product_id, company_id) references public.products(id, company_id) on delete cascade,
  unique (company_id, sku),
  unique (id, company_id)
);
create index product_variants_product_idx on public.product_variants (product_id);

-- Selling units and their conversion into the variant's stock (base) unit.
-- Example: variant "Classic Salted 52 g" counted in packets; sold per carton
-- of 48 packets (factor_to_base = 48) at a carton price.
create table public.variant_units (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null,
  company_id uuid not null,
  unit_code text not null references public.units_of_measure(code),
  factor_to_base numeric(14, 3) not null check (factor_to_base > 0),
  price numeric(14, 2) not null check (price >= 0),
  mrp numeric(14, 2) check (mrp is null or mrp >= 0),
  discount_percent numeric(5, 2) not null default 0 check (discount_percent >= 0 and discount_percent < 100),
  min_order_qty numeric(12, 3) not null default 1 check (min_order_qty > 0),
  qty_step numeric(12, 3) not null default 1 check (qty_step > 0),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (variant_id, company_id) references public.product_variants(id, company_id) on delete cascade,
  unique (variant_id, unit_code)
);
create unique index variant_units_one_default on public.variant_units (variant_id) where is_default;
create trigger variant_units_touch before update on public.variant_units
  for each row execute function app.touch_updated_at();

create table public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, company_id)
);
create unique index inventory_locations_one_default on public.inventory_locations (company_id) where is_default;

-- Authoritative stock position per location and variant, in base units.
-- Invariants enforced by the database: on_hand >= 0, reserved >= 0 and
-- reserved <= on_hand, so stock can never be oversold. Every change is made
-- by app.* functions that also write a stock_movements row; the projection
-- can be reconciled against the movement journal (app.reconcile_inventory).
create table public.inventory_balances (
  company_id uuid not null,
  location_id uuid not null,
  variant_id uuid not null,
  on_hand numeric(14, 3) not null default 0 check (on_hand >= 0),
  reserved numeric(14, 3) not null default 0 check (reserved >= 0),
  available numeric(14, 3) generated always as (on_hand - reserved) stored,
  updated_at timestamptz not null default now(),
  primary key (location_id, variant_id),
  check (reserved <= on_hand),
  foreign key (location_id, company_id) references public.inventory_locations(id, company_id) on delete cascade,
  foreign key (variant_id, company_id) references public.product_variants(id, company_id) on delete cascade
);
create index inventory_balances_company_idx on public.inventory_balances (company_id);

create table public.product_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  variant_id uuid not null,
  batch_no text not null check (char_length(batch_no) between 1 and 40),
  manufactured_on date,
  expiry_date date,
  quantity_received numeric(14, 3) not null check (quantity_received > 0),
  created_at timestamptz not null default now(),
  foreign key (variant_id, company_id) references public.product_variants(id, company_id) on delete cascade,
  unique (variant_id, batch_no),
  check (expiry_date is null or manufactured_on is null or expiry_date >= manufactured_on)
);
create index product_batches_expiry_idx on public.product_batches (company_id, expiry_date);

create type public.stock_movement_type as enum (
  'opening', 'addition', 'reduction', 'adjustment', 'damage', 'return',
  'purchase_receipt', 'purchase_return',
  'reservation', 'reservation_release', 'sale_dispatch', 'delivery_return'
);

-- Append-only journal of every stock change.
create table public.stock_movements (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid not null,
  variant_id uuid not null,
  movement_type public.stock_movement_type not null,
  on_hand_delta numeric(14, 3) not null default 0,
  reserved_delta numeric(14, 3) not null default 0,
  on_hand_after numeric(14, 3) not null,
  reserved_after numeric(14, 3) not null,
  reference_type text,
  reference_id uuid,
  batch_id uuid references public.product_batches(id),
  note text check (char_length(note) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (on_hand_delta <> 0 or reserved_delta <> 0)
);
create index stock_movements_variant_idx on public.stock_movements (variant_id, created_at desc);
create index stock_movements_company_idx on public.stock_movements (company_id, created_at desc);
create trigger stock_movements_append_only before update or delete on public.stock_movements
  for each row execute function app.forbid_mutation();

-- Apply a stock delta to the balance row (locking it) and journal it.
-- Internal: callers must have authorized the operation.
create or replace function app.apply_stock_change(
  p_company uuid, p_location uuid, p_variant uuid, p_type public.stock_movement_type,
  p_on_hand_delta numeric, p_reserved_delta numeric,
  p_reference_type text, p_reference_id uuid, p_note text, p_batch uuid default null
) returns public.inventory_balances
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare b public.inventory_balances;
begin
  insert into public.inventory_balances (company_id, location_id, variant_id)
  values (p_company, p_location, p_variant)
  on conflict (location_id, variant_id) do nothing;

  select * into b from public.inventory_balances
  where location_id = p_location and variant_id = p_variant
  for update;

  if b.on_hand + p_on_hand_delta < 0 then
    perform app.fail('VF409', format('Not enough stock on hand (on hand %s, change %s)', b.on_hand, p_on_hand_delta));
  end if;
  if b.reserved + p_reserved_delta > b.on_hand + p_on_hand_delta then
    if p_reserved_delta > 0 then
      perform app.fail('VF409', format('Insufficient available stock (available %s, requested %s)',
        b.on_hand + p_on_hand_delta - b.reserved, p_reserved_delta));
    else
      perform app.fail('VF409', format('Stock cannot go below the %s units reserved for open orders', b.reserved));
    end if;
  end if;

  update public.inventory_balances
     set on_hand = on_hand + p_on_hand_delta,
         reserved = reserved + p_reserved_delta,
         updated_at = app.now()
   where location_id = p_location and variant_id = p_variant
  returning * into b;

  insert into public.stock_movements (company_id, location_id, variant_id, movement_type,
    on_hand_delta, reserved_delta, on_hand_after, reserved_after,
    reference_type, reference_id, batch_id, note, created_by, created_at)
  values (p_company, p_location, p_variant, p_type, p_on_hand_delta, p_reserved_delta,
    b.on_hand, b.reserved, p_reference_type, p_reference_id, p_batch, p_note, auth.uid(), app.now());

  return b;
end $$;

create or replace function app.default_location(p_company uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.inventory_locations where company_id = p_company and is_default
$$;
