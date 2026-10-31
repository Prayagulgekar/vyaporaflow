-- =============================================================================
-- 0800 Reporting views (security_invoker, so RLS of base tables applies),
--      grants and Row-Level Security policies for every protected table.
-- =============================================================================

create view public.invoice_balances with (security_invoker = true) as
select i.id as invoice_id, i.invoice_number, i.wholesaler_id, i.retailer_id, i.order_id, i.invoice_date, i.due_date,
       i.status, i.grand_total,
       coalesce(cn.total, 0) as credited,
       coalesce(pa.total, 0) as paid,
       case when i.status = 'void' then 0 else i.grand_total - coalesce(cn.total, 0) - coalesce(pa.total, 0) end as due,
       case when i.status = 'void' then 'void'
            when i.grand_total - coalesce(cn.total, 0) - coalesce(pa.total, 0) <= 0 then 'paid'
            when i.due_date < (now() at time zone 'Asia/Kolkata')::date then 'overdue'
            when coalesce(pa.total, 0) > 0 or coalesce(cn.total, 0) > 0 then 'partially_paid'
            else 'unpaid' end as payment_status
  from public.invoices i
  left join (select invoice_id, sum(amount) as total from public.credit_notes group by 1) cn on cn.invoice_id = i.id
  left join (select invoice_id, sum(amount) as total from public.payment_allocations group by 1) pa on pa.invoice_id = i.id;

create view public.payment_balances with (security_invoker = true) as
select p.id as payment_id, p.payment_number, p.wholesaler_id, p.retailer_id, p.amount, p.method, p.reference,
       p.received_at, p.status, p.verified_by_gateway,
       coalesce(sum(a.amount), 0) as allocated,
       case when p.status = 'reversed' then 0 else p.amount - coalesce(sum(a.amount), 0) end as unapplied
  from public.payments p
  left join public.payment_allocations a on a.payment_id = p.id
 group by p.id;

-- Outstanding receivable per wholesaler-retailer pair, derived from documents:
-- invoiced - credit notes - posted payments. Unapplied payments (advances)
-- therefore reduce the outstanding balance. Reconciled against the ledger by
-- app.reconcile_receivables().
create view public.retailer_balances with (security_invoker = true) as
select r.wholesaler_id, r.retailer_id, r.status as relationship_status, r.credit_limit,
       coalesce(inv.total, 0) as invoiced,
       coalesce(cn.total, 0) as credited,
       coalesce(pay.total, 0) as received,
       coalesce(inv.total, 0) - coalesce(cn.total, 0) - coalesce(pay.total, 0) as outstanding,
       coalesce(pay.total, 0) - coalesce(alloc.total, 0) as unapplied,
       coalesce(ord.total_orders, 0) as total_orders,
       coalesce(ord.delivered_orders, 0) as delivered_orders,
       coalesce(ord.cancelled_orders, 0) as cancelled_orders,
       ord.last_order_at
  from public.retailer_wholesaler_relationships r
  left join (select wholesaler_id, retailer_id, sum(grand_total) total from public.invoices where status = 'issued' group by 1, 2) inv
    on inv.wholesaler_id = r.wholesaler_id and inv.retailer_id = r.retailer_id
  left join (select wholesaler_id, retailer_id, sum(amount) total from public.credit_notes group by 1, 2) cn
    on cn.wholesaler_id = r.wholesaler_id and cn.retailer_id = r.retailer_id
  left join (select wholesaler_id, retailer_id, sum(amount) total from public.payments where status = 'posted' group by 1, 2) pay
    on pay.wholesaler_id = r.wholesaler_id and pay.retailer_id = r.retailer_id
  left join (select p.wholesaler_id, p.retailer_id, sum(a.amount) total
               from public.payment_allocations a join public.payments p on p.id = a.payment_id
              where p.status = 'posted' group by 1, 2) alloc
    on alloc.wholesaler_id = r.wholesaler_id and alloc.retailer_id = r.retailer_id
  left join (select wholesaler_id, retailer_id, count(*)::int total_orders,
                    count(*) filter (where status = 'delivered')::int delivered_orders,
                    count(*) filter (where status = 'cancelled')::int cancelled_orders,
                    max(placed_at) last_order_at
               from public.orders group by 1, 2) ord
    on ord.wholesaler_id = r.wholesaler_id and ord.retailer_id = r.retailer_id;

