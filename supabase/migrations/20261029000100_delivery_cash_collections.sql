-- =============================================================================
-- 20261029000100 Delivery cash collections and cash handovers
--
-- Forward-only. Adds two new records and changes no existing rows:
--   * delivery_collections: what a delivery worker collected on a delivery.
--     A non-zero collection is ALSO a normal row in public.payments (the
--     existing receipt), so it appears on the Payments screen, the retailer's
--     statement and balances exactly once. A zero collection records "nothing
--     collected" and creates no payment.
--   * cash_handovers (+ items): the worker handing collected cash to the
--     office. Internal cash movement only: it never touches payments or AR.
--
-- Ledger mapping (existing double-entry journal, one new account):
--   collection (cash)   Dr CASH_IN_TRANSIT  Cr AR (retailer)
--   collection (UPI)    Dr UPI              Cr AR (retailer)
--   handover            Dr CASH             Cr CASH_IN_TRANSIT
--   handover reversal   Dr CASH_IN_TRANSIT  Cr CASH
--   collection reversal Dr AR               Cr CASH_IN_TRANSIT (or UPI)
-- CASH_IN_TRANSIT is therefore "cash held by delivery staff", and its balance
-- equals the total pending handover.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Widen two CHECK lists on the journal (new account and source types).
--    Constraints are found by definition so this works whatever they are named.
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.journal_lines'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%account_code = ANY%' loop
    execute format('alter table public.journal_lines drop constraint %I', r.conname);
  end loop;
  for r in select conname from pg_constraint
            where conrelid = 'public.journal_entries'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%source_type = ANY%' loop
    execute format('alter table public.journal_entries drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.journal_lines add constraint journal_lines_account_code_check check (account_code in (
  'AR', 'SALES', 'DELIVERY_INCOME', 'OUTPUT_CGST', 'OUTPUT_SGST', 'OUTPUT_IGST',
  'SALES_RETURNS', 'CASH', 'BANK', 'UPI', 'CHEQUE', 'OTHER', 'CASH_IN_TRANSIT'));
alter table public.journal_entries add constraint journal_entries_source_type_check check (source_type in (
  'invoice', 'invoice_void', 'credit_note', 'payment', 'payment_reversal', 'cash_handover', 'cash_handover_reversal'));

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------
create table public.delivery_collections (
  id uuid primary key default gen_random_uuid(),
  collection_number text not null,
  wholesaler_id uuid not null references public.companies(id),
  retailer_id uuid not null references public.companies(id),
  order_id uuid not null references public.orders(id),
  delivery_id uuid not null references public.deliveries(id),
  worker_id uuid not null references auth.users(id),
  payment_id uuid unique references public.payments(id),
  -- The payment's receipt number, copied so the worker (who cannot read payments) can show it.
  payment_number text,
  amount numeric(14, 2) not null check (amount >= 0),
  method public.payment_method not null check (method in ('cash', 'upi')),
  reference text check (char_length(reference) <= 100),
  note text check (char_length(note) <= 500),
  collected_at timestamptz not null,
  -- Snapshot of what the worker saw, for the audit trail.
  order_value numeric(14, 2) not null,
  payable_before numeric(14, 2) not null,
  -- Cash stays with the worker until handed over; UPI goes straight to the business.
  requires_handover boolean not null,
  status text not null default 'recorded' check (status in ('recorded', 'reversed')),
  reversed_at timestamptz,
  reversal_reason text check (char_length(reversal_reason) <= 500),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 90),
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (wholesaler_id, collection_number),
  unique (wholesaler_id, idempotency_key),
  check ((amount = 0) = (payment_id is null)),
  check ((payment_id is null) = (payment_number is null)),
  check (amount <= payable_before),
  check (requires_handover = (method = 'cash' and amount > 0))
);
create index delivery_collections_worker_idx on public.delivery_collections (wholesaler_id, worker_id, collected_at desc);
create index delivery_collections_order_idx on public.delivery_collections (order_id);
create index delivery_collections_delivery_idx on public.delivery_collections (delivery_id);

