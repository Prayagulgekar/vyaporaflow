-- =============================================================================
-- 0500 Pricing, order placement and the order lifecycle
-- =============================================================================

-- Line pricing. Mirrors src/domain/pricing.ts (kept in sync by tests).
--   line_amount     = round(qty * unit_price, 2)
--   discount_amount = round(line_amount * discount% / 100, 2)
--   net             = line_amount - discount_amount
--   tax-exclusive:  taxable = net;                             tax = round(net * rate / 100, 2)
--   tax-inclusive:  taxable = round(net * 100 / (100 + rate), 2); tax = net - taxable
-- round() on NUMERIC rounds half away from zero.
create or replace function app.calc_line(p_qty numeric, p_unit_price numeric, p_discount_pct numeric,
  p_tax_rate numeric, p_inclusive boolean,
  out line_amount numeric, out discount_amount numeric, out taxable_amount numeric,
  out tax_amount numeric, out line_total numeric)
language plpgsql immutable as $$
declare v_net numeric;
begin
  line_amount := round(p_qty * p_unit_price, 2);
  discount_amount := round(line_amount * p_discount_pct / 100, 2);
  v_net := line_amount - discount_amount;
  if p_inclusive then
    taxable_amount := round(v_net * 100 / (100 + p_tax_rate), 2);
    tax_amount := v_net - taxable_amount;
  else
    taxable_amount := v_net;
    tax_amount := round(v_net * p_tax_rate / 100, 2);
  end if;
  line_total := taxable_amount + tax_amount;
end $$;

create or replace function app.order_transition_allowed(p_from public.order_status, p_to public.order_status)
returns boolean
language sql immutable as $$
  select (p_from::text || '>' || p_to::text) = any (array[
    'placed>accepted', 'placed>cancelled',
    'accepted>preparing', 'accepted>cancelled',
    'preparing>ready_for_delivery', 'preparing>cancelled',
    'ready_for_delivery>out_for_delivery', 'ready_for_delivery>cancelled',
    'out_for_delivery>delivered',
    'out_for_delivery>ready_for_delivery'  -- failed delivery attempt only
  ])
$$;

