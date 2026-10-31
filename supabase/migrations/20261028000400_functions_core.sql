-- =============================================================================
-- 0400 Trusted business functions: onboarding, team, relationships, inventory
--
-- Every function here is SECURITY DEFINER and performs its own authorization
-- from auth.uid() and company memberships. Client-supplied company ids are
-- always checked against the caller's memberships before use.
-- =============================================================================

create or replace function app.slugify(p text) returns text
language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'))
$$;

-- -----------------------------------------------------------------------------
-- Onboarding: create a wholesaler or retailer company owned by the caller.
-- p: {kind, name, contact_name, phone, email, gstin, business_category,
--     preferred_language, address: {line1, line2, city, state_code, pincode,
--     latitude, longitude}, shop_type}
-- -----------------------------------------------------------------------------
create or replace function app.complete_onboarding(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_uid uuid := app.require_user();
  v_profile public.profiles;
  v_kind public.company_kind := (p ->> 'kind')::public.company_kind;
  v_company uuid;
  v_address uuid;
  v_slug text;
  v_code text;
  v_try int := 0;
begin
  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    perform app.fail('VF404', 'Profile not found');
  end if;
  if v_profile.account_type is null then
    update public.profiles set account_type = v_kind::text::public.account_type where id = v_uid;
  elsif v_profile.account_type::text <> v_kind::text then
    perform app.fail('VF403', 'Your account type does not match this onboarding form');
  end if;
  if exists (
    select 1 from public.company_memberships m join public.companies c on c.id = m.company_id
    where m.user_id = v_uid and m.role = 'owner' and c.kind = v_kind
  ) then
    perform app.fail('VF409', 'You have already registered a business of this type');
  end if;

  v_slug := left(app.slugify(p ->> 'name'), 60);
  if char_length(v_slug) < 3 then v_slug := 'business'; end if;
  while exists (select 1 from public.companies where slug = v_slug) loop
    v_slug := left(app.slugify(p ->> 'name'), 54) || '-' || substr(md5(random()::text), 1, 5);
  end loop;
  loop
    v_try := v_try + 1;
    v_code := upper(left(regexp_replace(coalesce(p ->> 'name', ''), '[^A-Za-z]', '', 'g') || 'XXX', 3))
              || lpad((floor(random() * 1000))::int::text, 3, '0');
    exit when not exists (select 1 from public.companies where code = v_code) or v_try > 20;
  end loop;

  insert into public.companies (kind, name, slug, code, contact_name, phone, email, gstin, preferred_language, created_by)
  values (v_kind, trim(p ->> 'name'), v_slug, v_code, nullif(trim(p ->> 'contact_name'), ''),
          nullif(p ->> 'phone', ''), nullif(lower(p ->> 'email'), ''), nullif(upper(p ->> 'gstin'), ''),
          coalesce(nullif(p ->> 'preferred_language', ''), 'en'), v_uid)
  returning id into v_company;

  insert into public.business_addresses (company_id, label, line1, line2, city, state_code, pincode, latitude, longitude, is_primary, is_delivery)
  values (v_company, case when v_kind = 'retailer' then 'Shop' else 'Business' end,
          p -> 'address' ->> 'line1', nullif(p -> 'address' ->> 'line2', ''), p -> 'address' ->> 'city',
          p -> 'address' ->> 'state_code', p -> 'address' ->> 'pincode',
          nullif(p -> 'address' ->> 'latitude', '')::numeric, nullif(p -> 'address' ->> 'longitude', '')::numeric,
          true, true)
  returning id into v_address;

  -- Without coordinates, fall back to the approximate centre of the PIN code, then the city.
  update public.business_addresses a
     set latitude = g.latitude, longitude = g.longitude
    from (select gp.latitude, gp.longitude from public.geo_places gp
           where (gp.kind = 'pincode' and gp.pincode = p -> 'address' ->> 'pincode')
              or (gp.kind = 'city' and lower(gp.name) = lower(trim(p -> 'address' ->> 'city')))
           order by (gp.kind = 'pincode') desc limit 1) g
   where a.id = v_address and a.latitude is null;

  insert into public.company_memberships (company_id, user_id, role) values (v_company, v_uid, 'owner');

  if v_kind = 'wholesaler' then
    insert into public.wholesaler_profiles (company_id, business_category)
    values (v_company, coalesce(nullif(p ->> 'business_category', ''), 'general'));
    insert into public.inventory_locations (company_id, name, is_default) values (v_company, 'Main godown', true);
  else
    insert into public.retailer_profiles (company_id, shop_type, preferred_delivery_address_id)
    values (v_company, nullif(p ->> 'shop_type', ''), v_address);
  end if;

  update public.profiles
     set full_name = coalesce(nullif(trim(p ->> 'contact_name'), ''), full_name),
         phone = coalesce(nullif(p ->> 'phone', ''), phone),
         preferred_language = coalesce(nullif(p ->> 'preferred_language', ''), preferred_language)
   where id = v_uid;

  perform app.audit(v_company, 'company.registered', 'company', v_company::text, jsonb_build_object('kind', v_kind));
  return v_company;
end $$;

-- -----------------------------------------------------------------------------
-- Team invitations (delivery workers and staff are invited, never self-join)
-- -----------------------------------------------------------------------------
create or replace function app.create_invitation(p_company uuid, p_email text, p_full_name text, p_role public.membership_role)
returns text
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_uid uuid := app.require_user();
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not app.can_manage(p_company) then
    perform app.fail('VF403', 'Only owners and managers can invite team members');
  end if;
  perform app.require_active_company(p_company);
  if p_role = 'owner' then
    perform app.fail('VF422', 'Ownership cannot be granted by invitation');
  end if;
  if (select kind from public.companies where id = p_company) = 'retailer' and p_role = 'delivery_worker' then
    perform app.fail('VF422', 'Retailers cannot invite delivery workers');
  end if;
  update public.company_invitations set revoked_at = app.now()
   where company_id = p_company and lower(email) = lower(p_email) and accepted_at is null and revoked_at is null;
  insert into public.company_invitations (company_id, email, full_name, role, token_hash, expires_at, created_by)
  values (p_company, lower(trim(p_email)), nullif(trim(p_full_name), ''), p_role,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), app.now() + interval '7 days', v_uid);
  perform app.audit(p_company, 'team.invited', 'invitation', lower(p_email), jsonb_build_object('role', p_role));
  return v_token;
