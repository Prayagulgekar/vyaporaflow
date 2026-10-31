-- =============================================================================
-- 0100 Foundation: schemas, enums, reference data, identity and tenancy
-- =============================================================================

-- Business functions live in the `app` schema. Supabase exposes only `public`
-- (and graphql_public) through its REST API by default; keep `app` unexposed.
create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enumerations
-- -----------------------------------------------------------------------------
create type public.account_type as enum ('wholesaler', 'retailer', 'delivery_worker');
create type public.company_kind as enum ('wholesaler', 'retailer');
create type public.company_status as enum ('active', 'suspended');
create type public.verification_status as enum ('unverified', 'pending', 'verified', 'rejected');
create type public.membership_role as enum ('owner', 'manager', 'staff', 'delivery_worker');
create type public.membership_status as enum ('active', 'removed');
create type public.relationship_status as enum ('pending', 'approved', 'rejected', 'blocked');

-- -----------------------------------------------------------------------------
-- Clock. Business functions call app.now() so the seed script can create
-- historical records with consistent timestamps. The override GUC is only ever
-- set by the trusted seed script; application code never sets it.
-- -----------------------------------------------------------------------------
create or replace function app.now() returns timestamptz
language sql stable as $$
  select coalesce(nullif(current_setting('app.seed_clock', true), '')::timestamptz, now())
$$;

create or replace function app.today() returns date
language sql stable as $$
  select (app.now() at time zone 'Asia/Kolkata')::date
$$;

-- Structured errors. The server maps these SQLSTATEs to HTTP-style errors.
--   VF401 unauthenticated, VF403 forbidden, VF404 not found,
--   VF409 conflict / invalid state, VF422 validation
create or replace function app.fail(p_code text, p_message text) returns void
language plpgsql as $$
begin
  raise exception using errcode = p_code, message = p_message;
end $$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function app.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception using errcode = 'VF409',
    message = format('%s records are append-only and cannot be %s', tg_table_name, lower(tg_op) || 'd');
end $$;

-- -----------------------------------------------------------------------------
-- Reference data
-- -----------------------------------------------------------------------------
create table public.indian_states (
  code text primary key check (code ~ '^[0-9]{2}$'),  -- GST state code
  name text not null unique
);

create table public.geo_places (
  id serial primary key,
  kind text not null check (kind in ('city', 'pincode')),
  name text not null,
  pincode text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  state_code text not null references public.indian_states(code),
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  is_approximate boolean not null default true
);
create unique index geo_places_pincode_key on public.geo_places (pincode) where kind = 'pincode';
create index geo_places_name_idx on public.geo_places (lower(name));