create view public.order_overview with (security_invoker = true) as
select o.*,
       rc.name as retailer_name, wc.name as wholesaler_name,
       d.id as delivery_id, d.status as delivery_status, d.assigned_worker_id,
       ib.invoice_id, ib.invoice_number, ib.due as invoice_due,
       case when ib.invoice_id is null then 'not_invoiced' else ib.payment_status end as payment_status
  from public.orders o
  join public.companies rc on rc.id = o.retailer_id
  join public.companies wc on wc.id = o.wholesaler_id
  left join public.deliveries d on d.order_id = o.id
  left join public.invoice_balances ib on ib.order_id = o.id and ib.status = 'issued';

create view public.inventory_overview with (security_invoker = true) as
select v.company_id, v.id as variant_id, v.product_id, p.name as product_name, v.name as variant_name, v.sku,
       v.base_unit, v.low_stock_threshold, p.archived_at, pc.name as category_name, br.name as brand_name,
       coalesce(sum(b.on_hand), 0) as on_hand, coalesce(sum(b.reserved), 0) as reserved,
       coalesce(sum(b.available), 0) as available,
       coalesce(sum(b.available), 0) <= v.low_stock_threshold as is_low,
       (select min(pb.expiry_date) from public.product_batches pb where pb.variant_id = v.id and pb.expiry_date >= current_date) as next_expiry
  from public.product_variants v
  join public.products p on p.id = v.product_id
  join public.product_categories pc on pc.id = p.category_id
  left join public.brands br on br.id = p.brand_id
  left join public.inventory_balances b on b.variant_id = v.id
 group by v.id, p.id, pc.name, br.name;

-- Delivery workers see their deliveries through this minimal view.
create view public.my_deliveries with (security_invoker = true) as
select d.id, d.order_id, d.wholesaler_id, d.status, d.dispatched_at, d.delivered_at, d.failed_at, d.failure_reason,
       d.notes, d.recipient_name, d.empties_collected, d.updated_at, d.created_at,
       o.order_number, o.status as order_status, o.delivery_address, o.items_count, o.grand_total, o.notes as order_notes,
       rc.name as retailer_name, rc.phone as retailer_phone, rc.contact_name as retailer_contact,
       wc.name as wholesaler_name
  from public.deliveries d
  join public.orders o on o.id = d.order_id
  join public.companies rc on rc.id = o.retailer_id
  join public.companies wc on wc.id = d.wholesaler_id
 where d.assigned_worker_id = auth.uid();

-- -----------------------------------------------------------------------------
-- Helper: is the current user the assigned worker for an order's delivery?
-- -----------------------------------------------------------------------------
create or replace function app.is_assigned_worker_for_order(p_order uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.deliveries d where d.order_id = p_order and d.assigned_worker_id = auth.uid())
$$;

create or replace function app.is_assigned_worker_for_company(p_company uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.deliveries d join public.orders o on o.id = d.order_id
                  where d.assigned_worker_id = auth.uid() and (o.retailer_id = p_company or o.wholesaler_id = p_company))
$$;

create or replace function app.shares_company_with(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.company_memberships a
      join public.company_memberships b on b.company_id = a.company_id
     where a.user_id = auth.uid() and a.status = 'active' and b.user_id = p_user
       and a.role in ('owner', 'manager', 'staff'))
$$;

-- -----------------------------------------------------------------------------
-- Grants: start from nothing, then grant what each role needs. RLS decides rows.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema app from public, anon, authenticated;