create or replace function app.delivery_collections_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'VF409', message = 'Collections cannot be deleted; reverse the payment instead';
  end if;
  -- Only one change is allowed: recorded -> reversed (done by app.reverse_payment).
  if (to_jsonb(new) - 'status' - 'reversed_at' - 'reversal_reason') <> (to_jsonb(old) - 'status' - 'reversed_at' - 'reversal_reason')
     or old.status <> 'recorded' or new.status <> 'reversed' then
    raise exception using errcode = 'VF409', message = 'Collections are immutable; reverse the payment instead';
  end if;
  return new;
end $$;
create trigger delivery_collections_guard before update or delete on public.delivery_collections
  for each row execute function app.delivery_collections_guard();

create table public.cash_handovers (
  id uuid primary key default gen_random_uuid(),
  handover_number text not null,
  wholesaler_id uuid not null references public.companies(id),
  worker_id uuid not null references auth.users(id),
  expected_amount numeric(14, 2) not null check (expected_amount > 0),
  received_amount numeric(14, 2) not null check (received_amount > 0),
  -- Shortfall at the time of handover. The short amount stays pending on the
  -- collections; it is never written off silently.
  discrepancy numeric(14, 2) not null,
  note text check (char_length(note) <= 500),
  received_by uuid not null references auth.users(id),
  received_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  reversed_by uuid references auth.users(id),
  reversed_at timestamptz,
  reversal_reason text check (char_length(reversal_reason) <= 500),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),
  unique (wholesaler_id, handover_number),
  unique (wholesaler_id, idempotency_key),
  check (received_amount <= expected_amount),
  check (discrepancy = expected_amount - received_amount),
  check (worker_id <> received_by)
);
create index cash_handovers_worker_idx on public.cash_handovers (wholesaler_id, worker_id, received_at desc);

create table public.cash_handover_items (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.cash_handovers(id),
  collection_id uuid not null references public.delivery_collections(id),
  wholesaler_id uuid not null references public.companies(id),
  amount numeric(14, 2) not null check (amount > 0),
  unique (handover_id, collection_id)
);
create index cash_handover_items_collection_idx on public.cash_handover_items (collection_id);
create trigger cash_handover_items_append_only before update or delete on public.cash_handover_items
  for each row execute function app.forbid_mutation();

create or replace function app.cash_handovers_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'VF409', message = 'Handovers cannot be deleted; reverse them instead';
  end if;
  if (to_jsonb(new) - 'status' - 'reversed_by' - 'reversed_at' - 'reversal_reason')
       <> (to_jsonb(old) - 'status' - 'reversed_by' - 'reversed_at' - 'reversal_reason')
     or old.status <> 'confirmed' or new.status <> 'reversed' then
    raise exception using errcode = 'VF409', message = 'Handovers are immutable; reverse them instead';
  end if;
  return new;
end $$;
create trigger cash_handovers_guard before update or delete on public.cash_handovers
  for each row execute function app.cash_handovers_guard();

-- -----------------------------------------------------------------------------
-- 3. Amounts
-- -----------------------------------------------------------------------------

-- Value of what was (or will be) delivered on an order, computed the same way
-- app.generate_invoice computes an invoice total. Internal (no authorization).
create or replace function app._order_billable(p_order uuid) returns numeric
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare o public.orders; it public.order_items; c record; v_total numeric := 0;
begin
  select * into o from public.orders where id = p_order;
  if not o.partially_delivered then
    return o.grand_total;
  end if;
  for it in select * from public.order_items where order_id = p_order loop
    continue when coalesce(it.delivered_quantity, it.quantity) = 0;
    select * into c from app.calc_line(coalesce(it.delivered_quantity, it.quantity), it.unit_price, it.discount_percent,
      it.tax_rate, it.price_includes_tax);
    v_total := v_total + c.line_total;
  end loop;
  return v_total + o.delivery_charge;
end $$;

-- Where an order stands: its value (the live invoice total once invoiced),
-- credits, money received against it and the balance still due.
-- Internal (no authorization).
create or replace function app._order_position(p_order uuid,
  out order_value numeric, out credited numeric, out paid numeric, out balance_due numeric,
  out invoice_id uuid, out invoice_number text)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_unapplied numeric;
