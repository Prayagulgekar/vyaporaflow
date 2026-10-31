-- =============================================================================
-- 0700 Marketplace discovery, purchasing, support and platform administration
-- =============================================================================

-- Opening status in India Standard Time from {"mon": ["09:00","20:00"], ...}.
create or replace function app.is_open_now(p_hours jsonb) returns boolean
language sql stable as $$
  select case when p_hours is null then null else
    coalesce((
      select (localtime_ist >= (p_hours -> dow ->> 0)::time and localtime_ist < (p_hours -> dow ->> 1)::time)
      from (select lower(to_char(app.now() at time zone 'Asia/Kolkata', 'dy')) as dow,
                   (app.now() at time zone 'Asia/Kolkata')::time as localtime_ist) t
      where p_hours ? dow
    ), false) end
$$;

-- Delivery coverage for a point and/or PIN code. Search radius and delivery
-- coverage are separate: a business can be within 50 km and still not deliver.
--   available           inside an active radius zone or listed PIN code
--   needs_confirmation  no zones configured, or just outside a radius zone (<= 125%)
--   outside             outside all zones
--   pickup_only         the business does not offer delivery
create or replace function app.delivery_coverage(p_company uuid, p_lat numeric, p_lng numeric, p_pincode text)
returns text
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare
  v_offers boolean;
  v_lat numeric; v_lng numeric;
  z public.delivery_zones;
  v_dist numeric;
  v_near boolean := false;
  v_any boolean := false;
begin
  select offers_delivery into v_offers from public.wholesaler_profiles where company_id = p_company;
  if not coalesce(v_offers, false) then
    return 'pickup_only';
  end if;
  select latitude, longitude into v_lat, v_lng from public.business_addresses where company_id = p_company and is_primary;
  for z in select * from public.delivery_zones where company_id = p_company and is_active loop
    v_any := true;
    if z.kind = 'pincodes' and p_pincode is not null and p_pincode = any (z.pincodes) then
      return 'available';
    end if;
    if z.kind = 'radius' and p_lat is not null and v_lat is not null then
      v_dist := app.distance_km(v_lat, v_lng, p_lat, p_lng);
      if v_dist <= z.radius_km then
        return 'available';
      elsif v_dist <= z.radius_km * 1.25 then
        v_near := true;
      end if;
    end if;
  end loop;
  if not v_any or v_near then
    return 'needs_confirmation';
  end if;
  return 'outside';
end $$;

-- Candidate wholesalers near a point: indexed prefilter, refined by the exact
-- distance in app.search_wholesalers. This default uses a bounding box on
-- (latitude, longitude). Migration 1000 replaces it with a PostGIS ST_DWithin
-- query on a GiST-indexed geography column when PostGIS is installed.
create or replace function app.candidate_wholesalers(p_lat numeric, p_lng numeric, p_radius_km numeric)
returns setof uuid
language sql stable security definer set search_path = public, app, pg_temp as $$
  select a.company_id from public.business_addresses a
   where a.is_primary
     and a.latitude between p_lat - p_radius_km / 111.0 and p_lat + p_radius_km / 111.0
     and a.longitude between p_lng - p_radius_km / (111.0 * greatest(cos(radians(p_lat::float8)), 0.01))
                         and p_lng + p_radius_km / (111.0 * greatest(cos(radians(p_lat::float8)), 0.01))
$$;

-- -----------------------------------------------------------------------------
-- Wholesaler discovery. Returns only public business information. The
-- searcher's coordinates are used for the calculation and are not stored.
-- Ranking is explainable: text relevance, then delivery coverage, then distance.
-- -----------------------------------------------------------------------------
create or replace function app.search_wholesalers(p_lat numeric, p_lng numeric, p_radius_km numeric,
  p_query text default null, p_category text default null, p_pincode text default null,
  p_limit int default 20, p_offset int default 0)