-- Reference data: readable by everyone.
grant select on public.indian_states, public.geo_places, public.units_of_measure, public.platform_settings to anon, authenticated;
grant select on public.tax_classes, public.product_categories, public.brands to anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, phone, preferred_language) on public.profiles to authenticated;
grant select on public.platform_admins to authenticated;
grant select on public.companies to authenticated;
grant update (name, contact_name, phone, email, gstin, logo_path, preferred_language) on public.companies to authenticated;
grant select, insert, update, delete on public.business_addresses to authenticated;
grant select on public.company_memberships, public.company_invitations to authenticated;
grant select on public.wholesaler_profiles to authenticated;
grant update (business_category, description, offers_delivery, min_order_value, delivery_charge, free_delivery_above,
              auto_approve_retailers, payment_terms_days, whatsapp_number, opening_hours, is_listed)
  on public.wholesaler_profiles to authenticated;
grant select on public.retailer_profiles to authenticated;
grant update (shop_type, preferred_delivery_address_id) on public.retailer_profiles to authenticated;
grant select, insert, update, delete on public.delivery_zones to authenticated;
grant select on public.retailer_wholesaler_relationships to authenticated;
grant select, update (read_at) on public.notifications to authenticated;
grant select on public.audit_logs, public.support_requests to authenticated;

grant insert, update, delete on public.tax_classes, public.product_categories, public.brands to authenticated;
grant select, insert, update on public.products, public.product_variants, public.variant_units to authenticated;
grant select, insert on public.inventory_locations to authenticated;
grant select on public.inventory_balances, public.stock_movements, public.product_batches to authenticated;

grant select, insert, update, delete on public.cart_items to authenticated;
grant select on public.orders, public.order_items, public.order_events to authenticated;
grant select on public.invoices, public.invoice_items, public.credit_notes to authenticated;
grant select on public.payments, public.payment_allocations, public.payment_reversals to authenticated;
grant select on public.journal_entries, public.journal_lines to authenticated;
grant select on public.deliveries, public.delivery_assignments, public.delivery_events to authenticated;
grant select, insert, update on public.suppliers to authenticated;
grant select on public.purchase_orders, public.purchase_order_items, public.goods_receipts, public.goods_receipt_items to authenticated;

grant select on public.invoice_balances, public.payment_balances, public.retailer_balances, public.order_overview,
                public.inventory_overview, public.my_deliveries to authenticated;

-- Functions callable by signed-in users (each authorizes internally).
grant execute on function
  app.now(), app.today(), app.is_platform_admin(), app.has_company_role(uuid, public.membership_role[]),
  app.is_staff(uuid), app.can_manage(uuid), app.is_member(uuid), app.my_staff_company_ids(),
  app.is_related_party(uuid), app.is_approved_retailer_of(uuid), app.is_assigned_worker_for_order(uuid),
  app.is_assigned_worker_for_company(uuid), app.shares_company_with(uuid),
  app.complete_onboarding(jsonb), app.create_invitation(uuid, text, text, public.membership_role),
  app.accept_invitation(text), app.set_member_status(uuid, public.membership_status),
  app.request_relationship(uuid, uuid, text), app.decide_relationship(uuid, public.relationship_status, numeric, text),
  app.adjust_stock(uuid, public.stock_movement_type, numeric, text, text, date, uuid),
  app.reconcile_inventory(uuid), app.variant_availability(uuid[]),
  app.calc_line(numeric, numeric, numeric, numeric, boolean), app.order_transition_allowed(public.order_status, public.order_status),
  app.quote_order(uuid, uuid, jsonb), app.place_order(uuid, uuid, jsonb, text, text, uuid),
  app.transition_order(uuid, public.order_status, text), app.assign_delivery(uuid, uuid, text),
  app.update_delivery(uuid, public.delivery_status, text, text, jsonb, text, int),
  app.generate_invoice(uuid, int), app.void_invoice(uuid, text), app.create_credit_note(uuid, numeric, text, text),
  app.record_payment(uuid, uuid, numeric, public.payment_method, text, timestamptz, text, text, jsonb),
  app.allocate_payment(uuid, uuid, numeric), app.reverse_payment(uuid, text), app.reconcile_receivables(uuid),
  app.invoice_due(uuid), app.payment_unapplied(uuid),
  app.create_purchase_order(uuid, uuid, jsonb, date, text), app.receive_goods(uuid, jsonb, text),
  app.admin_overview(), app.admin_list_users(text, int, int), app.admin_set_company_status(uuid, public.company_status, text),
  app.admin_set_verification(uuid, public.verification_status, text), app.admin_update_support(uuid, text, text),
  app.admin_set_setting(text, jsonb), app.request_verification(uuid)