begin
  -- Collection payments on this order not yet applied to an invoice.
  select coalesce(sum(app.payment_unapplied(c.payment_id)), 0) into v_unapplied
    from public.delivery_collections c where c.order_id = p_order and c.payment_id is not null and c.status = 'recorded';
  select i.id, i.invoice_number, i.grand_total,
         coalesce((select sum(amount) from public.credit_notes cn where cn.invoice_id = i.id), 0),
         coalesce((select sum(amount) from public.payment_allocations a where a.invoice_id = i.id), 0)
    into invoice_id, invoice_number, order_value, credited, paid
    from public.invoices i where i.order_id = p_order and i.status = 'issued';
  if invoice_id is null then
    order_value := app._order_billable(p_order);
    credited := 0;
    paid := 0;
  end if;
  paid := paid + v_unapplied;
  balance_due := order_value - credited - paid;
end $$;

-- Same, for anyone allowed to see the order (staff of either side or its
-- assigned delivery worker). Returns no row otherwise.
create or replace function app.order_position(p_order uuid)
returns table (order_value numeric, credited numeric, paid numeric, balance_due numeric, invoice_id uuid, invoice_number text)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  if not found or not (app.is_staff(o.wholesaler_id) or app.is_staff(o.retailer_id) or app.is_assigned_worker_for_order(p_order)) then
    return;
  end if;
  return query select * from app._order_position(p_order);
end $$;