create table public.platform_settings (
  key text primary key check (key ~ '^[a-z_]{3,60}$'),
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- -----------------------------------------------------------------------------
-- Identity
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '' check (char_length(full_name) <= 120),
  phone text check (phone is null or phone ~ '^\+?[0-9]{10,13}$'),
  account_type public.account_type,
  preferred_language text not null default 'en'
    check (preferred_language in ('en', 'hi', 'mr', 'gu', 'ta', 'te', 'kn', 'bn')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- Platform administrators are provisioned only by a trusted operator command
-- (scripts/grant-admin.ts) or SQL run by the database owner. No API role can
-- write this table.
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by text not null,
  note text
);

-- New auth users get a profile. Only the three public account types are
-- accepted from user metadata; anything else (e.g. "admin") is ignored.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_type text := new.raw_user_meta_data ->> 'account_type';
begin
  insert into public.profiles (id, email, full_name, phone, account_type, is_demo)
  values (
    new.id,
    lower(new.email),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    case when v_type in ('wholesaler', 'retailer', 'delivery_worker') then v_type::public.account_type end,
    coalesce((new.raw_user_meta_data ->> 'is_demo')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- -----------------------------------------------------------------------------
-- Companies and memberships
-- -----------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  kind public.company_kind not null,
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  code text not null unique check (code ~ '^[A-Z0-9]{3,6}$'),  -- short code used in document numbers
  contact_name text check (char_length(contact_name) <= 120),
  phone text check (phone is null or phone ~ '^\+?[0-9]{10,13}$'),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  logo_path text,
  preferred_language text not null default 'en',
  status public.company_status not null default 'active',
  status_reason text,
  verification_status public.verification_status not null default 'unverified',
  is_demo boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index companies_kind_status_idx on public.companies (kind, status);
create index companies_name_idx on public.companies (lower(name));
create trigger companies_touch before update on public.companies
  for each row execute function app.touch_updated_at();

create table public.business_addresses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  label text not null default 'Primary' check (char_length(label) <= 60),
  line1 text not null check (char_length(line1) between 3 and 200),
  line2 text check (char_length(line2) <= 200),
  city text not null check (char_length(city) between 2 and 80),
  state_code text not null references public.indian_states(code),
  pincode text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  is_primary boolean not null default false,
  is_delivery boolean not null default true,
  created_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);
create unique index business_addresses_one_primary on public.business_addresses (company_id) where is_primary;
create index business_addresses_company_idx on public.business_addresses (company_id);
create index business_addresses_geo_idx on public.business_addresses (latitude, longitude) where is_primary;

create table public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.membership_role not null,
  status public.membership_status not null default 'active',
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create index company_memberships_user_idx on public.company_memberships (user_id) where status = 'active';

create table public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text check (char_length(full_name) <= 120),
  role public.membership_role not null check (role <> 'owner'),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index company_invitations_company_idx on public.company_invitations (company_id);

create table public.wholesaler_profiles (
  company_id uuid primary key references public.companies(id) on delete cascade,
  business_category text not null default 'general',
  description text check (char_length(description) <= 1000),
  offers_delivery boolean not null default true,
  min_order_value numeric(14, 2) not null default 0 check (min_order_value >= 0),
  delivery_charge numeric(14, 2) not null default 0 check (delivery_charge >= 0),
  free_delivery_above numeric(14, 2) check (free_delivery_above is null or free_delivery_above >= 0),
  auto_approve_retailers boolean not null default false,
  payment_terms_days int not null default 15 check (payment_terms_days between 0 and 180),
  whatsapp_number text check (whatsapp_number is null or whatsapp_number ~ '^\+?[0-9]{10,13}$'),
  -- {"mon": ["09:00", "20:00"], ...}; a missing day means closed. Evaluated in Asia/Kolkata.
  opening_hours jsonb,
  is_listed boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger wholesaler_profiles_touch before update on public.wholesaler_profiles
  for each row execute function app.touch_updated_at();

create table public.retailer_profiles (
  company_id uuid primary key references public.companies(id) on delete cascade,
  shop_type text check (char_length(shop_type) <= 60),
  preferred_delivery_address_id uuid references public.business_addresses(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  kind text not null check (kind in ('radius', 'pincodes')),
  radius_km numeric(6, 2) check (radius_km > 0 and radius_km <= 200),
  pincodes text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((kind = 'radius' and radius_km is not null) or (kind = 'pincodes' and cardinality(pincodes) > 0))
);
create index delivery_zones_company_idx on public.delivery_zones (company_id) where is_active;

create table public.retailer_wholesaler_relationships (
  id uuid primary key default gen_random_uuid(),
  wholesaler_id uuid not null references public.companies(id) on delete cascade,
  retailer_id uuid not null references public.companies(id) on delete cascade,
  status public.relationship_status not null default 'pending',
  credit_limit numeric(14, 2) check (credit_limit is null or credit_limit >= 0),
  request_note text check (char_length(request_note) <= 500),
  decision_note text check (char_length(decision_note) <= 500),
  requested_by uuid references auth.users(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (wholesaler_id, retailer_id),
  check (wholesaler_id <> retailer_id)
);
create index rwr_retailer_idx on public.retailer_wholesaler_relationships (retailer_id, status);
create index rwr_wholesaler_idx on public.retailer_wholesaler_relationships (wholesaler_id, status);

-- Per-company document counters (orders, invoices, payments, ...). Rows are
-- locked by app.next_number() so numbers are gap-free per company and key.
create table public.company_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  counter_key text not null,
  next_value bigint not null default 1,
  primary key (company_id, counter_key)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  company_id uuid references public.companies(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_company_idx on public.audit_logs (company_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function app.forbid_mutation();

create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  source text not null check (source in ('contact_form', 'in_app')),
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or phone ~ '^\+?[0-9]{10,13}$'),
  topic text not null check (topic in ('sales', 'support', 'partnership', 'other')),
  message text not null check (char_length(message) between 10 and 4000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'closed')),
  admin_note text check (char_length(admin_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_requests_status_idx on public.support_requests (status, created_at desc);

-- -----------------------------------------------------------------------------
-- Authorization helpers. SECURITY DEFINER so policies can call them without
-- recursive RLS evaluation. Each checks auth.uid(); none trusts client input.
-- -----------------------------------------------------------------------------
create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

create or replace function app.has_company_role(p_company uuid, p_roles public.membership_role[])
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.company_memberships m
    where m.company_id = p_company and m.user_id = auth.uid()
      and m.status = 'active' and m.role = any (p_roles)
  )
$$;

-- Office staff of a company (excludes delivery workers).
create or replace function app.is_staff(p_company uuid) returns boolean
language sql stable as $$
  select app.has_company_role(p_company, array['owner', 'manager', 'staff']::public.membership_role[])
$$;

create or replace function app.can_manage(p_company uuid) returns boolean
language sql stable as $$
  select app.has_company_role(p_company, array['owner', 'manager']::public.membership_role[])
$$;

create or replace function app.is_member(p_company uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.company_memberships m
    where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active'
  )
$$;

-- Companies the current user is office staff of.
create or replace function app.my_staff_company_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.company_id from public.company_memberships m
  where m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'manager', 'staff')
$$;

-- True when the current user is staff of either side of an existing
-- relationship between the two companies (any status).
create or replace function app.is_related_party(p_company uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.retailer_wholesaler_relationships r
    where (r.retailer_id = p_company and r.wholesaler_id in (select app.my_staff_company_ids()))
       or (r.wholesaler_id = p_company and r.retailer_id in (select app.my_staff_company_ids()))
  )
$$;

-- Current user is staff of a retailer that is approved by this wholesaler.
create or replace function app.is_approved_retailer_of(p_wholesaler uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.retailer_wholesaler_relationships r
    where r.wholesaler_id = p_wholesaler and r.status = 'approved'
      and r.retailer_id in (select app.my_staff_company_ids())
  )
$$;

create or replace function app.require_user() returns uuid
language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then
    perform app.fail('VF401', 'Sign in to continue');
  end if;
  return v;
end $$;

create or replace function app.require_active_company(p_company uuid) returns public.companies
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.companies;
begin
  select * into c from public.companies where id = p_company;
  if not found then
    perform app.fail('VF404', 'Company not found');
  end if;
  if c.status <> 'active' then
    perform app.fail('VF403', format('%s is suspended on VyaporaFlow', c.name));
  end if;
  return c;
end $$;

create or replace function app.audit(p_company uuid, p_action text, p_target_type text, p_target_id text, p_details jsonb default '{}')
returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_logs (actor_id, company_id, action, target_type, target_id, details)
  values (auth.uid(), p_company, p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb))
$$;

create or replace function app.notify_company(p_company uuid, p_kind text, p_title text, p_body text, p_link text)
returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, company_id, kind, title, body, link, created_at)
  select m.user_id, p_company, p_kind, p_title, p_body, p_link, app.now()
  from public.company_memberships m
  where m.company_id = p_company and m.status = 'active' and m.role in ('owner', 'manager', 'staff')
$$;

create or replace function app.next_number(p_company uuid, p_key text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v bigint;
begin
  insert into public.company_counters as c (company_id, counter_key, next_value)
  values (p_company, p_key, 2)
  on conflict (company_id, counter_key) do update set next_value = c.next_value + 1
  returning next_value - 1 into v;
  return v;
end $$;

-- Indian financial year label for a date, e.g. 2026-10-28 -> '26-27'.
create or replace function app.fy_label(p_date date) returns text
language sql immutable as $$
  select case when extract(month from p_date) >= 4
    then to_char(p_date, 'YY') || '-' || to_char(p_date + interval '1 year', 'YY')
    else to_char(p_date - interval '1 year', 'YY') || '-' || to_char(p_date, 'YY') end
$$;

-- Great-circle distance in kilometres (haversine). Used when PostGIS is not
-- available, e.g. in the PGlite demo database. See migration 0900 for PostGIS.
create or replace function app.distance_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns numeric
language sql immutable parallel safe as $$
  select round((6371.0088 * 2 * asin(least(1, sqrt(
    power(sin(radians((lat2 - lat1)::float8) / 2), 2) +
    cos(radians(lat1::float8)) * cos(radians(lat2::float8)) *
    power(sin(radians((lng2 - lng1)::float8) / 2), 2)
  ))))::numeric, 2)
$$;