returns table (
  company_id uuid, slug text, name text, logo_path text, city text, state_code text, pincode text,
  latitude numeric, longitude numeric, distance_km numeric, business_category text, categories text[],
  product_count int, matching_products int, offers_delivery boolean, coverage text,
  min_order_value numeric, delivery_charge numeric, free_delivery_above numeric,
  is_open boolean, verification_status public.verification_status, name_match boolean, total_count int)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare
  v_q text := nullif(trim(p_query), '');
  v_pattern text;
  v_radius numeric := least(greatest(coalesce(p_radius_km, 50), 1), 100);
begin
  if p_lat is null or p_lng is null then
    perform app.fail('VF422', 'Choose a location to search near');
  end if;
  v_pattern := '%' || replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  with base as (
    select c.id, c.slug, c.name, c.logo_path, a.city, a.state_code, a.pincode, a.latitude, a.longitude,
           app.distance_km(a.latitude, a.longitude, p_lat, p_lng) as dist,
           wp.business_category, wp.offers_delivery, wp.min_order_value, wp.delivery_charge, wp.free_delivery_above,
           wp.opening_hours, c.verification_status
      from public.companies c
      join public.wholesaler_profiles wp on wp.company_id = c.id and wp.is_listed
      join public.business_addresses a on a.company_id = c.id and a.is_primary and a.latitude is not null
     where c.kind = 'wholesaler' and c.status = 'active'
       and c.id in (select app.candidate_wholesalers(p_lat, p_lng, v_radius))
  ), scored as (
    select b.*,
      (select array_agg(distinct pc.name order by pc.name)
         from public.products p join public.product_categories pc on pc.id = p.category_id
        where p.company_id = b.id and p.archived_at is null) as cats,
      (select count(*)::int from public.products p where p.company_id = b.id and p.archived_at is null) as pcount,
      (select count(*)::int from public.products p
         left join public.brands br on br.id = p.brand_id
         left join public.product_categories pc on pc.id = p.category_id
        where p.company_id = b.id and p.archived_at is null and v_q is not null
          and (p.name ilike v_pattern or br.name ilike v_pattern or pc.name ilike v_pattern)) as pmatch,
      (v_q is not null and b.name ilike v_pattern) as nmatch,
      (p_category is null or exists (
         select 1 from public.products p join public.product_categories pc on pc.id = p.category_id
          where p.company_id = b.id and p.archived_at is null and pc.slug = p_category)) as cat_ok,
      app.delivery_coverage(b.id, p_lat, p_lng, p_pincode) as cov
    from base b where b.dist <= v_radius
  ), filtered as (
    select s.* from scored s where s.cat_ok and (v_q is null or s.nmatch or s.pmatch > 0)
  )
  select f.id, f.slug, f.name, f.logo_path, f.city, f.state_code, f.pincode, f.latitude, f.longitude, f.dist,
         f.business_category, coalesce(f.cats, '{}'), f.pcount, f.pmatch, f.offers_delivery, f.cov,
         f.min_order_value, f.delivery_charge, f.free_delivery_above, app.is_open_now(f.opening_hours),
         f.verification_status, f.nmatch, (count(*) over ())::int
    from filtered f
   order by (case when f.nmatch then 0 when f.pmatch > 0 then 1 else 2 end),
            (case f.cov when 'available' then 0 when 'needs_confirmation' then 1 when 'pickup_only' then 2 else 3 end),
            f.dist, f.name
   limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
end $$;