to authenticated;

-- Functions also available to anonymous visitors.
grant execute on function
  app.now(), app.is_open_now(jsonb), app.distance_km(numeric, numeric, numeric, numeric),
  app.delivery_coverage(uuid, numeric, numeric, text),
  app.search_wholesalers(numeric, numeric, numeric, text, text, text, int, int),
  app.wholesaler_public(text), app.submit_support_request(text, text, text, text, text, text),
  app.is_staff(uuid), app.is_approved_retailer_of(uuid), app.has_company_role(uuid, public.membership_role[]),
  app.my_staff_company_ids()
to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- RLS is enabled (not forced) so SECURITY DEFINER functions owned by the
-- migration owner can perform their internal, already-authorized writes.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'indian_states', 'geo_places', 'platform_settings', 'profiles', 'platform_admins', 'companies',
    'business_addresses', 'company_memberships', 'company_invitations', 'wholesaler_profiles', 'retailer_profiles',
    'delivery_zones', 'retailer_wholesaler_relationships', 'company_counters', 'notifications', 'audit_logs',
    'support_requests', 'units_of_measure', 'tax_classes', 'product_categories', 'brands', 'products',
    'product_variants', 'variant_units', 'inventory_locations', 'inventory_balances', 'product_batches',
    'stock_movements', 'cart_items', 'orders', 'order_items', 'order_events', 'invoices', 'invoice_items',
    'credit_notes', 'payments', 'payment_reversals', 'payment_allocations', 'journal_entries', 'journal_lines',
    'deliveries', 'delivery_assignments', 'delivery_events', 'suppliers', 'purchase_orders',
    'purchase_order_items', 'goods_receipts', 'goods_receipt_items']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Reference data
create policy states_read on public.indian_states for select using (true);
create policy geo_read on public.geo_places for select using (true);
create policy units_read on public.units_of_measure for select using (true);
create policy settings_read on public.platform_settings for select using (true);

-- Profiles: yourself, colleagues, and admins.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or app.shares_company_with(id) or app.is_platform_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Platform admins: a user may only see their own admin row. No write policies.
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = auth.uid());

-- Companies: members, counterparties with a relationship, delivery workers on
-- an assigned delivery, approved-retailer catalog browsing, and admins.
-- Public discovery goes through app.search_wholesalers / app.wholesaler_public.
create policy companies_select on public.companies for select to authenticated
  using (app.is_member(id) or app.is_related_party(id) or app.is_assigned_worker_for_company(id) or app.is_platform_admin());
create policy companies_update on public.companies for update to authenticated
  using (app.can_manage(id)) with check (app.can_manage(id));

create policy addresses_select on public.business_addresses for select to authenticated
  using (app.is_member(company_id) or app.is_related_party(company_id) or app.is_platform_admin());
create policy addresses_write on public.business_addresses for all to authenticated
  using (app.can_manage(company_id)) with check (app.can_manage(company_id));

create policy memberships_select on public.company_memberships for select to authenticated
  using (user_id = auth.uid() or app.is_staff(company_id) or app.is_platform_admin());

create policy invitations_select on public.company_invitations for select to authenticated
  using (app.can_manage(company_id));