-- -----------------------------------------------------------------------------
-- 4. Record a collection (assigned delivery worker only)
-- -----------------------------------------------------------------------------
create or replace function app.record_delivery_collection(p_delivery uuid, p_amount numeric, p_method public.payment_method,
  p_reference text, p_note text, p_collected_at timestamptz, p_idempotency_key text) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_uid uuid := app.require_user();
  d public.deliveries;
  o public.orders;
  v_existing public.delivery_collections;
  v_pos record;
  v_payment uuid;
  v_payment_number text;
  v_number text;
  v_id uuid;
  v_at timestamptz := coalesce(p_collected_at, app.now());
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 90 then
    perform app.fail('VF422', 'A valid idempotency key is required');
  end if;
  select * into d from public.deliveries where id = p_delivery;
  if not found or d.assigned_worker_id is distinct from v_uid then
    perform app.fail('VF403', 'This delivery is not assigned to you');
  end if;
  perform app.require_active_company(d.wholesaler_id);

  -- Duplicate submissions (double tap, retry after a lost response) return the first record.
  perform pg_advisory_xact_lock(hashtextextended('collection:' || d.wholesaler_id::text || ':' || p_idempotency_key, 0));
  select * into v_existing from public.delivery_collections where wholesaler_id = d.wholesaler_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.delivery_id <> p_delivery then
      perform app.fail('VF409', 'This submission key was already used for another delivery');
    end if;
    return v_existing.id;
  end if;

  -- Serialize collections per order, then re-check the delivery under lock.
  select * into o from public.orders where id = d.order_id for update;
  select * into d from public.deliveries where id = p_delivery for update;
  if d.assigned_worker_id is distinct from v_uid then
    perform app.fail('VF403', 'This delivery is not assigned to you');
  end if;
  if d.status not in ('delivered', 'partially_delivered') then
    perform app.fail('VF409', 'Record the collection after the goods are delivered');
  end if;
  if p_method not in ('cash', 'upi') then
    perform app.fail('VF422', 'Delivery staff can record cash or UPI. Cheques and bank transfers are recorded by the office.');
  end if;
  if p_amount is null or p_amount < 0 or p_amount <> round(p_amount, 2) or p_amount > 100000000 then
    perform app.fail('VF422', 'Enter the amount collected in rupees and paise (0 if nothing was collected)');
  end if;
  if p_method = 'upi' and p_amount > 0 and nullif(trim(p_reference), '') is null then
    perform app.fail('VF422', 'Enter the UPI reference');
  end if;
  if v_at > app.now() + interval '5 minutes' then
    perform app.fail('VF422', 'Collection time cannot be in the future');
  end if;
  -- Times typed by hand have minute precision, so compare at that precision.
  if v_at < date_trunc('minute', o.placed_at) then
    perform app.fail('VF422', 'Collection time cannot be before the order was placed');
  end if;
  if p_amount = 0 and exists (select 1 from public.delivery_collections where delivery_id = p_delivery) then
    perform app.fail('VF409', 'A collection is already recorded for this delivery');
  end if;

  -- Lock the live invoice (if any) so the amount due cannot change underneath us.
  perform 1 from public.invoices where order_id = o.id and status = 'issued' for update;
  select * into v_pos from app._order_position(o.id);
  if p_amount > greatest(v_pos.balance_due, 0) then
    perform app.fail('VF422', format('Only Rs %s is due on order %s', greatest(v_pos.balance_due, 0), o.order_number));
  end if;

  if p_amount > 0 then
    v_payment_number := 'RCPT-' || lpad(app.next_number(d.wholesaler_id, 'payment')::text, 6, '0');
    insert into public.payments (payment_number, wholesaler_id, retailer_id, amount, method, reference, notes, received_at,
      idempotency_key, recorded_by, created_at)
    values (v_payment_number, d.wholesaler_id, o.retailer_id, p_amount, p_method, nullif(trim(p_reference), ''),
      left('Collected on delivery of order ' || o.order_number || coalesce('. ' || nullif(trim(p_note), ''), ''), 500),
      v_at, 'dc-' || p_idempotency_key, v_uid, app.now())
    returning id into v_payment;
    perform app._post_journal(d.wholesaler_id, (v_at at time zone 'Asia/Kolkata')::date, 'payment', v_payment,
      'Receipt ' || v_payment_number || ' collected on delivery of ' || o.order_number, jsonb_build_array(
        jsonb_build_object('account', case when p_method = 'cash' then 'CASH_IN_TRANSIT' else 'UPI' end, 'debit', p_amount),
        jsonb_build_object('account', 'AR', 'retailer_id', o.retailer_id, 'credit', p_amount)));
    -- Invoiced: apply to this order's invoice. Not invoiced yet: the payment
    -- stays unapplied (an advance, as in app.record_payment) and is applied
    -- automatically when this order's invoice is issued.
    if v_pos.invoice_id is not null then
      perform app._allocate(v_payment, v_pos.invoice_id, p_amount);
    end if;
  end if;

  v_number := 'COL-' || lpad(app.next_number(d.wholesaler_id, 'collection')::text, 6, '0');
  insert into public.delivery_collections (collection_number, wholesaler_id, retailer_id, order_id, delivery_id, worker_id,
    payment_id, payment_number, amount, method, reference, note, collected_at, order_value, payable_before, requires_handover,
    idempotency_key, recorded_by, created_at)
  values (v_number, d.wholesaler_id, o.retailer_id, o.id, d.id, v_uid, v_payment, v_payment_number, p_amount, p_method,
    nullif(trim(p_reference), ''), left(nullif(trim(p_note), ''), 500), v_at, v_pos.order_value, greatest(v_pos.balance_due, 0),
    p_method = 'cash' and p_amount > 0, p_idempotency_key, v_uid, app.now())
  returning id into v_id;

  insert into public.delivery_events (delivery_id, from_status, to_status, note, actor_id, created_at, details)
  values (d.id, d.status, d.status,
    case when p_amount = 0 then 'No payment collected (' || v_number || ')'
         else format('Collected Rs %s by %s (%s, receipt %s)', p_amount, p_method, v_number, v_payment_number) end,
    v_uid, app.now(), jsonb_build_object('collection_id', v_id, 'amount', p_amount, 'method', p_method, 'payment_id', v_payment));
  insert into public.order_events (order_id, event_type, note, actor_id, created_at)
  values (o.id, 'note', case when p_amount = 0 then 'Delivery staff collected no payment'
                             else format('Delivery staff collected Rs %s (%s)', p_amount, v_payment_number) end, v_uid, app.now());
  perform app.audit(d.wholesaler_id, 'collection.recorded', 'delivery_collection', v_id::text,
    jsonb_build_object('amount', p_amount, 'method', p_method, 'order_id', o.id, 'delivery_id', d.id, 'payment_id', v_payment,
                       'payable_before', v_pos.balance_due));
  if p_amount > 0 then
    perform app.notify_company(d.wholesaler_id, 'collection.recorded', format('Rs %s collected on %s', p_amount, o.order_number),
      format('%s, %s', (select name from public.companies where id = o.retailer_id), v_number), '/w/cash-collections/' || v_id);
  end if;
  return v_id;