-- Public business profile and catalog. Prices are included only for staff of
-- the wholesaler and for approved retailers.
create or replace function app.wholesaler_public(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare
  c public.companies;
  v_can_price boolean;
  v_result jsonb;
begin
  select * into c from public.companies where slug = p_slug and kind = 'wholesaler' and status = 'active';
  if not found or not exists (select 1 from public.wholesaler_profiles where company_id = c.id and is_listed) then
    return null;
  end if;
  v_can_price := auth.uid() is not null and (app.is_staff(c.id) or app.is_approved_retailer_of(c.id));
  select jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'name', c.name, 'logo_path', c.logo_path, 'phone', c.phone,
    'verification_status', c.verification_status, 'gstin_registered', c.gstin is not null,
    'profile', (select to_jsonb(wp) - 'company_id' - 'updated_at' - 'auto_approve_retailers' from public.wholesaler_profiles wp where wp.company_id = c.id),
    'is_open', (select app.is_open_now(opening_hours) from public.wholesaler_profiles where company_id = c.id),
    'address', (select jsonb_build_object('city', a.city, 'state_code', a.state_code, 'pincode', a.pincode,
                                          'latitude', a.latitude, 'longitude', a.longitude, 'line1', a.line1)
                  from public.business_addresses a where a.company_id = c.id and a.is_primary),
    'zones', coalesce((select jsonb_agg(jsonb_build_object('name', z.name, 'kind', z.kind, 'radius_km', z.radius_km, 'pincodes', z.pincodes))
                         from public.delivery_zones z where z.company_id = c.id and z.is_active), '[]'),
    'can_view_prices', v_can_price,
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'description', p.description, 'image_path', p.image_path,
        'category', pc.name, 'category_slug', pc.slug, 'brand', br.name,
        'variants', (select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name,
            'units', (select jsonb_agg(jsonb_build_object(
                'id', vu.id, 'unit_code', vu.unit_code, 'factor_to_base', vu.factor_to_base, 'base_unit', v.base_unit,
                'min_order_qty', vu.min_order_qty,
                'price', case when v_can_price then vu.price end,
                'mrp', vu.mrp) order by vu.factor_to_base)
              from public.variant_units vu where vu.variant_id = v.id and vu.is_active)) order by v.name)
          from public.product_variants v where v.product_id = p.id and v.is_active)
      ) order by pc.name, p.name)
      from public.products p
      join public.product_categories pc on pc.id = p.category_id
      left join public.brands br on br.id = p.brand_id
      where p.company_id = c.id and p.archived_at is null), '[]')
  ) into v_result;
  return v_result;
end $$;

-- -----------------------------------------------------------------------------
-- Purchasing
-- p_items: [{"variant_id", "quantity" (base units), "unit_cost"}]
-- -----------------------------------------------------------------------------
create or replace function app.create_purchase_order(p_company uuid, p_supplier uuid, p_items jsonb,
  p_expected date, p_notes text) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_po uuid; it jsonb; v_total numeric := 0;
begin
  perform app.require_user();
  if not app.can_manage(p_company) then
    perform app.fail('VF403', 'Only owners and managers can raise purchase orders');
  end if;
  perform app.require_active_company(p_company);
  if not exists (select 1 from public.suppliers where id = p_supplier and company_id = p_company and archived_at is null) then
    perform app.fail('VF422', 'Choose one of your suppliers');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform app.fail('VF422', 'Add at least one item');
  end if;
  insert into public.purchase_orders (company_id, po_number, supplier_id, expected_on, notes, created_by, created_at)
  values (p_company, 'PO-' || lpad(app.next_number(p_company, 'purchase_order')::text, 5, '0'), p_supplier, p_expected,
          left(p_notes, 500), auth.uid(), app.now())
  returning id into v_po;
  for it in select * from jsonb_array_elements(p_items) loop
    if not exists (select 1 from public.product_variants where id = (it ->> 'variant_id')::uuid and company_id = p_company) then
      perform app.fail('VF422', 'A purchase order item is not one of your products');
    end if;
    insert into public.purchase_order_items (purchase_order_id, company_id, variant_id, quantity, unit_cost)
    values (v_po, p_company, (it ->> 'variant_id')::uuid, (it ->> 'quantity')::numeric, (it ->> 'unit_cost')::numeric);
    v_total := v_total + round((it ->> 'quantity')::numeric * (it ->> 'unit_cost')::numeric, 2);
  end loop;
  update public.purchase_orders set total_cost = v_total where id = v_po;
  perform app.audit(p_company, 'purchase_order.created', 'purchase_order', v_po::text, jsonb_build_object('total', v_total));
  return v_po;