end $$;

create or replace function app.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_uid uuid := app.require_user();
  v_inv public.company_invitations;
  v_email text;
begin
  select * into v_inv from public.company_invitations
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   for update;
  if not found or v_inv.revoked_at is not null then
    perform app.fail('VF404', 'This invitation is not valid');
  end if;
  if v_inv.accepted_at is not null then
    perform app.fail('VF409', 'This invitation has already been used');
  end if;
  if v_inv.expires_at < app.now() then
    perform app.fail('VF409', 'This invitation has expired; ask for a new one');
  end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is distinct from lower(v_inv.email) then
    perform app.fail('VF403', 'This invitation was sent to a different email address');
  end if;
  insert into public.company_memberships (company_id, user_id, role, invited_by)
  values (v_inv.company_id, v_uid, v_inv.role, v_inv.created_by)
  on conflict (company_id, user_id) do update set role = excluded.role, status = 'active';
  update public.company_invitations set accepted_at = app.now(), accepted_by = v_uid where id = v_inv.id;
  update public.profiles
     set account_type = coalesce(account_type, case when v_inv.role = 'delivery_worker' then 'delivery_worker'::public.account_type
                                                    else (select kind::text::public.account_type from public.companies where id = v_inv.company_id) end),
         full_name = case when full_name = '' then coalesce(v_inv.full_name, '') else full_name end
   where id = v_uid;
  perform app.audit(v_inv.company_id, 'team.joined', 'membership', v_uid::text, jsonb_build_object('role', v_inv.role));
  return v_inv.company_id;
end $$;