end $$;

-- Delivery completion and collection in ONE transaction: if the collection is
-- rejected, the delivery is not marked delivered either. A retry with the same
-- key after success returns the first collection without touching the delivery.
create or replace function app.complete_delivery(p_delivery uuid, p_to public.delivery_status, p_note text,
  p_items jsonb, p_recipient text, p_empties int,
  p_amount numeric, p_method public.payment_method, p_reference text, p_collection_note text,
  p_collected_at timestamptz, p_idempotency_key text) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  d public.deliveries;
  v_existing uuid;
begin
  perform app.require_user();
  if p_to not in ('delivered', 'partially_delivered') then
    perform app.fail('VF422', 'Use this only to complete a delivery');
  end if;
  if p_amount is null then
    perform app.fail('VF422', 'Enter the amount collected (0 if nothing was collected)');
  end if;
  select * into d from public.deliveries where id = p_delivery;
  if not found or d.assigned_worker_id is distinct from auth.uid() then
    perform app.fail('VF403', 'This delivery is not assigned to you');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('collection:' || d.wholesaler_id::text || ':' || coalesce(p_idempotency_key, ''), 0));
  select id into v_existing from public.delivery_collections
   where wholesaler_id = d.wholesaler_id and idempotency_key = p_idempotency_key and delivery_id = p_delivery;
  if v_existing is not null then
    return v_existing;
  end if;
  perform app.update_delivery(p_delivery, p_to, p_note, null, p_items, p_recipient, p_empties);
  return app.record_delivery_collection(p_delivery, p_amount, p_method, p_reference, p_collection_note, p_collected_at, p_idempotency_key);
end $$;

-- When an order is invoiced, apply its unapplied delivery collections to it.
create or replace function app.apply_collections_to_invoice() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare c record; v_amount numeric;
begin
  if new.status <> 'issued' then
    return null;
  end if;
  for c in select dc.payment_id from public.delivery_collections dc
            join public.payments p on p.id = dc.payment_id
           where dc.order_id = new.order_id and dc.status = 'recorded' and p.status = 'posted'
           order by dc.collected_at, dc.id loop
    v_amount := least(app.payment_unapplied(c.payment_id), app.invoice_due(new.id));
    if v_amount > 0 then
      perform app._allocate(c.payment_id, new.id, v_amount);
    end if;
  end loop;
  return null;
end $$;
create trigger invoices_apply_collections after insert on public.invoices
  for each row execute function app.apply_collections_to_invoice();

-- -----------------------------------------------------------------------------
-- 5. Balances view
-- -----------------------------------------------------------------------------
create view public.delivery_collection_balances with (security_invoker = true) as
select c.id as collection_id, c.collection_number, c.wholesaler_id, c.retailer_id, c.order_id, c.delivery_id, c.worker_id,
       c.payment_id, c.payment_number, c.amount, c.method, c.reference, c.note, c.collected_at, c.order_value, c.payable_before,
       c.requires_handover, c.status, c.reversed_at, c.reversal_reason, c.recorded_by, c.created_at,
       coalesce(h.handed, 0) as handed_over,
       case when c.requires_handover and c.status = 'recorded' then c.amount - coalesce(h.handed, 0) else 0 end as pending_handover,
       case when c.status = 'reversed' then 'reversed'
            when c.amount = 0 then 'no_payment'
            when not c.requires_handover then 'not_required'
            when coalesce(h.handed, 0) = 0 then 'pending'
            when coalesce(h.handed, 0) < c.amount then 'partially_handed_over'
            else 'handed_over' end as handover_status
  from public.delivery_collections c
  left join (select i.collection_id, sum(i.amount) as handed
               from public.cash_handover_items i join public.cash_handovers ho on ho.id = i.handover_id
              where ho.status = 'confirmed' group by 1) h on h.collection_id = c.id;