end $$;

-- Goods received against a purchase order: increases stock.
-- p_items: [{"purchase_order_item_id", "quantity", "batch_no", "expiry_date"}]
create or replace function app.receive_goods(p_po uuid, p_items jsonb, p_note text) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  po public.purchase_orders;
  v_receipt uuid;
  it jsonb;
  poi public.purchase_order_items;
  v_qty numeric;
  v_batch uuid;
begin
  perform app.require_user();
  select * into po from public.purchase_orders where id = p_po for update;
  if not found or not app.is_staff(po.company_id) then
    perform app.fail('VF403', 'You cannot receive goods for this purchase order');
  end if;
  if po.status in ('received', 'cancelled') then
    perform app.fail('VF409', 'This purchase order is closed');
  end if;
  insert into public.goods_receipts (company_id, purchase_order_id, received_at, received_by, note)
  values (po.company_id, p_po, app.now(), auth.uid(), left(p_note, 500)) returning id into v_receipt;
  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it ->> 'quantity')::numeric;
    continue when coalesce(v_qty, 0) = 0;
    select * into poi from public.purchase_order_items
     where id = (it ->> 'purchase_order_item_id')::uuid and purchase_order_id = p_po for update;
    if not found then
      perform app.fail('VF422', 'Unknown purchase order line');
    end if;
    if v_qty < 0 or poi.received_quantity + v_qty > poi.quantity then
      perform app.fail('VF422', 'Received quantity cannot exceed the ordered quantity');
    end if;
    v_batch := null;
    if nullif(trim(it ->> 'batch_no'), '') is not null then
      insert into public.product_batches (company_id, variant_id, batch_no, expiry_date, quantity_received)
      values (po.company_id, poi.variant_id, trim(it ->> 'batch_no'), nullif(it ->> 'expiry_date', '')::date, v_qty)
      on conflict (variant_id, batch_no) do update set quantity_received = public.product_batches.quantity_received + excluded.quantity_received
      returning id into v_batch;
    end if;
    update public.purchase_order_items set received_quantity = received_quantity + v_qty where id = poi.id;
    insert into public.goods_receipt_items (receipt_id, purchase_order_item_id, quantity, batch_id)
    values (v_receipt, poi.id, v_qty, v_batch);
    perform app.apply_stock_change(po.company_id, app.default_location(po.company_id), poi.variant_id, 'purchase_receipt',
      v_qty, 0, 'purchase_order', p_po, 'Goods received ' || po.po_number, v_batch);
  end loop;
  update public.purchase_orders
     set status = case when not exists (select 1 from public.purchase_order_items where purchase_order_id = p_po and received_quantity < quantity)
                       then 'received' else 'partially_received' end
   where id = p_po;
  return v_receipt;
end $$;

-- -----------------------------------------------------------------------------
-- Support and contact (anonymous allowed; validated by table constraints)
-- -----------------------------------------------------------------------------
create or replace function app.submit_support_request(p_name text, p_email text, p_phone text, p_topic text,
  p_message text, p_source text) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid;
begin
  if p_source not in ('contact_form', 'in_app') then
    perform app.fail('VF422', 'Unknown source');
  end if;
  insert into public.support_requests (user_id, company_id, source, name, email, phone, topic, message, created_at, updated_at)
  values (auth.uid(),
          (select company_id from public.company_memberships where user_id = auth.uid() and status = 'active' order by created_at limit 1),
          p_source, trim(p_name), lower(trim(p_email)), nullif(p_phone, ''), p_topic, trim(p_message), app.now(), app.now())
  returning id into v_id;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Platform administration. Each function checks platform_admins and audits.