-- -----------------------------------------------------------------------------
-- Quote: authoritative server-side pricing and validation of a basket.
-- p_items: [{"variant_unit_id": uuid, "quantity": number}]
-- Reads current prices, MOQs and stock. Returns lines, totals and errors.
-- Internal (no authorization); callers authorize first.
-- -----------------------------------------------------------------------------
create or replace function app._quote(p_wholesaler uuid, p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare
  it record;
  v_lines jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_issues jsonb;
  v_calc record;
  v_qty numeric;
  v_location uuid := app.default_location(p_wholesaler);
  v_wp public.wholesaler_profiles;
  v_subtotal numeric := 0; v_discount numeric := 0; v_taxable numeric := 0; v_tax numeric := 0;
  v_items_total numeric; v_delivery numeric := 0;
  v_line_no int := 0;
  v_need record;
begin
  select * into v_wp from public.wholesaler_profiles where company_id = p_wholesaler;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('lines', '[]'::jsonb, 'errors', jsonb_build_array('Add at least one product'),
      'subtotal', 0, 'discount_total', 0, 'taxable_total', 0, 'tax_total', 0, 'items_total', 0,
      'delivery_charge', 0, 'grand_total', 0, 'min_order_value', coalesce(v_wp.min_order_value, 0));
  end if;
  if jsonb_array_length(p_items) > 200 then
    perform app.fail('VF422', 'An order can contain at most 200 lines');
  end if;
  if (select count(*) from jsonb_array_elements(p_items) e) <>
     (select count(distinct e ->> 'variant_unit_id') from jsonb_array_elements(p_items) e) then
    perform app.fail('VF422', 'Each product pack size can appear only once in an order');
  end if;

  for it in
    select (e ->> 'variant_unit_id')::uuid as vu_id, (e ->> 'quantity')::numeric as qty,
           vu.id as found_id, vu.company_id, vu.unit_code, vu.factor_to_base, vu.price, vu.discount_percent,
           vu.min_order_qty, vu.qty_step, vu.is_active as unit_active,
           v.id as variant_id, v.name as variant_name, v.sku, v.base_unit, v.is_active as variant_active,
           p.id as product_id, p.name as product_name, p.hsn_code, p.price_includes_tax, p.archived_at,
           tc.rate as tax_rate, u.allows_fraction, u.name as unit_name
      from jsonb_array_elements(p_items) with ordinality as e(e, ord)
      left join public.variant_units vu on vu.id = (e ->> 'variant_unit_id')::uuid
      left join public.product_variants v on v.id = vu.variant_id
      left join public.products p on p.id = v.product_id
      left join public.tax_classes tc on tc.id = p.tax_class_id
      left join public.units_of_measure u on u.code = vu.unit_code
     order by ord
  loop
    v_issues := '[]'::jsonb;
    v_qty := it.qty;
    if it.found_id is null or it.company_id <> p_wholesaler then
      v_errors := v_errors || to_jsonb('A product in the cart is not sold by this wholesaler'::text);
      continue;
    end if;
    if not it.unit_active or not it.variant_active or it.archived_at is not null then
      v_issues := v_issues || to_jsonb(format('%s is no longer available', it.product_name));
    end if;
    if v_qty is null or v_qty <= 0 then
      v_issues := v_issues || to_jsonb('Quantity must be greater than zero'::text);
      v_qty := 0;
    else
      if not it.allows_fraction and v_qty <> trunc(v_qty) then
        v_issues := v_issues || to_jsonb(format('Order whole %s', it.unit_name));
      end if;
      if v_qty < it.min_order_qty then
        v_issues := v_issues || to_jsonb(format('Minimum order is %s %s', trim(trailing '.' from trim(trailing '0' from it.min_order_qty::text)), it.unit_code));
      end if;
      if mod(v_qty, it.qty_step) <> 0 then
        v_issues := v_issues || to_jsonb(format('Order in multiples of %s', trim(trailing '.' from trim(trailing '0' from it.qty_step::text))));
      end if;
    end if;

    v_line_no := v_line_no + 1;
    select * into v_calc from app.calc_line(v_qty, it.price, it.discount_percent, it.tax_rate, it.price_includes_tax);
    v_lines := v_lines || jsonb_build_object(
      'line_no', v_line_no, 'variant_unit_id', it.vu_id, 'product_id', it.product_id, 'variant_id', it.variant_id,
      'product_name', it.product_name, 'variant_name', it.variant_name, 'sku', it.sku, 'hsn_code', it.hsn_code,
      'unit_code', it.unit_code, 'unit_factor', it.factor_to_base, 'base_unit', it.base_unit,
      'quantity', v_qty, 'base_quantity', v_qty * it.factor_to_base,
      'unit_price', it.price, 'price_includes_tax', it.price_includes_tax, 'discount_percent', it.discount_percent,
      'line_amount', v_calc.line_amount, 'discount_amount', v_calc.discount_amount,
      'taxable_amount', v_calc.taxable_amount, 'tax_rate', it.tax_rate, 'tax_amount', v_calc.tax_amount,
      'line_total', v_calc.line_total, 'issues', v_issues);
    v_subtotal := v_subtotal + v_calc.line_amount;
    v_discount := v_discount + v_calc.discount_amount;
    v_taxable := v_taxable + v_calc.taxable_amount;
    v_tax := v_tax + v_calc.tax_amount;
    if jsonb_array_length(v_issues) > 0 then
      v_errors := v_errors || v_issues;
    end if;
  end loop;

  -- Stock check aggregated per variant (several pack sizes may share stock).
  for v_need in
    select (l ->> 'variant_id')::uuid as variant_id, min(l ->> 'product_name') as product_name,
           min(l ->> 'variant_name') as variant_name, min(l ->> 'base_unit') as base_unit,
           sum((l ->> 'base_quantity')::numeric) as needed
      from jsonb_array_elements(v_lines) l group by 1
  loop
    if coalesce((select available from public.inventory_balances
                  where location_id = v_location and variant_id = v_need.variant_id), 0) < v_need.needed then
      v_errors := v_errors || to_jsonb(format('Not enough stock for %s %s', v_need.product_name, v_need.variant_name));
      v_lines := (select jsonb_agg(case when (l ->> 'variant_id')::uuid = v_need.variant_id
                                        then jsonb_set(l, '{issues}', (l -> 'issues') || to_jsonb('Not enough stock'::text))
                                        else l end order by (l ->> 'line_no')::int)
                    from jsonb_array_elements(v_lines) l);
    end if;
  end loop;

  v_items_total := v_taxable + v_tax;
  if coalesce(v_wp.offers_delivery, false) then
    v_delivery := case when v_wp.free_delivery_above is not null and v_items_total >= v_wp.free_delivery_above
                       then 0 else coalesce(v_wp.delivery_charge, 0) end;
  end if;
  if v_items_total < coalesce(v_wp.min_order_value, 0) then
    v_errors := v_errors || to_jsonb(format('Minimum order value is Rs %s', v_wp.min_order_value));
  end if;

  return jsonb_build_object('lines', v_lines, 'errors', v_errors,
    'subtotal', v_subtotal, 'discount_total', v_discount, 'taxable_total', v_taxable, 'tax_total', v_tax,
    'items_total', v_items_total, 'delivery_charge', v_delivery, 'grand_total', v_items_total + v_delivery,
    'min_order_value', coalesce(v_wp.min_order_value, 0));
end $$;

create or replace function app.assert_can_order(p_retailer uuid, p_wholesaler uuid) returns void
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_r public.companies; v_w public.companies;
begin
  perform app.require_user();
  if not app.is_staff(p_retailer) then
    perform app.fail('VF403', 'You are not a member of this retailer');
  end if;
  v_r := app.require_active_company(p_retailer);
  v_w := app.require_active_company(p_wholesaler);
  if v_r.kind <> 'retailer' or v_w.kind <> 'wholesaler' then
    perform app.fail('VF422', 'Orders are placed by a retailer with a wholesaler');
  end if;
  if not exists (select 1 from public.retailer_wholesaler_relationships
                  where retailer_id = p_retailer and wholesaler_id = p_wholesaler and status = 'approved') then
    perform app.fail('VF403', format('%s has not approved your shop yet', v_w.name));
  end if;
end $$;

create or replace function app.quote_order(p_retailer uuid, p_wholesaler uuid, p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.assert_can_order(p_retailer, p_wholesaler);
  return app._quote(p_wholesaler, p_items);
end $$;

-- -----------------------------------------------------------------------------
-- Place an order. Idempotent per (retailer, idempotency_key): a retry with the
-- same key returns the original order and reserves nothing twice.
-- Stock rows are locked (FOR UPDATE, in a fixed order to avoid deadlocks)
-- before availability is checked, so concurrent orders cannot oversell.
-- -----------------------------------------------------------------------------
create or replace function app.place_order(p_retailer uuid, p_wholesaler uuid, p_items jsonb,
  p_idempotency_key text, p_notes text default null, p_address uuid default null)
returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_uid uuid := app.require_user();
  v_existing uuid;
  v_quote jsonb;
  v_order uuid;
  v_addr public.business_addresses;
  v_code text;
  v_location uuid;
  l jsonb;
begin
  perform app.assert_can_order(p_retailer, p_wholesaler);
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    perform app.fail('VF422', 'A valid idempotency key is required');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('order:' || p_retailer::text || ':' || p_idempotency_key, 0));
  select id into v_existing from public.orders where retailer_id = p_retailer and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_address is not null then
    select * into v_addr from public.business_addresses where id = p_address and company_id = p_retailer;
    if not found then
      perform app.fail('VF422', 'Choose one of your shop addresses');
    end if;
  else
    select a.* into v_addr from public.business_addresses a
      left join public.retailer_profiles rp on rp.company_id = a.company_id
     where a.company_id = p_retailer
     order by (a.id = rp.preferred_delivery_address_id) desc nulls last, a.is_primary desc
     limit 1;
    if not found then
      perform app.fail('VF422', 'Add a delivery address to your shop profile first');
    end if;
  end if;

  v_location := app.default_location(p_wholesaler);
  perform 1 from public.inventory_balances
   where location_id = v_location
     and variant_id in (select vu.variant_id from public.variant_units vu
                         where vu.id in (select (e ->> 'variant_unit_id')::uuid from jsonb_array_elements(p_items) e))
   order by variant_id
   for update;

  v_quote := app._quote(p_wholesaler, p_items);
  if jsonb_array_length(v_quote -> 'errors') > 0 then
    perform app.fail('VF422', (select string_agg(x, '; ') from jsonb_array_elements_text(v_quote -> 'errors') x));
  end if;

  select code into v_code from public.companies where id = p_wholesaler;
  insert into public.orders (order_number, wholesaler_id, retailer_id, placed_by, status, delivery_address, place_of_supply,
    items_count, subtotal, discount_total, taxable_total, tax_total, delivery_charge, grand_total, notes, idempotency_key, placed_at)
  values (v_code || '-' || lpad(app.next_number(p_wholesaler, 'order')::text, 5, '0'), p_wholesaler, p_retailer, v_uid, 'placed',
    jsonb_build_object('label', v_addr.label, 'line1', v_addr.line1, 'line2', v_addr.line2, 'city', v_addr.city,
                       'state_code', v_addr.state_code, 'pincode', v_addr.pincode),
    v_addr.state_code, jsonb_array_length(v_quote -> 'lines'),
    (v_quote ->> 'subtotal')::numeric, (v_quote ->> 'discount_total')::numeric, (v_quote ->> 'taxable_total')::numeric,
    (v_quote ->> 'tax_total')::numeric, (v_quote ->> 'delivery_charge')::numeric, (v_quote ->> 'grand_total')::numeric,
    left(p_notes, 1000), p_idempotency_key, app.now())
  returning id into v_order;

  for l in select * from jsonb_array_elements(v_quote -> 'lines') loop
    insert into public.order_items (order_id, wholesaler_id, line_no, product_id, variant_id, variant_unit_id,
      product_name, variant_name, sku, hsn_code, unit_code, unit_factor, base_unit, quantity, base_quantity,
      unit_price, price_includes_tax, discount_percent, line_amount, discount_amount, taxable_amount,
      tax_rate, tax_amount, line_total)
    values (v_order, p_wholesaler, (l ->> 'line_no')::int, (l ->> 'product_id')::uuid, (l ->> 'variant_id')::uuid,
      (l ->> 'variant_unit_id')::uuid, l ->> 'product_name', l ->> 'variant_name', l ->> 'sku', l ->> 'hsn_code',
      l ->> 'unit_code', (l ->> 'unit_factor')::numeric, l ->> 'base_unit', (l ->> 'quantity')::numeric,
      (l ->> 'base_quantity')::numeric, (l ->> 'unit_price')::numeric, (l ->> 'price_includes_tax')::boolean,
      (l ->> 'discount_percent')::numeric, (l ->> 'line_amount')::numeric, (l ->> 'discount_amount')::numeric,
      (l ->> 'taxable_amount')::numeric, (l ->> 'tax_rate')::numeric, (l ->> 'tax_amount')::numeric,
      (l ->> 'line_total')::numeric);
    perform app.apply_stock_change(p_wholesaler, v_location, (l ->> 'variant_id')::uuid, 'reservation',
      0, (l ->> 'base_quantity')::numeric, 'order', v_order, null);
  end loop;

  insert into public.order_events (order_id, event_type, to_status, actor_id, created_at, note)
  values (v_order, 'placed', 'placed', v_uid, app.now(), left(p_notes, 1000));

  delete from public.cart_items
   where retailer_id = p_retailer and wholesaler_id = p_wholesaler
     and variant_unit_id in (select (e ->> 'variant_unit_id')::uuid from jsonb_array_elements(p_items) e);

  perform app.notify_company(p_wholesaler, 'order.placed',
    format('New order from %s', (select name from public.companies where id = p_retailer)),
    format('Order total Rs %s', v_quote ->> 'grand_total'), '/w/orders/' || v_order);
  return v_order;
end $$;

-- -----------------------------------------------------------------------------
-- Apply an order status change and its stock effects (internal, no auth).
-- -----------------------------------------------------------------------------
create or replace function app._apply_order_transition(p_order uuid, p_to public.order_status, p_note text)
returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  o public.orders;
  it public.order_items;
  v_location uuid;
begin
  select * into o from public.orders where id = p_order for update;
  if not app.order_transition_allowed(o.status, p_to) then
    perform app.fail('VF409', format('An order that is %s cannot be moved to %s',
      replace(o.status::text, '_', ' '), replace(p_to::text, '_', ' ')));
  end if;
  v_location := app.default_location(o.wholesaler_id);

  if p_to = 'cancelled' then
    if exists (select 1 from public.invoices where order_id = p_order and status = 'issued') then
      perform app.fail('VF409', 'Void the invoice for this order before cancelling it');
    end if;
    for it in select * from public.order_items where order_id = p_order order by variant_id loop
      perform app.apply_stock_change(o.wholesaler_id, v_location, it.variant_id, 'reservation_release',
        0, -it.base_quantity, 'order', p_order, 'Order cancelled');
    end loop;
    update public.deliveries set status = 'cancelled', updated_at = app.now()
     where order_id = p_order and status in ('assigned', 'failed');
    update public.delivery_assignments set ended_at = app.now()
     where ended_at is null and delivery_id in (select id from public.deliveries where order_id = p_order);
    update public.orders set status = 'cancelled', cancelled_at = app.now(), cancel_reason = left(p_note, 500) where id = p_order;
  elsif p_to = 'out_for_delivery' then
    for it in select * from public.order_items where order_id = p_order order by variant_id loop
      perform app.apply_stock_change(o.wholesaler_id, v_location, it.variant_id, 'sale_dispatch',
        -it.base_quantity, -it.base_quantity, 'order', p_order, 'Dispatched');
    end loop;
    update public.orders set status = p_to, dispatched_at = app.now() where id = p_order;
  elsif p_to = 'ready_for_delivery' and o.status = 'out_for_delivery' then
    -- Failed delivery: goods come back to the godown and stay reserved.
    for it in select * from public.order_items where order_id = p_order order by variant_id loop
      perform app.apply_stock_change(o.wholesaler_id, v_location, it.variant_id, 'delivery_return',
        it.base_quantity, it.base_quantity, 'order', p_order, 'Returned after failed delivery');
    end loop;
    update public.orders set status = p_to, dispatched_at = null where id = p_order;
  elsif p_to = 'delivered' then
    update public.order_items set delivered_quantity = quantity where order_id = p_order and delivered_quantity is null;
    update public.orders set status = p_to, delivered_at = app.now() where id = p_order;
  else
    update public.orders set status = p_to,
      accepted_at = case when p_to = 'accepted' then app.now() else accepted_at end
     where id = p_order;
  end if;

  insert into public.order_events (order_id, event_type, from_status, to_status, note, actor_id, created_at)
  values (p_order, 'status_changed', o.status, p_to, left(p_note, 1000), auth.uid(), app.now());

  perform app.notify_company(o.retailer_id, 'order.' || p_to::text,
    format('Order %s is %s', o.order_number, replace(p_to::text, '_', ' ')), null, '/r/orders/' || p_order);
end $$;

-- Public entry point for status changes by wholesaler staff or the retailer.
create or replace function app.transition_order(p_order uuid, p_to public.order_status, p_note text default null)
returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  o public.orders;
begin
  perform app.require_user();
  select * into o from public.orders where id = p_order for update;
  if not found then
    perform app.fail('VF404', 'Order not found');
  end if;

  if app.is_staff(o.wholesaler_id) then
    perform app.require_active_company(o.wholesaler_id);
    if o.status = 'out_for_delivery' and p_to = 'ready_for_delivery' then
      perform app.fail('VF409', 'Record a failed delivery from the delivery screen instead');
    end if;
    if p_to in ('out_for_delivery', 'delivered') and exists (
      select 1 from public.deliveries where order_id = p_order and status not in ('cancelled')) then
      perform app.fail('VF409', 'This order has a delivery assignment; update it from the delivery screen');
    end if;
  elsif app.is_staff(o.retailer_id) then
    if not (p_to = 'cancelled' and o.status = 'placed') then
      perform app.fail('VF403', 'Retailers can only cancel orders that have not been accepted yet');
    end if;
  else
    perform app.fail('VF403', 'You do not have access to this order');
  end if;

  perform app._apply_order_transition(p_order, p_to, p_note);
end $$;

-- -----------------------------------------------------------------------------
-- Deliveries
-- -----------------------------------------------------------------------------
create or replace function app.assign_delivery(p_order uuid, p_worker uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_uid uuid := app.require_user();
  o public.orders;
  d public.deliveries;
  v_prev public.delivery_status;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not app.is_staff(o.wholesaler_id) then
    perform app.fail('VF403', 'Only the wholesaler''s staff can assign deliveries');
  end if;
  perform app.require_active_company(o.wholesaler_id);
  if o.status not in ('accepted', 'preparing', 'ready_for_delivery') then
    perform app.fail('VF409', format('Deliveries cannot be assigned while the order is %s', replace(o.status::text, '_', ' ')));
  end if;
  if not exists (select 1 from public.company_memberships
                  where company_id = o.wholesaler_id and user_id = p_worker and status = 'active') then
    perform app.fail('VF422', 'Choose an active member of your team');
  end if;

  select * into d from public.deliveries where order_id = p_order for update;
  if found then
    if d.status not in ('assigned', 'failed', 'cancelled') then
      perform app.fail('VF409', 'This delivery is already on its way and cannot be reassigned');
    end if;
    v_prev := d.status;
    update public.delivery_assignments set ended_at = app.now() where delivery_id = d.id and ended_at is null;
    update public.deliveries set assigned_worker_id = p_worker, status = 'assigned', failure_reason = null,
           failed_at = null, updated_at = app.now()
     where id = d.id returning * into d;
  else
    insert into public.deliveries (order_id, wholesaler_id, assigned_worker_id, status, created_at, updated_at)
    values (p_order, o.wholesaler_id, p_worker, 'assigned', app.now(), app.now()) returning * into d;
  end if;

  insert into public.delivery_assignments (delivery_id, worker_id, assigned_by, note, assigned_at)
  values (d.id, p_worker, v_uid, left(p_note, 500), app.now());
  insert into public.delivery_events (delivery_id, from_status, to_status, note, actor_id, created_at, details)
  values (d.id, v_prev, 'assigned', left(p_note, 1000), v_uid, app.now(), jsonb_build_object('worker_id', p_worker));
  insert into public.order_events (order_id, event_type, note, actor_id, created_at)
  values (p_order, 'delivery_assigned',
          'Assigned to ' || coalesce((select nullif(full_name, '') from public.profiles where id = p_worker), 'team member'),
          v_uid, app.now());
  insert into public.notifications (user_id, company_id, kind, title, body, link, created_at)
  values (p_worker, o.wholesaler_id, 'delivery.assigned', format('Delivery %s assigned to you', o.order_number),
          (o.delivery_address ->> 'line1') || ', ' || (o.delivery_address ->> 'city'), '/d/' || d.id, app.now());
  return d.id;
end $$;

-- Delivery status updates by the assigned worker (or wholesaler managers).
-- p_items for partial delivery: [{"order_item_id": uuid, "delivered_quantity": number}]
create or replace function app.update_delivery(p_delivery uuid, p_to public.delivery_status, p_note text default null,
  p_failure_reason text default null, p_items jsonb default null, p_recipient text default null,
  p_empties int default null)
returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_uid uuid := app.require_user();
  d public.deliveries;
  o public.orders;
  it public.order_items;
  v_delivered numeric;
  v_short_taxable numeric := 0;
  v_short_tax numeric := 0;
  v_inv public.invoices;
  v_location uuid;
  v_any_short boolean := false;
begin
  select * into d from public.deliveries where id = p_delivery for update;
  if not found then
    perform app.fail('VF404', 'Delivery not found');
  end if;
  if not (d.assigned_worker_id = v_uid or app.can_manage(d.wholesaler_id)) then
    perform app.fail('VF403', 'This delivery is not assigned to you');
  end if;
  perform app.require_active_company(d.wholesaler_id);
  select * into o from public.orders where id = d.order_id for update;

  if d.status = 'assigned' and p_to = 'out_for_delivery' then
    if o.status <> 'ready_for_delivery' then
      perform app.fail('VF409', 'The order must be ready for delivery before it can be picked up');
    end if;
    perform app._apply_order_transition(o.id, 'out_for_delivery', coalesce(p_note, 'Picked up for delivery'));
    update public.deliveries set status = p_to, dispatched_at = app.now(), updated_at = app.now() where id = d.id;

  elsif d.status = 'out_for_delivery' and p_to = 'delivered' then
    perform app._apply_order_transition(o.id, 'delivered', coalesce(p_note, 'Delivered'));
    update public.deliveries set status = p_to, delivered_at = app.now(), recipient_name = left(p_recipient, 120),
           empties_collected = p_empties, updated_at = app.now() where id = d.id;

  elsif d.status = 'out_for_delivery' and p_to = 'partially_delivered' then
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
      perform app.fail('VF422', 'Enter the delivered quantity for each item');
    end if;
    v_location := app.default_location(d.wholesaler_id);
    for it in select * from public.order_items where order_id = o.id order by line_no loop
      select (e ->> 'delivered_quantity')::numeric into v_delivered
        from jsonb_array_elements(p_items) e where (e ->> 'order_item_id')::uuid = it.id;
      v_delivered := coalesce(v_delivered, it.quantity);
      if v_delivered < 0 or v_delivered > it.quantity then
        perform app.fail('VF422', format('Delivered quantity for %s must be between 0 and %s', it.product_name, it.quantity));
      end if;
      update public.order_items set delivered_quantity = v_delivered where id = it.id;
      if v_delivered < it.quantity then
        v_any_short := true;
        perform app.apply_stock_change(d.wholesaler_id, v_location, it.variant_id, 'delivery_return',
          (it.quantity - v_delivered) * it.unit_factor, 0, 'order', o.id, 'Undelivered quantity returned');
        v_short_taxable := v_short_taxable + round(it.taxable_amount * (it.quantity - v_delivered) / it.quantity, 2);
        v_short_tax := v_short_tax + round(it.tax_amount * (it.quantity - v_delivered) / it.quantity, 2);
      end if;
    end loop;
    if not v_any_short then
      perform app.fail('VF422', 'All items were delivered; mark the delivery as delivered instead');
    end if;
    perform app._apply_order_transition(o.id, 'delivered', coalesce(p_note, 'Partially delivered'));
    update public.orders set partially_delivered = true where id = o.id;
    update public.deliveries set status = p_to, delivered_at = app.now(), recipient_name = left(p_recipient, 120),
           empties_collected = p_empties, updated_at = app.now() where id = d.id;
    -- Already invoiced: issue a credit note for the undelivered value.
    select * into v_inv from public.invoices where order_id = o.id and status = 'issued';
    if found and v_short_taxable + v_short_tax > 0 then
      perform app._issue_credit_note(v_inv.id, v_short_taxable, v_short_tax, 'short_delivery',
        'Undelivered quantity on order ' || o.order_number);
    end if;

  elsif d.status = 'out_for_delivery' and p_to = 'failed' then
    if nullif(trim(p_failure_reason), '') is null then
      perform app.fail('VF422', 'Give a reason for the failed delivery');
    end if;
    perform app._apply_order_transition(o.id, 'ready_for_delivery', 'Delivery failed: ' || p_failure_reason);
    update public.deliveries set status = p_to, failed_at = app.now(), failure_reason = left(p_failure_reason, 500),
           updated_at = app.now() where id = d.id;
  else
    perform app.fail('VF409', format('A delivery that is %s cannot be marked %s',
      replace(d.status::text, '_', ' '), replace(p_to::text, '_', ' ')));
  end if;

  if p_note is not null then
    update public.deliveries set notes = left(coalesce(notes || E'\n', '') || p_note, 1000) where id = d.id;
  end if;
  insert into public.delivery_events (delivery_id, from_status, to_status, note, actor_id, created_at, details)
  values (d.id, d.status, p_to, left(coalesce(p_note, p_failure_reason), 1000), v_uid, app.now(),
          jsonb_strip_nulls(jsonb_build_object('items', p_items, 'recipient', p_recipient, 'empties_collected', p_empties,
                                               'failure_reason', p_failure_reason)));
  insert into public.order_events (order_id, event_type, note, actor_id, created_at)
  values (o.id, 'delivery_updated', 'Delivery ' || replace(p_to::text, '_', ' '), v_uid, app.now());
end $$;