create policy wholesaler_profiles_select on public.wholesaler_profiles for select to authenticated
  using (is_listed or app.is_member(company_id) or app.is_platform_admin());
create policy wholesaler_profiles_update on public.wholesaler_profiles for update to authenticated
  using (app.can_manage(company_id)) with check (app.can_manage(company_id));

create policy retailer_profiles_select on public.retailer_profiles for select to authenticated
  using (app.is_member(company_id) or app.is_related_party(company_id) or app.is_platform_admin());
create policy retailer_profiles_update on public.retailer_profiles for update to authenticated
  using (app.can_manage(company_id)) with check (app.can_manage(company_id));

create policy zones_select on public.delivery_zones for select to authenticated using (true);
create policy zones_write on public.delivery_zones for all to authenticated
  using (app.can_manage(company_id)) with check (app.can_manage(company_id));

create policy relationships_select on public.retailer_wholesaler_relationships for select to authenticated
  using (app.is_staff(wholesaler_id) or app.is_staff(retailer_id) or app.is_platform_admin());

-- company_counters: no policies -> no access except trusted functions.

create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy audit_select on public.audit_logs for select to authenticated
  using (app.is_platform_admin() or (company_id is not null and app.can_manage(company_id)));

create policy support_select on public.support_requests for select to authenticated
  using (app.is_platform_admin() or user_id = auth.uid());

-- Catalog reference tables: global rows readable by all; company rows writable by managers.
create policy tax_classes_read on public.tax_classes for select using (true);
create policy tax_classes_write on public.tax_classes for all to authenticated
  using (company_id is not null and app.can_manage(company_id)) with check (company_id is not null and app.can_manage(company_id));
create policy categories_read on public.product_categories for select using (true);
create policy categories_write on public.product_categories for all to authenticated
  using (company_id is not null and app.can_manage(company_id)) with check (company_id is not null and app.can_manage(company_id));
create policy brands_read on public.brands for select using (true);
create policy brands_write on public.brands for all to authenticated
  using (company_id is not null and app.can_manage(company_id)) with check (company_id is not null and app.can_manage(company_id));

-- Products: staff of the owner; approved retailers see active items.
create policy products_select on public.products for select to authenticated
  using (app.is_staff(company_id) or (archived_at is null and app.is_approved_retailer_of(company_id)));
create policy products_insert on public.products for insert to authenticated with check (app.can_manage(company_id));
create policy products_update on public.products for update to authenticated
  using (app.can_manage(company_id)) with check (app.can_manage(company_id));

create policy variants_select on public.product_variants for select to authenticated
  using (app.is_staff(company_id) or (is_active and app.is_approved_retailer_of(company_id)));
create policy variants_insert on public.product_variants for insert to authenticated with check (app.can_manage(company_id));
create policy variants_update on public.product_variants for update to authenticated
  using (app.can_manage(company_id)) with check (app.can_manage(company_id));

create policy variant_units_select on public.variant_units for select to authenticated
  using (app.is_staff(company_id) or (is_active and app.is_approved_retailer_of(company_id)));
create policy variant_units_insert on public.variant_units for insert to authenticated with check (app.can_manage(company_id));
create policy variant_units_update on public.variant_units for update to authenticated
  using (app.can_manage(company_id)) with check (app.can_manage(company_id));

-- Inventory is private to the company's office staff.
create policy locations_select on public.inventory_locations for select to authenticated using (app.is_staff(company_id));
create policy locations_insert on public.inventory_locations for insert to authenticated with check (app.can_manage(company_id));
create policy balances_select on public.inventory_balances for select to authenticated using (app.is_staff(company_id));
create policy batches_select on public.product_batches for select to authenticated using (app.is_staff(company_id));
create policy movements_select on public.stock_movements for select to authenticated using (app.is_staff(company_id));