-- -----------------------------------------------------------------------------
create or replace function app.require_admin() returns uuid
language plpgsql stable as $$
declare v uuid := app.require_user();
begin
  if not app.is_platform_admin() then
    perform app.fail('VF403', 'Platform administrator access is required');
  end if;
  return v;
end $$;

create or replace function app.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_admin();
  return jsonb_build_object(
    'wholesalers', (select count(*) from public.companies where kind = 'wholesaler'),
    'retailers', (select count(*) from public.companies where kind = 'retailer'),
    'suspended', (select count(*) from public.companies where status = 'suspended'),
    'pending_verification', (select count(*) from public.companies where verification_status = 'pending'),
    'users', (select count(*) from public.profiles),
    'orders_30d', (select count(*) from public.orders where placed_at >= app.now() - interval '30 days'),
    'open_support', (select count(*) from public.support_requests where status <> 'closed'),
    'relationships_pending', (select count(*) from public.retailer_wholesaler_relationships where status = 'pending'));
end $$;

create or replace function app.admin_list_users(p_query text, p_limit int, p_offset int)
returns table (id uuid, email text, full_name text, account_type public.account_type, is_admin boolean,
  companies text, created_at timestamptz, total_count int)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_admin();
  return query
  select p.id, p.email, p.full_name, p.account_type, exists (select 1 from public.platform_admins a where a.user_id = p.id),
         (select string_agg(c.name || ' (' || m.role::text || ')', ', ') from public.company_memberships m
            join public.companies c on c.id = m.company_id where m.user_id = p.id and m.status = 'active'),
         p.created_at, (count(*) over ())::int
    from public.profiles p
   where nullif(trim(p_query), '') is null or p.email ilike '%' || trim(p_query) || '%' or p.full_name ilike '%' || trim(p_query) || '%'
   order by p.created_at desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

create or replace function app.admin_set_company_status(p_company uuid, p_status public.company_status, p_reason text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_admin();
  if p_status = 'suspended' and nullif(trim(p_reason), '') is null then
    perform app.fail('VF422', 'Give a reason for the suspension');
  end if;
  update public.companies set status = p_status, status_reason = left(p_reason, 500) where id = p_company;
  if not found then perform app.fail('VF404', 'Company not found'); end if;
  perform app.audit(p_company, 'admin.company_' || p_status::text, 'company', p_company::text, jsonb_build_object('reason', p_reason));
end $$;

create or replace function app.admin_set_verification(p_company uuid, p_status public.verification_status, p_note text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_admin();
  update public.companies set verification_status = p_status where id = p_company;
  if not found then perform app.fail('VF404', 'Company not found'); end if;
  perform app.audit(p_company, 'admin.verification_' || p_status::text, 'company', p_company::text, jsonb_build_object('note', p_note));
end $$;

create or replace function app.admin_update_support(p_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_admin();
  update public.support_requests set status = p_status, admin_note = left(p_note, 2000), updated_at = app.now() where id = p_id;
  if not found then perform app.fail('VF404', 'Request not found'); end if;
  perform app.audit(null, 'admin.support_updated', 'support_request', p_id::text, jsonb_build_object('status', p_status));
end $$;

create or replace function app.admin_set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_admin();
  update public.platform_settings set value = p_value, updated_at = app.now(), updated_by = auth.uid() where key = p_key;
  if not found then perform app.fail('VF404', 'Unknown setting'); end if;
  perform app.audit(null, 'admin.setting_changed', 'platform_setting', p_key, jsonb_build_object('value', p_value));
end $$;

-- Requesting verification is a company action; deciding is an admin action.
create or replace function app.request_verification(p_company uuid) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  perform app.require_user();
  if not app.can_manage(p_company) then
    perform app.fail('VF403', 'Only owners and managers can request verification');
  end if;
  update public.companies set verification_status = 'pending'
   where id = p_company and verification_status in ('unverified', 'rejected');
end $$;