-- -----------------------------------------------------------------------------
-- 6. Cash handover (owners and managers; never the worker themselves)
-- p_collections: null = all of the worker's pending cash collections.
-- p_expected: the total the user saw; refused if the pending cash changed.
-- The received cash is applied to the selected collections oldest first; any
-- shortfall stays pending on the remaining collections and is recorded as the
-- handover's discrepancy.
-- -----------------------------------------------------------------------------
create or replace function app.confirm_cash_handover(p_wholesaler uuid, p_worker uuid, p_collections uuid[],
  p_expected numeric, p_received numeric, p_note text, p_idempotency_key text) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_uid uuid := app.require_user();
  v_existing uuid;
  v_expected numeric := 0;
  v_left numeric;
  v_take numeric;
  v_id uuid;
  v_number text;
  c record;
  v_count int := 0;
begin
  if not app.can_manage(p_wholesaler) then
    perform app.fail('VF403', 'Only owners and managers can confirm cash handovers');
  end if;
  perform app.require_active_company(p_wholesaler);
  if p_worker = v_uid then
    perform app.fail('VF403', 'You cannot confirm a handover of cash you collected yourself');
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    perform app.fail('VF422', 'A valid idempotency key is required');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('handover:' || p_wholesaler::text || ':' || p_idempotency_key, 0));
  select id into v_existing from public.cash_handovers where wholesaler_id = p_wholesaler and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;
  -- One handover at a time per worker, so two people cannot reconcile the same cash.
  perform pg_advisory_xact_lock(hashtextextended('handover-worker:' || p_wholesaler::text || ':' || p_worker::text, 0));

  if p_received is null or p_received <= 0 or p_received <> round(p_received, 2) then
    perform app.fail('VF422', 'Enter the cash received in rupees and paise');
  end if;
  if p_collections is not null and exists (
       select 1 from unnest(p_collections) x(id)
        where not exists (select 1 from public.delivery_collections dc
                           where dc.id = x.id and dc.wholesaler_id = p_wholesaler and dc.worker_id = p_worker)) then
    perform app.fail('VF422', 'A selected collection does not belong to this delivery person');
  end if;
  perform 1 from public.delivery_collections dc
   where dc.wholesaler_id = p_wholesaler and dc.worker_id = p_worker
     and (p_collections is null or dc.id = any (p_collections))
   order by dc.id for update;

  for c in select b.collection_id, b.pending_handover from public.delivery_collection_balances b
            where b.wholesaler_id = p_wholesaler and b.worker_id = p_worker and b.pending_handover > 0
              and (p_collections is null or b.collection_id = any (p_collections)) loop
    v_expected := v_expected + c.pending_handover;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    perform app.fail('VF409', 'There is no cash pending handover for the selected collections');
  end if;
  if p_collections is not null and v_count <> cardinality(p_collections) then
    perform app.fail('VF409', 'Some selected collections are already handed over. Reload the page and try again.');
  end if;
  if p_expected is null or p_expected <> v_expected then
    perform app.fail('VF409', format('The cash pending is now Rs %s. Reload the page and try again.', v_expected));
  end if;
  if p_received > v_expected then
    perform app.fail('VF422', format('Cash received cannot be more than the Rs %s expected', v_expected));
  end if;

  v_number := 'HO-' || lpad(app.next_number(p_wholesaler, 'handover')::text, 6, '0');
  insert into public.cash_handovers (handover_number, wholesaler_id, worker_id, expected_amount, received_amount, discrepancy,
    note, received_by, received_at, idempotency_key, created_at)
  values (v_number, p_wholesaler, p_worker, v_expected, p_received, v_expected - p_received, left(nullif(trim(p_note), ''), 500),
    v_uid, app.now(), p_idempotency_key, app.now())
  returning id into v_id;

  v_left := p_received;
  for c in select b.collection_id, b.pending_handover from public.delivery_collection_balances b
            where b.wholesaler_id = p_wholesaler and b.worker_id = p_worker and b.pending_handover > 0
              and (p_collections is null or b.collection_id = any (p_collections))
            order by b.collected_at, b.collection_id loop
    exit when v_left <= 0;
    v_take := least(v_left, c.pending_handover);
    insert into public.cash_handover_items (handover_id, collection_id, wholesaler_id, amount)
    values (v_id, c.collection_id, p_wholesaler, v_take);
    v_left := v_left - v_take;
  end loop;

  perform app._post_journal(p_wholesaler, app.today(), 'cash_handover', v_id, 'Cash handover ' || v_number, jsonb_build_array(
    jsonb_build_object('account', 'CASH', 'debit', p_received),
    jsonb_build_object('account', 'CASH_IN_TRANSIT', 'credit', p_received)));
  perform app.audit(p_wholesaler, 'cash_handover.confirmed', 'cash_handover', v_id::text,
    jsonb_build_object('worker_id', p_worker, 'expected', v_expected, 'received', p_received,
                       'discrepancy', v_expected - p_received, 'collections', v_count));
  insert into public.notifications (user_id, company_id, kind, title, body, link, created_at)
  values (p_worker, p_wholesaler, 'cash_handover.confirmed', format('Cash handover %s confirmed', v_number),
    format('Rs %s received of Rs %s', p_received, v_expected), '/d/cash', app.now());
  return v_id;