-- Carts belong to the retailer.
create policy cart_select on public.cart_items for select to authenticated using (app.is_staff(retailer_id));
create policy cart_insert on public.cart_items for insert to authenticated
  with check (app.is_staff(retailer_id) and app.is_approved_retailer_of(wholesaler_id));
create policy cart_update on public.cart_items for update to authenticated
  using (app.is_staff(retailer_id)) with check (app.is_staff(retailer_id));
create policy cart_delete on public.cart_items for delete to authenticated using (app.is_staff(retailer_id));

-- Orders: wholesaler staff, retailer staff, and the assigned delivery worker.
create policy orders_select on public.orders for select to authenticated
  using (app.is_staff(wholesaler_id) or app.is_staff(retailer_id) or app.is_assigned_worker_for_order(id));
create policy order_items_select on public.order_items for select to authenticated
  using (app.is_staff(wholesaler_id)
         or exists (select 1 from public.orders o where o.id = order_id and app.is_staff(o.retailer_id))
         or app.is_assigned_worker_for_order(order_id));
create policy order_events_select on public.order_events for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                  and (app.is_staff(o.wholesaler_id) or app.is_staff(o.retailer_id))));

-- Billing: wholesaler staff and the retailer that was billed. Not delivery workers.
create policy invoices_select on public.invoices for select to authenticated
  using (app.is_staff(wholesaler_id) or app.is_staff(retailer_id));
create policy invoice_items_select on public.invoice_items for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and (app.is_staff(i.wholesaler_id) or app.is_staff(i.retailer_id))));
create policy credit_notes_select on public.credit_notes for select to authenticated
  using (app.is_staff(wholesaler_id) or app.is_staff(retailer_id));
create policy payments_select on public.payments for select to authenticated
  using (app.is_staff(wholesaler_id) or app.is_staff(retailer_id));
create policy payment_reversals_select on public.payment_reversals for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_id and (app.is_staff(p.wholesaler_id) or app.is_staff(p.retailer_id))));
create policy allocations_select on public.payment_allocations for select to authenticated
  using (app.is_staff(wholesaler_id)
         or exists (select 1 from public.payments p where p.id = payment_id and app.is_staff(p.retailer_id)));
create policy journal_entries_select on public.journal_entries for select to authenticated using (app.can_manage(company_id));
create policy journal_lines_select on public.journal_lines for select to authenticated using (app.can_manage(company_id));

-- Deliveries: wholesaler staff, the currently assigned worker, and the retailer.
create policy deliveries_select on public.deliveries for select to authenticated
  using (app.is_staff(wholesaler_id) or assigned_worker_id = auth.uid()
         or exists (select 1 from public.orders o where o.id = order_id and app.is_staff(o.retailer_id)));
create policy delivery_assignments_select on public.delivery_assignments for select to authenticated
  using (worker_id = auth.uid()
         or exists (select 1 from public.deliveries d where d.id = delivery_id and app.is_staff(d.wholesaler_id)));
create policy delivery_events_select on public.delivery_events for select to authenticated
  using (exists (select 1 from public.deliveries d where d.id = delivery_id
                  and (app.is_staff(d.wholesaler_id) or d.assigned_worker_id = auth.uid())));

-- Purchasing: company staff read; managers write suppliers.
create policy suppliers_select on public.suppliers for select to authenticated using (app.is_staff(company_id));
create policy suppliers_insert on public.suppliers for insert to authenticated with check (app.can_manage(company_id));
create policy suppliers_update on public.suppliers for update to authenticated
  using (app.can_manage(company_id)) with check (app.can_manage(company_id));
create policy po_select on public.purchase_orders for select to authenticated using (app.is_staff(company_id));
create policy poi_select on public.purchase_order_items for select to authenticated using (app.is_staff(company_id));
create policy gr_select on public.goods_receipts for select to authenticated using (app.is_staff(company_id));
create policy gri_select on public.goods_receipt_items for select to authenticated
  using (exists (select 1 from public.goods_receipts g where g.id = receipt_id and app.is_staff(g.company_id)));