create or replace function app.set_member_status(p_membership uuid, p_status public.membership_status) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare m public.company_memberships;
begin
  perform app.require_user();
  select * into m from public.company_memberships where id = p_membership for update;
  if not found or not app.can_manage(m.company_id) then
    perform app.fail('VF403', 'You cannot manage this team member');
  end if;
  if m.role = 'owner' then
    perform app.fail('VF409', 'The owner membership cannot be changed here');
  end if;
  update public.company_memberships set status = p_status where id = p_membership;
  if p_status = 'removed' then
    -- Unassign open deliveries so a removed worker loses access immediately.
    update public.delivery_assignments set ended_at = app.now()
     where worker_id = m.user_id and ended_at is null
       and delivery_id in (select id from public.deliveries where wholesaler_id = m.company_id and status = 'assigned');
    update public.deliveries set assigned_worker_id = null, updated_at = app.now()
     where wholesaler_id = m.company_id and assigned_worker_id = m.user_id and status = 'assigned';
  end if;
  perform app.audit(m.company_id, 'team.member_' || p_status::text, 'membership', p_membership::text, '{}');
end $$;

-- -----------------------------------------------------------------------------
-- Retailer-wholesaler relationships
-- -----------------------------------------------------------------------------
create or replace function app.request_relationship(p_retailer uuid, p_wholesaler uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_uid uuid := app.require_user();
  v_rel public.retailer_wholesaler_relationships;
  v_auto boolean;
  v_retailer public.companies;
  v_wholesaler public.companies;
begin
  if not app.is_staff(p_retailer) then
    perform app.fail('VF403', 'You are not a member of this retailer');
  end if;
  v_retailer := app.require_active_company(p_retailer);
  v_wholesaler := app.require_active_company(p_wholesaler);
  if v_retailer.kind <> 'retailer' or v_wholesaler.kind <> 'wholesaler' then
    perform app.fail('VF422', 'Connections are made between a retailer and a wholesaler');
  end if;
  select auto_approve_retailers into v_auto from public.wholesaler_profiles where company_id = p_wholesaler;

  select * into v_rel from public.retailer_wholesaler_relationships
   where wholesaler_id = p_wholesaler and retailer_id = p_retailer for update;
  if found then
    if v_rel.status in ('approved', 'pending') then
      return v_rel.id;
    end if;
    if v_rel.status = 'blocked' then
      perform app.fail('VF403', 'This wholesaler is not accepting requests from your shop');
    end if;
    update public.retailer_wholesaler_relationships
       set status = case when v_auto then 'approved'::public.relationship_status else 'pending' end,
           request_note = left(p_note, 500), requested_by = v_uid,
           decided_by = null, decided_at = case when v_auto then app.now() end
     where id = v_rel.id;
  else
    insert into public.retailer_wholesaler_relationships (wholesaler_id, retailer_id, status, request_note, requested_by, decided_at, created_at)
    values (p_wholesaler, p_retailer, case when v_auto then 'approved'::public.relationship_status else 'pending' end,
            left(p_note, 500), v_uid, case when v_auto then app.now() end, app.now())
    returning * into v_rel;
  end if;
  perform app.notify_company(p_wholesaler, 'relationship.requested',
    format('%s wants to order from you', v_retailer.name),
    case when v_auto then 'Approved automatically by your settings.' else 'Review the request in Retailers.' end,
    '/w/retailers');
  return v_rel.id;
end $$;

create or replace function app.decide_relationship(p_relationship uuid, p_status public.relationship_status,
  p_credit_limit numeric, p_note text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_uid uuid := app.require_user();
  r public.retailer_wholesaler_relationships;
begin
  select * into r from public.retailer_wholesaler_relationships where id = p_relationship for update;
  if not found or not app.can_manage(r.wholesaler_id) then
    perform app.fail('VF403', 'Only the wholesaler''s owners and managers can decide on this request');
  end if;
  if p_status = 'pending' then
    perform app.fail('VF422', 'Choose approve, reject or block');
  end if;
  update public.retailer_wholesaler_relationships
     set status = p_status, credit_limit = p_credit_limit, decision_note = left(p_note, 500),
         decided_by = v_uid, decided_at = app.now()
   where id = p_relationship;
  perform app.audit(r.wholesaler_id, 'relationship.' || p_status::text, 'relationship', p_relationship::text,
    jsonb_build_object('retailer_id', r.retailer_id, 'credit_limit', p_credit_limit));
  perform app.notify_company(r.retailer_id, 'relationship.decided',
    format('%s %s your request', (select name from public.companies where id = r.wholesaler_id),
      case p_status when 'approved' then 'approved' else 'declined' end),
    null, '/r/wholesalers');
end $$;

-- -----------------------------------------------------------------------------
-- Inventory adjustments by staff. p_quantity is always positive; the movement
-- type decides the direction. 'adjustment' takes a signed delta.
-- -----------------------------------------------------------------------------
create or replace function app.adjust_stock(p_variant uuid, p_type public.stock_movement_type, p_quantity numeric,
  p_note text, p_batch_no text default null, p_expiry date default null, p_location uuid default null)
returns public.inventory_balances
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_company uuid;
  v_location uuid;
  v_delta numeric;
  v_batch uuid;
  v_track boolean;
begin
  perform app.require_user();
  select company_id, track_batches into v_company, v_track from public.product_variants where id = p_variant;
  if v_company is null or not app.is_staff(v_company) then
    perform app.fail('VF403', 'You cannot change stock for this product');
  end if;
  perform app.require_active_company(v_company);
  if p_quantity is null or p_quantity = 0 then
    perform app.fail('VF422', 'Enter a quantity');
  end if;
  v_delta := case
    when p_type in ('opening', 'addition', 'return', 'purchase_receipt') then abs(p_quantity)
    when p_type in ('reduction', 'damage', 'purchase_return') then -abs(p_quantity)
    when p_type = 'adjustment' then p_quantity
    else null end;
  if v_delta is null then
    perform app.fail('VF422', 'This movement type is managed by orders and deliveries');
  end if;
  v_location := coalesce(p_location, app.default_location(v_company));
  if not exists (select 1 from public.inventory_locations where id = v_location and company_id = v_company) then
    perform app.fail('VF422', 'Unknown stock location');
  end if;
  if nullif(trim(p_batch_no), '') is not null and v_delta > 0 then
    insert into public.product_batches (company_id, variant_id, batch_no, expiry_date, quantity_received)
    values (v_company, p_variant, trim(p_batch_no), p_expiry, v_delta)
    on conflict (variant_id, batch_no) do update set quantity_received = public.product_batches.quantity_received + excluded.quantity_received
    returning id into v_batch;
  elsif v_track and v_delta > 0 and p_type in ('opening', 'addition', 'purchase_receipt') then
    perform app.fail('VF422', 'This product tracks batches; enter a batch number');
  end if;
  return app.apply_stock_change(v_company, v_location, p_variant, p_type, v_delta, 0, 'manual', null, left(p_note, 500), v_batch);
end $$;

-- Compare the balance projection against the movement journal.
create or replace function app.reconcile_inventory(p_company uuid)
returns table (variant_id uuid, location_id uuid, on_hand numeric, journal_on_hand numeric, reserved numeric, journal_reserved numeric)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_staff(p_company) or app.is_platform_admin()) then
    perform app.fail('VF403', 'Not allowed');
  end if;
  return query
  select b.variant_id, b.location_id, b.on_hand, coalesce(sum(m.on_hand_delta), 0), b.reserved, coalesce(sum(m.reserved_delta), 0)
    from public.inventory_balances b
    left join public.stock_movements m on m.location_id = b.location_id and m.variant_id = b.variant_id
   where b.company_id = p_company
   group by b.variant_id, b.location_id, b.on_hand, b.reserved;
end $$;

-- Availability label for catalog viewers (exact stock stays private).
create or replace function app.variant_availability(p_variant_ids uuid[])
returns table (variant_id uuid, availability text, available numeric)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  return query
  select v.id,
         case when coalesce(sum(b.available), 0) <= 0 then 'out_of_stock'
              when coalesce(sum(b.available), 0) <= v.low_stock_threshold then 'low_stock'
              else 'in_stock' end,
         case when app.is_staff(v.company_id) then coalesce(sum(b.available), 0) end
    from public.product_variants v
    left join public.inventory_balances b on b.variant_id = v.id
   where v.id = any (p_variant_ids)
     and (app.is_staff(v.company_id) or app.is_approved_retailer_of(v.company_id))
   group by v.id, v.low_stock_threshold, v.company_id;
end $$;