end $$;

-- Correct a handover entered by mistake. Keeps the record; its cash becomes pending again.
create or replace function app.reverse_cash_handover(p_handover uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare h public.cash_handovers;
begin
  perform app.require_user();
  select * into h from public.cash_handovers where id = p_handover for update;
  if not found or not app.can_manage(h.wholesaler_id) then
    perform app.fail('VF403', 'Only owners and managers can reverse handovers');
  end if;
  if h.status = 'reversed' then
    perform app.fail('VF409', 'This handover has already been reversed');
  end if;
  if nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) < 3 then
    perform app.fail('VF422', 'Give a reason for the reversal');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('handover-worker:' || h.wholesaler_id::text || ':' || h.worker_id::text, 0));
  update public.cash_handovers set status = 'reversed', reversed_by = auth.uid(), reversed_at = app.now(),
         reversal_reason = left(trim(p_reason), 500) where id = p_handover;
  perform app._post_journal(h.wholesaler_id, app.today(), 'cash_handover_reversal', p_handover, 'Reversal of ' || h.handover_number,
    jsonb_build_array(
      jsonb_build_object('account', 'CASH_IN_TRANSIT', 'debit', h.received_amount),
      jsonb_build_object('account', 'CASH', 'credit', h.received_amount)));
  perform app.audit(h.wholesaler_id, 'cash_handover.reversed', 'cash_handover', p_handover::text,
    jsonb_build_object('received', h.received_amount, 'reason', p_reason));
end $$;

-- -----------------------------------------------------------------------------
-- 7. Payment reversal, extended for collection payments (body otherwise as in
--    migration 0600). A collection's cash is credited back to CASH_IN_TRANSIT,
--    and cash already handed over must have its handover reversed first.
-- -----------------------------------------------------------------------------
create or replace function app.reverse_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  p public.payments;
  a public.payment_allocations;
  dc public.delivery_collections;
  v_account text;
