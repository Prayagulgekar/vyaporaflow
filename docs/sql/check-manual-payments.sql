-- =============================================================================
-- READ-ONLY checks for one retailer's payments, invoices and deliveries.
-- Run in the Supabase dashboard: SQL Editor > New query. Paste ONE query at a
-- time and click Run. Every query is a SELECT: nothing is changed.
-- Change 'Ulgekar' to part of the shop's name if needed.
-- =============================================================================

-- 1. The shop's payments: amount, applied, not yet applied, who recorded it.
select p.payment_number, p.amount, p.method, p.received_at, p.status, p.notes,
       pb.allocated as applied_to_invoices, pb.unapplied as not_yet_applied,
       pr.full_name as recorded_by, p.created_at
  from public.payments p
  join public.payment_balances pb on pb.payment_id = p.id
  join public.companies c on c.id = p.retailer_id
  left join public.profiles pr on pr.id = p.recorded_by
 where c.name ilike '%Ulgekar%'
 order by p.received_at;

-- 2. Is any of it applied to an invoice? (No rows = not applied anywhere.)
select p.payment_number, i.invoice_number, a.amount, a.created_at
  from public.payment_allocations a
  join public.payments p on p.id = a.payment_id
  join public.invoices i on i.id = a.invoice_id
  join public.companies c on c.id = p.retailer_id
 where c.name ilike '%Ulgekar%';

-- 3. The shop's orders: total, delivery, who delivered, invoice (if any).
select o.order_number, o.grand_total, o.status as order_status, d.status as delivery_status,
       d.delivered_at, w.full_name as delivered_by, i.invoice_number, i.status as invoice_status,
       d.notes as delivery_note
  from public.orders o
  join public.companies c on c.id = o.retailer_id
  left join public.deliveries d on d.order_id = o.id
  left join public.profiles w on w.id = d.assigned_worker_id
  left join public.invoices i on i.order_id = o.id
 where c.name ilike '%Ulgekar%'
 order by o.placed_at;

-- 4. The Balances page figures for the shop.
select c.name, rb.invoiced, rb.credited, rb.received, rb.outstanding, rb.unapplied
  from public.retailer_balances rb
  join public.companies c on c.id = rb.retailer_id
 where c.name ilike '%Ulgekar%';

-- 5. The ledger entry the payment posted (expect: debit CASH, credit AR).
select p.payment_number, je.source_type, jl.account_code, jl.debit, jl.credit
  from public.payments p
  join public.companies c on c.id = p.retailer_id
  join public.journal_entries je on je.source_type in ('payment', 'payment_reversal') and je.source_id = p.id
  join public.journal_lines jl on jl.journal_id = je.id
 where c.name ilike '%Ulgekar%'
 order by p.payment_number, je.created_at, jl.id;

-- 6. Delivery history notes that mention money (notes are text, not payments).
select o.order_number, e.created_at, e.to_status, e.note
  from public.delivery_events e
  join public.deliveries d on d.id = e.delivery_id
  join public.orders o on o.id = d.order_id
  join public.companies c on c.id = o.retailer_id
 where c.name ilike '%Ulgekar%' and e.note is not null
 order by e.created_at;

-- 7. ONLY AFTER applying migration 20261029000100: is a payment linked to a
--    delivery collection? (No rows = recorded by the office, not on a delivery.)
select p.payment_number, dc.collection_number, dc.amount, w.full_name as collected_by
  from public.delivery_collections dc
  join public.payments p on p.id = dc.payment_id
  join public.companies c on c.id = dc.retailer_id
  left join public.profiles w on w.id = dc.worker_id
 where c.name ilike '%Ulgekar%';
