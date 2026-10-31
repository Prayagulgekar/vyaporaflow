-- =============================================================================
-- 0600 Invoices, credit notes, payments, allocations, reversals and ledger
-- =============================================================================

create or replace function app._post_journal(p_company uuid, p_date date, p_source_type text, p_source_id uuid,
  p_memo text, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid; l jsonb;
begin
  insert into public.journal_entries (company_id, entry_date, source_type, source_id, memo, created_by, created_at)
  values (p_company, p_date, p_source_type, p_source_id, p_memo, auth.uid(), app.now())
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l ->> 'debit')::numeric, 0) <> 0 or coalesce((l ->> 'credit')::numeric, 0) <> 0 then
      insert into public.journal_lines (journal_id, company_id, account_code, retailer_id, debit, credit)
      values (v_id, p_company, l ->> 'account', nullif(l ->> 'retailer_id', '')::uuid,
              coalesce((l ->> 'debit')::numeric, 0), coalesce((l ->> 'credit')::numeric, 0));
    end if;
  end loop;
  return v_id;
end $$;

create or replace function app.invoice_due(p_invoice uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select i.grand_total
         - coalesce((select sum(amount) from public.credit_notes c where c.invoice_id = i.id), 0)
         - coalesce((select sum(amount) from public.payment_allocations a where a.invoice_id = i.id), 0)
    from public.invoices i where i.id = p_invoice
$$;

create or replace function app.payment_unapplied(p_payment uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p.status = 'reversed' then 0
              else p.amount - coalesce((select sum(amount) from public.payment_allocations a where a.payment_id = p.id), 0) end
    from public.payments p where p.id = p_payment
$$;

create or replace function app.address_snapshot(p_company uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('name', c.name, 'gstin', c.gstin, 'phone', c.phone,
    'line1', a.line1, 'line2', a.line2, 'city', a.city, 'state_code', a.state_code, 'pincode', a.pincode,
    'state_name', s.name)
    from public.companies c
    left join public.business_addresses a on a.company_id = c.id and a.is_primary
    left join public.indian_states s on s.code = a.state_code
   where c.id = p_company
$$;

-- -----------------------------------------------------------------------------
-- Generate the invoice for an order. Idempotent: returns the live invoice if
-- one exists. Totals come from the order's line snapshots (delivered
-- quantities when the order was partially delivered), never from the client.
-- GST: CGST+SGST when seller state = place of supply, otherwise IGST.
-- -----------------------------------------------------------------------------
create or replace function app.generate_invoice(p_order uuid, p_due_days int default null) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_uid uuid := app.require_user();
  o public.orders;
  v_existing uuid;
  v_inv uuid;
  v_seller jsonb;
  v_buyer jsonb;
  v_intra boolean;
  v_date date := app.today();
  v_terms int;
  it public.order_items;
  v_qty numeric;
  c record;
  v_cgst numeric; v_sgst numeric; v_igst numeric;
  t_sub numeric := 0; t_disc numeric := 0; t_taxable numeric := 0; t_cgst numeric := 0; t_sgst numeric := 0; t_igst numeric := 0;
  v_line int := 0;
  v_number text;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not app.is_staff(o.wholesaler_id) then
    perform app.fail('VF403', 'Only the wholesaler''s staff can invoice this order');
  end if;
  perform app.require_active_company(o.wholesaler_id);
  select id into v_existing from public.invoices where order_id = p_order and status = 'issued';
  if v_existing is not null then
    return v_existing;
  end if;
  if o.status in ('placed', 'cancelled') then
    perform app.fail('VF409', 'Accept the order before invoicing it');
  end if;
  if p_due_days is not null and (p_due_days < 0 or p_due_days > 180) then
    perform app.fail('VF422', 'Payment terms must be between 0 and 180 days');
  end if;

  v_seller := app.address_snapshot(o.wholesaler_id);
  v_buyer := app.address_snapshot(o.retailer_id) || jsonb_build_object('delivery_address', o.delivery_address);
  if v_seller ->> 'state_code' is null then
    perform app.fail('VF422', 'Add your business address before invoicing');
  end if;
  v_intra := (v_seller ->> 'state_code') = o.place_of_supply;
  select payment_terms_days into v_terms from public.wholesaler_profiles where company_id = o.wholesaler_id;
  -- Pass 1: totals from the line snapshots.
  for it in select * from public.order_items where order_id = o.id order by line_no loop
    v_qty := case when o.partially_delivered then coalesce(it.delivered_quantity, it.quantity) else it.quantity end;
    continue when v_qty = 0;
    select * into c from app.calc_line(v_qty, it.unit_price, it.discount_percent, it.tax_rate, it.price_includes_tax);
    if v_intra then
      v_cgst := round(c.tax_amount / 2, 2); v_sgst := c.tax_amount - v_cgst; v_igst := 0;
    else
      v_cgst := 0; v_sgst := 0; v_igst := c.tax_amount;
    end if;
    v_line := v_line + 1;
    t_sub := t_sub + c.line_amount; t_disc := t_disc + c.discount_amount; t_taxable := t_taxable + c.taxable_amount;
    t_cgst := t_cgst + v_cgst; t_sgst := t_sgst + v_sgst; t_igst := t_igst + v_igst;
  end loop;
  if v_line = 0 then
    perform app.fail('VF409', 'Nothing was delivered on this order, so there is nothing to invoice');
  end if;

  v_number := 'INV/' || app.fy_label(v_date) || '/' ||
              lpad(app.next_number(o.wholesaler_id, 'invoice:' || app.fy_label(v_date))::text, 5, '0');
  insert into public.invoices (invoice_number, wholesaler_id, retailer_id, order_id, invoice_date, due_date, supply_type,
    place_of_supply, seller, buyer, subtotal, discount_total, taxable_total, cgst_total, sgst_total, igst_total,
    tax_total, delivery_charge, grand_total, created_by, created_at)
  values (v_number, o.wholesaler_id, o.retailer_id, o.id, v_date, v_date + coalesce(p_due_days, v_terms, 15),
    case when v_intra then 'intra_state' else 'inter_state' end, o.place_of_supply, v_seller, v_buyer,
    t_sub, t_disc, t_taxable, t_cgst, t_sgst, t_igst, t_cgst + t_sgst + t_igst, o.delivery_charge,
    t_taxable + t_cgst + t_sgst + t_igst + o.delivery_charge, v_uid, app.now())
  returning id into v_inv;

  -- Pass 2: line rows.
  v_line := 0;
  for it in select * from public.order_items where order_id = o.id order by line_no loop
    v_qty := case when o.partially_delivered then coalesce(it.delivered_quantity, it.quantity) else it.quantity end;
    continue when v_qty = 0;
    select * into c from app.calc_line(v_qty, it.unit_price, it.discount_percent, it.tax_rate, it.price_includes_tax);
    if v_intra then
      v_cgst := round(c.tax_amount / 2, 2); v_sgst := c.tax_amount - v_cgst; v_igst := 0;
    else
      v_cgst := 0; v_sgst := 0; v_igst := c.tax_amount;
    end if;
    v_line := v_line + 1;
    insert into public.invoice_items (invoice_id, order_item_id, line_no, description, hsn_code, quantity, unit_code,
      unit_price, discount_amount, taxable_amount, tax_rate, cgst_amount, sgst_amount, igst_amount, line_total)
    values (v_inv, it.id, v_line, it.product_name || ' ' || it.variant_name, it.hsn_code, v_qty, it.unit_code,
      it.unit_price, c.discount_amount, c.taxable_amount, it.tax_rate, v_cgst, v_sgst, v_igst, c.line_total);
  end loop;

  perform app._post_journal(o.wholesaler_id, v_date, 'invoice', v_inv, 'Invoice ' || v_number, jsonb_build_array(
    jsonb_build_object('account', 'AR', 'retailer_id', o.retailer_id, 'debit', t_taxable + t_cgst + t_sgst + t_igst + o.delivery_charge),
    jsonb_build_object('account', 'SALES', 'credit', t_taxable),
    jsonb_build_object('account', 'OUTPUT_CGST', 'credit', t_cgst),
    jsonb_build_object('account', 'OUTPUT_SGST', 'credit', t_sgst),
    jsonb_build_object('account', 'OUTPUT_IGST', 'credit', t_igst),
    jsonb_build_object('account', 'DELIVERY_INCOME', 'credit', o.delivery_charge)));

  insert into public.order_events (order_id, event_type, note, actor_id, created_at)
  values (o.id, 'invoice_issued', 'Invoice ' || v_number, v_uid, app.now());
  perform app.notify_company(o.retailer_id, 'invoice.issued', format('Invoice %s issued', v_number),
    format('Amount Rs %s', t_taxable + t_cgst + t_sgst + t_igst + o.delivery_charge), '/r/invoices/' || v_inv);
  return v_inv;
end $$;

create or replace function app.void_invoice(p_invoice uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare i public.invoices;
begin
  perform app.require_user();
  select * into i from public.invoices where id = p_invoice for update;
  if not found or not app.can_manage(i.wholesaler_id) then
    perform app.fail('VF403', 'Only owners and managers can void invoices');
  end if;
  if i.status = 'void' then
    perform app.fail('VF409', 'This invoice is already void');
  end if;
  if nullif(trim(p_reason), '') is null then
    perform app.fail('VF422', 'Give a reason for voiding the invoice');
  end if;
  if coalesce((select sum(amount) from public.payment_allocations where invoice_id = i.id), 0) <> 0
     or exists (select 1 from public.credit_notes where invoice_id = i.id) then
    perform app.fail('VF409', 'Remove payment allocations (reverse payments) before voiding; invoices with credit notes cannot be voided');
  end if;
  update public.invoices set status = 'void', void_reason = left(p_reason, 500), voided_at = app.now() where id = i.id;
  perform app._post_journal(i.wholesaler_id, app.today(), 'invoice_void', i.id, 'Void ' || i.invoice_number, jsonb_build_array(
    jsonb_build_object('account', 'AR', 'retailer_id', i.retailer_id, 'credit', i.grand_total),
    jsonb_build_object('account', 'SALES', 'debit', i.taxable_total),
    jsonb_build_object('account', 'OUTPUT_CGST', 'debit', i.cgst_total),
    jsonb_build_object('account', 'OUTPUT_SGST', 'debit', i.sgst_total),
    jsonb_build_object('account', 'OUTPUT_IGST', 'debit', i.igst_total),
    jsonb_build_object('account', 'DELIVERY_INCOME', 'debit', i.delivery_charge)));
  perform app.audit(i.wholesaler_id, 'invoice.voided', 'invoice', i.id::text, jsonb_build_object('reason', p_reason));
end $$;

-- Internal credit note issue (no auth). Amount may not exceed what is due.
create or replace function app._issue_credit_note(p_invoice uuid, p_taxable numeric, p_tax numeric, p_kind text, p_reason text)
returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  i public.invoices;
  v_id uuid;
  v_number text;
  v_cgst numeric := 0; v_sgst numeric := 0; v_igst numeric := 0;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if i.status <> 'issued' then
    perform app.fail('VF409', 'Credit notes can only be issued against live invoices');
  end if;
  if p_taxable < 0 or p_tax < 0 or p_taxable + p_tax <= 0 then
    perform app.fail('VF422', 'Credit note amount must be positive');
  end if;
  if p_taxable + p_tax > app.invoice_due(p_invoice) then
    perform app.fail('VF409', format('Credit note exceeds the amount due on %s (Rs %s). Reverse payments first if a refund is needed.',
      i.invoice_number, app.invoice_due(p_invoice)));
  end if;
  if i.supply_type = 'intra_state' then
    v_cgst := round(p_tax / 2, 2); v_sgst := p_tax - v_cgst;
  else
    v_igst := p_tax;
  end if;
  v_number := 'CN/' || app.fy_label(app.today()) || '/' ||
              lpad(app.next_number(i.wholesaler_id, 'credit_note:' || app.fy_label(app.today()))::text, 5, '0');
  insert into public.credit_notes (credit_note_number, wholesaler_id, retailer_id, invoice_id, kind, reason,
    taxable_amount, tax_amount, amount, issued_on, created_by, created_at)
  values (v_number, i.wholesaler_id, i.retailer_id, i.id, p_kind, left(p_reason, 500), p_taxable, p_tax,
    p_taxable + p_tax, app.today(), auth.uid(), app.now())
  returning id into v_id;
  perform app._post_journal(i.wholesaler_id, app.today(), 'credit_note', v_id, 'Credit note ' || v_number, jsonb_build_array(
    jsonb_build_object('account', 'SALES_RETURNS', 'debit', p_taxable),
    jsonb_build_object('account', 'OUTPUT_CGST', 'debit', v_cgst),
    jsonb_build_object('account', 'OUTPUT_SGST', 'debit', v_sgst),
    jsonb_build_object('account', 'OUTPUT_IGST', 'debit', v_igst),
    jsonb_build_object('account', 'AR', 'retailer_id', i.retailer_id, 'credit', p_taxable + p_tax)));
  insert into public.order_events (order_id, event_type, note, actor_id, created_at)
  values (i.order_id, 'credit_note_issued', 'Credit note ' || v_number || ' for Rs ' || (p_taxable + p_tax), auth.uid(), app.now());
  return v_id;
end $$;

-- Manual credit note for an amount including tax; the tax portion is split
-- in proportion to the invoice's tax share of its taxable + tax value.
create or replace function app.create_credit_note(p_invoice uuid, p_amount numeric, p_kind text, p_reason text) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare i public.invoices; v_tax numeric;
begin
  perform app.require_user();
  select * into i from public.invoices where id = p_invoice;
  if not found or not app.can_manage(i.wholesaler_id) then
    perform app.fail('VF403', 'Only owners and managers can issue credit notes');
  end if;
  if p_kind not in ('return', 'discount', 'correction') then
    perform app.fail('VF422', 'Choose a credit note type');
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    perform app.fail('VF422', 'Enter a positive amount in rupees and paise');
  end if;
  v_tax := case when i.taxable_total + i.tax_total = 0 then 0
                else round(p_amount * i.tax_total / (i.taxable_total + i.tax_total), 2) end;
  return app._issue_credit_note(p_invoice, p_amount - v_tax, v_tax, p_kind, p_reason);
end $$;

-- -----------------------------------------------------------------------------
-- Payments
-- -----------------------------------------------------------------------------
create or replace function app._allocate(p_payment uuid, p_invoice uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  p public.payments;
  i public.invoices;
begin
  select * into p from public.payments where id = p_payment for update;
  select * into i from public.invoices where id = p_invoice for update;
  if i.id is null or i.wholesaler_id <> p.wholesaler_id or i.retailer_id <> p.retailer_id then
    perform app.fail('VF422', 'The invoice does not belong to this retailer');
  end if;
  if p.status <> 'posted' or i.status <> 'issued' then
    perform app.fail('VF409', 'Only posted payments can be applied to live invoices');
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    perform app.fail('VF422', 'Allocation amount must be positive');
  end if;
  if p_amount > app.payment_unapplied(p_payment) then
    perform app.fail('VF409', format('Only Rs %s of this payment is unapplied', app.payment_unapplied(p_payment)));
  end if;
  if p_amount > app.invoice_due(p_invoice) then
    perform app.fail('VF409', format('Invoice %s has only Rs %s due', i.invoice_number, app.invoice_due(p_invoice)));
  end if;
  insert into public.payment_allocations (payment_id, invoice_id, wholesaler_id, amount, created_by, created_at)
  values (p_payment, p_invoice, p.wholesaler_id, p_amount, auth.uid(), app.now());
  insert into public.order_events (order_id, event_type, note, actor_id, created_at)
  values (i.order_id, 'payment_applied', format('Payment %s: Rs %s applied to %s', p.payment_number, p_amount, i.invoice_number),
          auth.uid(), app.now());
end $$;

-- Record money received from a retailer. Idempotent per (wholesaler, key).
-- p_allocations: null = apply automatically to the oldest open invoices;
-- '[]' = leave unapplied (advance); otherwise [{"invoice_id", "amount"}].
create or replace function app.record_payment(p_wholesaler uuid, p_retailer uuid, p_amount numeric,
  p_method public.payment_method, p_reference text, p_received_at timestamptz, p_notes text,
  p_idempotency_key text, p_allocations jsonb default null) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_uid uuid := app.require_user();
  v_existing uuid;
  v_payment uuid;
  v_number text;
  v_remaining numeric;
  v_due numeric;
  inv record;
  a jsonb;
begin
  if not app.is_staff(p_wholesaler) then
    perform app.fail('VF403', 'Only the wholesaler''s staff can record payments');
  end if;
  perform app.require_active_company(p_wholesaler);
  if not exists (select 1 from public.retailer_wholesaler_relationships where wholesaler_id = p_wholesaler and retailer_id = p_retailer) then
    perform app.fail('VF422', 'This retailer is not one of your customers');
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount > 100000000 then
    perform app.fail('VF422', 'Enter a valid amount in rupees and paise');
  end if;
  if p_received_at is null or p_received_at > app.now() + interval '1 day' then
    perform app.fail('VF422', 'Payment date cannot be in the future');
  end if;
  if p_method in ('upi', 'bank_transfer', 'cheque') and nullif(trim(p_reference), '') is null then
    perform app.fail('VF422', 'Enter the UPI, bank or cheque reference');
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    perform app.fail('VF422', 'A valid idempotency key is required');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payment:' || p_wholesaler::text || ':' || p_idempotency_key, 0));
  select id into v_existing from public.payments where wholesaler_id = p_wholesaler and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Serialize allocations for this customer.
  perform 1 from public.invoices where wholesaler_id = p_wholesaler and retailer_id = p_retailer and status = 'issued'
   order by id for update;

  v_number := 'RCPT-' || lpad(app.next_number(p_wholesaler, 'payment')::text, 6, '0');
  insert into public.payments (payment_number, wholesaler_id, retailer_id, amount, method, reference, notes, received_at,
    idempotency_key, recorded_by, created_at)
  values (v_number, p_wholesaler, p_retailer, p_amount, p_method, nullif(trim(p_reference), ''), left(p_notes, 500),
    p_received_at, p_idempotency_key, v_uid, app.now())
  returning id into v_payment;

  perform app._post_journal(p_wholesaler, (p_received_at at time zone 'Asia/Kolkata')::date, 'payment', v_payment,
    'Receipt ' || v_number, jsonb_build_array(
      jsonb_build_object('account', upper(case p_method when 'bank_transfer' then 'bank' else p_method::text end), 'debit', p_amount),
      jsonb_build_object('account', 'AR', 'retailer_id', p_retailer, 'credit', p_amount)));

  if p_allocations is null then
    v_remaining := p_amount;
    for inv in select id from public.invoices
                where wholesaler_id = p_wholesaler and retailer_id = p_retailer and status = 'issued'
                order by due_date, invoice_date, invoice_number loop
      exit when v_remaining <= 0;
      v_due := app.invoice_due(inv.id);
      continue when v_due <= 0;
      perform app._allocate(v_payment, inv.id, least(v_due, v_remaining));
      v_remaining := v_remaining - least(v_due, v_remaining);
    end loop;
  else
    if jsonb_typeof(p_allocations) <> 'array' then
      perform app.fail('VF422', 'Allocations must be a list');
    end if;
    for a in select * from jsonb_array_elements(p_allocations) loop
      perform app._allocate(v_payment, (a ->> 'invoice_id')::uuid, (a ->> 'amount')::numeric);
    end loop;
  end if;

  perform app.audit(p_wholesaler, 'payment.recorded', 'payment', v_payment::text,
    jsonb_build_object('amount', p_amount, 'method', p_method, 'retailer_id', p_retailer));
  perform app.notify_company(p_retailer, 'payment.recorded', format('Payment %s recorded', v_number),
    format('Rs %s received by %s', p_amount, (select name from public.companies where id = p_wholesaler)), '/r/payments');
  return v_payment;
end $$;

create or replace function app.allocate_payment(p_payment uuid, p_invoice uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_company uuid;
begin
  perform app.require_user();
  select wholesaler_id into v_company from public.payments where id = p_payment;
  if v_company is null or not app.is_staff(v_company) then
    perform app.fail('VF403', 'You cannot apply this payment');
  end if;
  perform app._allocate(p_payment, p_invoice, p_amount);
end $$;

-- Reversal keeps history: adds a reversal record, negative allocation rows and
-- a reversing journal. The original payment row is only flagged as reversed.
create or replace function app.reverse_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  p public.payments;
  a public.payment_allocations;
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
      jsonb_build_object('account', upper(case p.method when 'bank_transfer' then 'bank' else p.method::text end), 'credit', p.amount)));
  perform app.audit(p.wholesaler_id, 'payment.reversed', 'payment', p_payment::text,
    jsonb_build_object('amount', p.amount, 'reason', p_reason));
end $$;

-- Receivable reconciliation: ledger AR balance vs document-derived balance.
create or replace function app.reconcile_receivables(p_wholesaler uuid)
returns table (retailer_id uuid, ledger_balance numeric, document_balance numeric, difference numeric)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_staff(p_wholesaler) or app.is_platform_admin()) then
    perform app.fail('VF403', 'Not allowed');
  end if;
  return query
  with ledger as (
    select l.retailer_id, sum(l.debit - l.credit) as bal
      from public.journal_lines l where l.company_id = p_wholesaler and l.account_code = 'AR' group by 1
  ), docs as (
    select r.retailer_id,
      coalesce((select sum(grand_total) from public.invoices i where i.wholesaler_id = p_wholesaler and i.retailer_id = r.retailer_id and i.status = 'issued'), 0)
      - coalesce((select sum(amount) from public.credit_notes c where c.wholesaler_id = p_wholesaler and c.retailer_id = r.retailer_id), 0)
      - coalesce((select sum(amount) from public.payments p where p.wholesaler_id = p_wholesaler and p.retailer_id = r.retailer_id and p.status = 'posted'), 0)
      as bal
    from public.retailer_wholesaler_relationships r where r.wholesaler_id = p_wholesaler
  )
  select d.retailer_id, coalesce(l.bal, 0), d.bal, coalesce(l.bal, 0) - d.bal
    from docs d left join ledger l on l.retailer_id = d.retailer_id;
end $$;