begin
  perform app.require_user();
  select * into p from public.payments where id = p_payment for update;
  if not found or not app.can_manage(p.wholesaler_id) then
    perform app.fail('VF403', 'Only owners and managers can reverse payments');
  end if;
  if p.status = 'reversed' then
    perform app.fail('VF409', 'This payment has already been reversed');
  end if;
  if nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) < 3 then
    perform app.fail('VF422', 'Give a reason for the reversal');
  end if;
  v_account := upper(case p.method when 'bank_transfer' then 'bank' else p.method::text end);
  select * into dc from public.delivery_collections where payment_id = p_payment for update;
  if found then
    perform pg_advisory_xact_lock(hashtextextended('handover-worker:' || dc.wholesaler_id::text || ':' || dc.worker_id::text, 0));
    if exists (select 1 from public.cash_handover_items i join public.cash_handovers h on h.id = i.handover_id
                where i.collection_id = dc.id and h.status = 'confirmed') then
      perform app.fail('VF409', 'Part of this cash has already been handed over. Reverse that handover first.');
    end if;
    if dc.requires_handover then
      v_account := 'CASH_IN_TRANSIT';
    end if;
    update public.delivery_collections set status = 'reversed', reversed_at = app.now(), reversal_reason = left(trim(p_reason), 500)
     where id = dc.id;
  end if;
  insert into public.payment_reversals (payment_id, reason, reversed_by, reversed_at)
  values (p_payment, trim(p_reason), auth.uid(), app.now());
  for a in select * from public.payment_allocations x
            where x.payment_id = p_payment and x.amount > 0
              and not exists (select 1 from public.payment_allocations r where r.reversal_of = x.id) loop
    insert into public.payment_allocations (payment_id, invoice_id, wholesaler_id, amount, reversal_of, created_by, created_at)
    values (p_payment, a.invoice_id, a.wholesaler_id, -a.amount, a.id, auth.uid(), app.now());
  end loop;
  update public.payments set status = 'reversed' where id = p_payment;
  perform app._post_journal(p.wholesaler_id, app.today(), 'payment_reversal', p_payment, 'Reversal of ' || p.payment_number,
    jsonb_build_array(
      jsonb_build_object('account', 'AR', 'retailer_id', p.retailer_id, 'debit', p.amount),
      jsonb_build_object('account', v_account, 'credit', p.amount)));
  perform app.audit(p.wholesaler_id, 'payment.reversed', 'payment', p_payment::text,
    jsonb_build_object('amount', p.amount, 'reason', p_reason));
end $$;

-- -----------------------------------------------------------------------------
-- 8. Grants and Row-Level Security. Reads only; every write goes through the
--    functions above.
-- -----------------------------------------------------------------------------
alter table public.delivery_collections enable row level security;
alter table public.cash_handovers enable row level security;
alter table public.cash_handover_items enable row level security;

revoke all on public.delivery_collections, public.cash_handovers, public.cash_handover_items,
  public.delivery_collection_balances from anon, authenticated;
grant select on public.delivery_collections, public.cash_handovers, public.cash_handover_items,
  public.delivery_collection_balances to authenticated;

-- Office staff of the wholesaler, and the worker who collected. Nobody else.
create policy delivery_collections_select on public.delivery_collections for select to authenticated
  using (app.is_staff(wholesaler_id) or worker_id = auth.uid());
create policy cash_handovers_select on public.cash_handovers for select to authenticated
  using (app.is_staff(wholesaler_id) or worker_id = auth.uid());
create policy cash_handover_items_select on public.cash_handover_items for select to authenticated
  using (exists (select 1 from public.cash_handovers h where h.id = handover_id
                  and (app.is_staff(h.wholesaler_id) or h.worker_id = auth.uid())));

-- New functions are executable by PUBLIC by default (and Supabase adds default
-- grants for anon/authenticated), so revoke everything first, as migration 0800 does.
revoke all on function app._order_billable(uuid), app._order_position(uuid), app.apply_collections_to_invoice(),
  app.delivery_collections_guard(), app.cash_handovers_guard(), app.order_position(uuid),
  app.record_delivery_collection(uuid, numeric, public.payment_method, text, text, timestamptz, text),
  app.complete_delivery(uuid, public.delivery_status, text, jsonb, text, int, numeric, public.payment_method, text, text, timestamptz, text),
  app.confirm_cash_handover(uuid, uuid, uuid[], numeric, numeric, text, text),
  app.reverse_cash_handover(uuid, text)
from public, anon, authenticated;
grant execute on function
  app.order_position(uuid),
  app.record_delivery_collection(uuid, numeric, public.payment_method, text, text, timestamptz, text),
  app.complete_delivery(uuid, public.delivery_status, text, jsonb, text, int, numeric, public.payment_method, text, text, timestamptz, text),
  app.confirm_cash_handover(uuid, uuid, uuid[], numeric, numeric, text, text),
  app.reverse_cash_handover(uuid, text)
to authenticated;
