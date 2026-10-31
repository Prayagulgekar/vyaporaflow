-- =============================================================================
-- VyaporaFlow DEMONSTRATION SEED DATA
--
-- All businesses, people, phone numbers, GSTINs and emails below are fictional
-- and exist only for local demonstration and development. Every account uses
-- the demo-only password "VyaporaDemo#2026". NEVER run this file against a
-- production database.
--
-- Orders, invoices, payments and deliveries are created by calling the same
-- app.* business functions the application uses, acting as the relevant demo
-- users, so all totals, stock movements, ledger postings and balances are
-- internally consistent. app.seed_clock back-dates each action.
-- =============================================================================

set search_path = public, extensions;

-- Create a demo auth user in either a Supabase project (full auth schema) or
-- the local shim (minimal auth.users).
create or replace function pg_temp.demo_user(p_id uuid, p_email text, p_name text, p_type text, p_phone text)
returns void language plpgsql as $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'instance_id') then
    execute $q$
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
        email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
        crypt('VyaporaDemo#2026', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}',
        jsonb_build_object('full_name', $3, 'account_type', $4, 'phone', $5, 'is_demo', true), now(), now(), '', '', '', '')
      on conflict (id) do nothing $q$ using p_id, p_email, p_name, p_type, p_phone;
    execute $q$
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), $1, $1::text, jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true), 'email', now(), now(), now())
      on conflict do nothing $q$ using p_id, p_email;
  else
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
    values (p_id, p_email, crypt('VyaporaDemo#2026', gen_salt('bf')), now(),
            jsonb_build_object('full_name', p_name, 'account_type', p_type, 'phone', p_phone, 'is_demo', true))
    on conflict (id) do nothing;
  end if;
end $$;

-- Act as a user at a point in time.
create or replace function pg_temp.act(p_user uuid, p_at timestamptz) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, false),
         set_config('app.seed_clock', p_at::text, false);
$$;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
select pg_temp.demo_user('00000000-0000-4000-8000-000000000001', 'admin@vyaporaflow.test', 'Platform Admin (demo)', null, null);
select pg_temp.demo_user('00000000-0000-4000-8000-000000000101', 'sahyadri.owner@vyaporaflow.test', 'Anil Kulkarni (demo)', 'wholesaler', '9000000101');
select pg_temp.demo_user('00000000-0000-4000-8000-000000000102', 'sahyadri.staff@vyaporaflow.test', 'Pooja Shinde (demo)', 'wholesaler', '9000000102');
select pg_temp.demo_user('00000000-0000-4000-8000-000000000201', 'annapurna.owner@vyaporaflow.test', 'Suresh Patil (demo)', 'wholesaler', '9000000201');
select pg_temp.demo_user('00000000-0000-4000-8000-000000000301', 'konkan.owner@vyaporaflow.test', 'Farida Shaikh (demo)', 'wholesaler', '9000000301');
select pg_temp.demo_user('00000000-0000-4000-8000-000000000401', 'deccan.owner@vyaporaflow.test', 'Joseph D''Souza (demo)', 'wholesaler', '9000000401');
select pg_temp.demo_user('00000000-0000-4000-8000-000000000501', 'garden.owner@vyaporaflow.test', 'Kiran Rao (demo)', 'wholesaler', '9000000501');
select pg_temp.demo_user('00000000-0000-4000-8000-000000001001', 'ganesh.retailer@vyaporaflow.test', 'Meera Joshi (demo)', 'retailer', '9000001001');
select pg_temp.demo_user('00000000-0000-4000-8000-000000001002', 'omsai.retailer@vyaporaflow.test', 'Rahul Pawar (demo)', 'retailer', '9000001002');
select pg_temp.demo_user('00000000-0000-4000-8000-000000001003', 'laxmi.retailer@vyaporaflow.test', 'Lata More (demo)', 'retailer', '9000001003');
select pg_temp.demo_user('00000000-0000-4000-8000-000000001004', 'navifresh.retailer@vyaporaflow.test', 'Arjun Nair (demo)', 'retailer', '9000001004');
select pg_temp.demo_user('00000000-0000-4000-8000-000000002001', 'ravi.delivery@vyaporaflow.test', 'Ravi Gaikwad (demo)', 'delivery_worker', '9000002001');
select pg_temp.demo_user('00000000-0000-4000-8000-000000002002', 'sunil.delivery@vyaporaflow.test', 'Sunil Jadhav (demo)', 'delivery_worker', '9000002002');
select pg_temp.demo_user('00000000-0000-4000-8000-000000002003', 'imran.delivery@vyaporaflow.test', 'Imran Khan (demo)', 'delivery_worker', '9000002003');

insert into public.platform_admins (user_id, granted_by, note)
values ('00000000-0000-4000-8000-000000000001', 'seed', 'Demo administrator') on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Companies (created directly with fixed ids so docs and tests can refer to them)
-- ---------------------------------------------------------------------------
insert into public.companies (id, kind, name, slug, code, contact_name, phone, email, gstin, verification_status, status, status_reason, is_demo, created_by, created_at) values
  ('10000000-0000-4000-8000-000000000001', 'wholesaler', 'Sahyadri Snacks & Beverages Distributors', 'sahyadri-snacks-beverages', 'SSB', 'Anil Kulkarni (demo)', '9000000101', 'sahyadri.owner@vyaporaflow.test', '27AAPFS1234K1Z3', 'verified', 'active', null, true, '00000000-0000-4000-8000-000000000101', now() - interval '90 days'),
  ('10000000-0000-4000-8000-000000000002', 'wholesaler', 'Annapurna Kirana Wholesale', 'annapurna-kirana-wholesale', 'ANP', 'Suresh Patil (demo)', '9000000201', 'annapurna.owner@vyaporaflow.test', '27AAKFA5678M1Z9', 'verified', 'active', null, true, '00000000-0000-4000-8000-000000000201', now() - interval '90 days'),
  ('10000000-0000-4000-8000-000000000003', 'wholesaler', 'Konkan Gas & Water Supply', 'konkan-gas-water', 'KGW', 'Farida Shaikh (demo)', '9000000301', 'konkan.owner@vyaporaflow.test', '27AAKFK2468P1Z1', 'pending', 'active', null, true, '00000000-0000-4000-8000-000000000301', now() - interval '60 days'),
  ('10000000-0000-4000-8000-000000000004', 'wholesaler', 'Deccan Bakery Wholesale', 'deccan-bakery-wholesale', 'DBW', 'Joseph D''Souza (demo)', '9000000401', 'deccan.owner@vyaporaflow.test', null, 'unverified', 'active', null, true, '00000000-0000-4000-8000-000000000401', now() - interval '30 days'),
  ('10000000-0000-4000-8000-000000000005', 'wholesaler', 'Garden City Traders', 'garden-city-traders', 'GCT', 'Kiran Rao (demo)', '9000000501', 'garden.owner@vyaporaflow.test', null, 'rejected', 'suspended', 'Demo: suspended pending document review', true, '00000000-0000-4000-8000-000000000501', now() - interval '20 days'),
  ('20000000-0000-4000-8000-000000000001', 'retailer', 'Shree Ganesh Kirana Stores', 'shree-ganesh-kirana', 'SGK', 'Meera Joshi (demo)', '9000001001', 'ganesh.retailer@vyaporaflow.test', '27AABCG1111R1Z2', 'verified', 'active', null, true, '00000000-0000-4000-8000-000000001001', now() - interval '80 days'),
  ('20000000-0000-4000-8000-000000000002', 'retailer', 'Om Sai General Store', 'om-sai-general-store', 'OSG', 'Rahul Pawar (demo)', '9000001002', 'omsai.retailer@vyaporaflow.test', null, 'unverified', 'active', null, true, '00000000-0000-4000-8000-000000001002', now() - interval '75 days'),
  ('20000000-0000-4000-8000-000000000003', 'retailer', 'Laxmi Provision Mart', 'laxmi-provision-mart', 'LPM', 'Lata More (demo)', '9000001003', 'laxmi.retailer@vyaporaflow.test', null, 'unverified', 'active', null, true, '00000000-0000-4000-8000-000000001003', now() - interval '50 days'),
  ('20000000-0000-4000-8000-000000000004', 'retailer', 'Navi Fresh Mart', 'navi-fresh-mart', 'NFM', 'Arjun Nair (demo)', '9000001004', 'navifresh.retailer@vyaporaflow.test', null, 'unverified', 'active', null, true, '00000000-0000-4000-8000-000000001004', now() - interval '40 days')
on conflict (id) do nothing;

insert into public.business_addresses (company_id, label, line1, line2, city, state_code, pincode, latitude, longitude, is_primary) values
  ('10000000-0000-4000-8000-000000000001', 'Godown', 'Gala 14, Fictional Trade Complex, Market Yard', null, 'Pune', '27', '411037', 18.4869, 73.8722, true),
  ('10000000-0000-4000-8000-000000000002', 'Godown', 'Shop 3, Demo Wholesale Lane, Hadapsar', null, 'Pune', '27', '411028', 18.5089, 73.9260, true),
  ('10000000-0000-4000-8000-000000000003', 'Depot', 'Plot 22, Sample Industrial Area, Sector 19', 'Vashi', 'Navi Mumbai', '27', '400703', 19.0771, 72.9986, true),
  ('10000000-0000-4000-8000-000000000004', 'Bakery', 'Unit 5, Demo Bakers Estate, Pimpri', null, 'Pune', '27', '411018', 18.6279, 73.8009, true),
  ('10000000-0000-4000-8000-000000000005', 'Godown', '12 Example Road', null, 'Bengaluru', '29', '560001', 12.9763, 77.6033, true),
  ('20000000-0000-4000-8000-000000000001', 'Shop', 'Shop 7, Fictional Society, Paud Road, Kothrud', null, 'Pune', '27', '411038', 18.5074, 73.8077, true),
  ('20000000-0000-4000-8000-000000000002', 'Shop', 'Shop 2, Sample Heights, Viman Nagar', null, 'Pune', '27', '411014', 18.5679, 73.9143, true),
  ('20000000-0000-4000-8000-000000000003', 'Shop', 'Shop 11, Demo Plaza, Phase 1, Hinjewadi', null, 'Pune', '27', '411057', 18.5913, 73.7389, true),
  ('20000000-0000-4000-8000-000000000004', 'Shop', 'Shop 4, Example Arcade, Sector 17', 'Vashi', 'Navi Mumbai', '27', '400703', 19.0745, 72.9978, true);

insert into public.company_memberships (company_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'owner'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', 'staff'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000002001', 'delivery_worker'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000002002', 'delivery_worker'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000201', 'owner'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000002003', 'delivery_worker'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000301', 'owner'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000401', 'owner'),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000501', 'owner'),
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000001001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000001002', 'owner'),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000001003', 'owner'),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000001004', 'owner')
on conflict do nothing;

insert into public.wholesaler_profiles (company_id, business_category, description, offers_delivery, min_order_value, delivery_charge,
  free_delivery_above, auto_approve_retailers, payment_terms_days, whatsapp_number, opening_hours, is_listed) values
  ('10000000-0000-4000-8000-000000000001', 'packaged-snacks', 'Demo distributor of packaged snacks, biscuits, soft drinks and packaged drinking water for kirana stores across Pune.',
   true, 1000, 150, 5000, false, 15, '9000000101',
   '{"mon":["08:30","20:30"],"tue":["08:30","20:30"],"wed":["08:30","20:30"],"thu":["08:30","20:30"],"fri":["08:30","20:30"],"sat":["08:30","20:30"]}', true),
  ('10000000-0000-4000-8000-000000000002', 'kirana', 'Demo staples wholesaler: rice, atta, dal, sugar, edible oil and household essentials.',
   true, 2000, 0, null, true, 21, '9000000201',
   '{"mon":["07:00","21:00"],"tue":["07:00","21:00"],"wed":["07:00","21:00"],"thu":["07:00","21:00"],"fri":["07:00","21:00"],"sat":["07:00","21:00"],"sun":["08:00","13:00"]}', true),
  ('10000000-0000-4000-8000-000000000003', 'gas-cylinders', 'Demo supplier of commercial LPG cylinders and 20 litre water jars. Empty cylinders are collected on delivery.',
   true, 0, 100, 3000, false, 7, '9000000301',
   '{"mon":["09:00","19:00"],"tue":["09:00","19:00"],"wed":["09:00","19:00"],"thu":["09:00","19:00"],"fri":["09:00","19:00"],"sat":["09:00","19:00"]}', true),
  ('10000000-0000-4000-8000-000000000004', 'bakery', 'Demo bakery wholesaler. Counter pickup only; order by 6 pm for next-morning pickup.',
   false, 500, 0, null, true, 0, null, '{"mon":["05:30","18:00"],"tue":["05:30","18:00"],"wed":["05:30","18:00"],"thu":["05:30","18:00"],"fri":["05:30","18:00"],"sat":["05:30","18:00"],"sun":["05:30","11:00"]}', true),
  ('10000000-0000-4000-8000-000000000005', 'kirana', 'Suspended demo company. It must not appear in marketplace results.', true, 0, 0, null, true, 15, null, null, true)
on conflict do nothing;

insert into public.retailer_profiles (company_id, shop_type, preferred_delivery_address_id)
select c.id, 'Kirana store', a.id from public.companies c join public.business_addresses a on a.company_id = c.id and a.is_primary
where c.kind = 'retailer' on conflict do nothing;

insert into public.inventory_locations (company_id, name, is_default)
select id, 'Main godown', true from public.companies where kind = 'wholesaler' on conflict do nothing;

insert into public.delivery_zones (company_id, name, kind, radius_km, pincodes) values
  ('10000000-0000-4000-8000-000000000001', 'Pune city (15 km)', 'radius', 15, '{}'),
  ('10000000-0000-4000-8000-000000000002', 'Hadapsar and east Pune', 'radius', 12, '{}'),
  ('10000000-0000-4000-8000-000000000002', 'Selected west Pune PIN codes', 'pincodes', null, '{411038,411057,411005}'),
  ('10000000-0000-4000-8000-000000000003', 'Navi Mumbai and Thane', 'radius', 25, '{}');

insert into public.retailer_wholesaler_relationships (wholesaler_id, retailer_id, status, credit_limit, requested_by, decided_by, decided_at, created_at) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'approved', 50000, '00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000101', now() - interval '70 days', now() - interval '71 days'),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'approved', 30000, '00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-000000000101', now() - interval '65 days', now() - interval '66 days'),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'pending', null, '00000000-0000-4000-8000-000000001003', null, null, now() - interval '2 days'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'approved', 75000, '00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000201', now() - interval '70 days', now() - interval '70 days'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'approved', 40000, '00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-000000000201', now() - interval '60 days', now() - interval '60 days'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', 'approved', 25000, '00000000-0000-4000-8000-000000001003', '00000000-0000-4000-8000-000000000201', now() - interval '45 days', now() - interval '45 days'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000004', 'approved', 20000, '00000000-0000-4000-8000-000000001004', '00000000-0000-4000-8000-000000000301', now() - interval '35 days', now() - interval '35 days'),
  ('10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'approved', null, '00000000-0000-4000-8000-000000001001', null, now() - interval '20 days', now() - interval '20 days')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
insert into public.brands (company_id, name) values
  (null, 'Crispo'), (null, 'Ranjan Wafers'), (null, 'Chatpata'), (null, 'Sunrise Biscuits'), (null, 'Morningdew'),
  (null, 'Neerdhara'), (null, 'Aamrit'), (null, 'Toofan'), (null, 'Gehu Gold'), (null, 'Suryakiran'),
  (null, 'Sagar'), (null, 'Shubhra')
on conflict do nothing;
insert into public.brands (company_id, name) values
  ('10000000-0000-4000-8000-000000000002', 'Annapurna Select (house brand)'),
  ('10000000-0000-4000-8000-000000000004', 'Deccan Bake House (house brand)')
on conflict do nothing;

-- Products: (company, category slug, brand, tax %, name, hsn, inclusive, attributes)
create temporary table seed_products (
  company uuid, cat text, brand text, tax numeric, name text, hsn text, inclusive boolean, attrs jsonb,
  vname text, sku text, base_unit text, low numeric, units jsonb, opening numeric, batch boolean default false
);
insert into seed_products values
  -- Sahyadri Snacks & Beverages
  ('10000000-0000-4000-8000-000000000001', 'packaged-snacks', 'Crispo', 5, 'Crispo Classic Salted Potato Chips', '2005', false, '{"flavour":"Classic salted","shelf_life_days":120}',
   '52 g', 'SSB-CRS-CS-52', 'packet', 96, '[{"u":"packet","f":1,"p":17.50,"mrp":20,"moq":12,"step":6,"def":true},{"u":"carton","f":48,"p":816.00,"mrp":960,"moq":1,"disc":2}]', 960, false),
  ('10000000-0000-4000-8000-000000000001', 'packaged-snacks', 'Crispo', 5, 'Crispo Magic Masala Potato Chips', '2005', false, '{"flavour":"Magic masala","shelf_life_days":120}',
   '52 g', 'SSB-CRS-MM-52', 'packet', 96, '[{"u":"packet","f":1,"p":17.50,"mrp":20,"moq":12,"step":6,"def":true},{"u":"carton","f":48,"p":816.00,"mrp":960,"moq":1,"disc":2}]', 1200, false),
  ('10000000-0000-4000-8000-000000000001', 'packaged-snacks', 'Ranjan Wafers', 5, 'Ranjan Simply Salted Wafers', '2005', false, '{"flavour":"Salted","shelf_life_days":90}',
   '45 g', 'SSB-RNJ-SS-45', 'packet', 60, '[{"u":"packet","f":1,"p":8.70,"mrp":10,"moq":24,"step":12,"def":true},{"u":"box","f":24,"p":204.00,"mrp":240,"moq":1}]', 1440, false),
  ('10000000-0000-4000-8000-000000000001', 'packaged-snacks', 'Ranjan Wafers', 5, 'Ranjan Masala Wafers', '2005', false, '{"flavour":"Masala","shelf_life_days":90}',
   '45 g', 'SSB-RNJ-MM-45', 'packet', 60, '[{"u":"packet","f":1,"p":8.70,"mrp":10,"moq":24,"step":12,"def":true},{"u":"box","f":24,"p":204.00,"mrp":240,"moq":1}]', 300, false),
  ('10000000-0000-4000-8000-000000000001', 'packaged-snacks', 'Chatpata', 5, 'Chatpata Masala Rings', '1904', false, '{"flavour":"Masala","shelf_life_days":120}',
   '75 g', 'SSB-CHT-MM-75', 'packet', 48, '[{"u":"packet","f":1,"p":17.60,"mrp":20,"moq":12,"step":6,"def":true},{"u":"carton","f":36,"p":620.00,"mrp":720,"moq":1}]', 720, false),
  ('10000000-0000-4000-8000-000000000001', 'biscuits', 'Sunrise Biscuits', 5, 'Sunrise Glucose Biscuits', '1905', false, '{"shelf_life_days":180}',
   '250 g', 'SSB-SUNG-250', 'packet', 60, '[{"u":"packet","f":1,"p":22.80,"mrp":25,"moq":12,"step":12,"def":true},{"u":"carton","f":48,"p":1080.00,"mrp":1200,"moq":1}]', 960, false),
  ('10000000-0000-4000-8000-000000000001', 'biscuits', 'Morningdew', 5, 'Morningdew Cashew Cookies', '1905', false, '{"shelf_life_days":180}',
   '200 g', 'SSB-MDEW-200', 'packet', 36, '[{"u":"packet","f":1,"p":36.00,"mrp":40,"moq":12,"step":6,"def":true},{"u":"carton","f":36,"p":1260.00,"mrp":1440,"moq":1}]', 25, false),
  ('10000000-0000-4000-8000-000000000001', 'bottled-water', 'Neerdhara', 18, 'Neerdhara Packaged Drinking Water', '2201', true, '{"volume_ml":1000}',
   '1 litre', 'SSB-NEER-1L', 'bottle', 120, '[{"u":"bottle","f":1,"p":15.50,"mrp":20,"moq":12,"step":12,"def":true},{"u":"box","f":12,"p":180.00,"mrp":240,"moq":1}]', 1200, false),
  ('10000000-0000-4000-8000-000000000001', 'beverages', 'Aamrit', 18, 'Aamrit Mango Drink', '2202', true, '{"volume_ml":160}',
   '160 ml', 'SSB-AAMRIT-160', 'piece', 80, '[{"u":"piece","f":1,"p":8.40,"mrp":10,"moq":27,"step":27,"def":true},{"u":"box","f":27,"p":222.00,"mrp":270,"moq":1}]', 1080, false),
  ('10000000-0000-4000-8000-000000000001', 'beverages', 'Toofan', 40, 'Toofan Cola Soft Drink', '2202', true, '{"volume_ml":750}',
   '750 ml', 'SSB-TOOFAN-750', 'bottle', 48, '[{"u":"bottle","f":1,"p":34.00,"mrp":40,"moq":6,"step":6,"def":true},{"u":"crate","f":24,"p":800.00,"mrp":960,"moq":1}]', 360, false),
  -- Annapurna Kirana Wholesale
  ('10000000-0000-4000-8000-000000000002', 'rice-grains', 'Annapurna Select (house brand)', 5, 'Sona Masoori Rice', '1006', false, '{"grain_type":"Sona Masoori","crop_year":"2025"}',
   'Packed', 'ANP-RICE-SM', 'kg', 250, '[{"u":"kg","f":1,"p":54.00,"moq":10,"step":1,"def":true},{"u":"bag","f":25,"p":1300.00,"moq":1}]', 3000, true),
  ('10000000-0000-4000-8000-000000000002', 'rice-grains', null, 0, 'Kolam Rice (loose, unbranded)', '1006', false, '{"grain_type":"Kolam"}',
   'Loose', 'ANP-RICE-KOLAM', 'kg', 200, '[{"u":"kg","f":1,"p":46.00,"moq":10,"step":0.5,"def":true},{"u":"quintal","f":100,"p":4450.00,"moq":1}]', 2500, false),
  ('10000000-0000-4000-8000-000000000002', 'flour', 'Gehu Gold', 5, 'Gehu Gold Chakki Atta', '1101', false, '{"grain_type":"Whole wheat"}',
   '10 kg', 'ANP-ATTA-10', 'packet', 20, '[{"u":"packet","f":1,"p":445.00,"mrp":510,"moq":2,"def":true}]', 180, false),
  ('10000000-0000-4000-8000-000000000002', 'pulses', 'Annapurna Select (house brand)', 5, 'Toor Dal', '0713', false, '{"grade":"Premium"}',
   'Packed', 'ANP-TOOR', 'kg', 100, '[{"u":"kg","f":1,"p":148.00,"moq":5,"def":true},{"u":"bag","f":30,"p":4320.00,"moq":1}]', 900, true),
  ('10000000-0000-4000-8000-000000000002', 'pulses', null, 0, 'Moong Dal (loose)', '0713', false, '{"grade":"Regular"}',
   'Loose', 'ANP-MOONG', 'kg', 50, '[{"u":"kg","f":1,"p":118.00,"moq":5,"step":0.5,"def":true}]', 40, false),
  ('10000000-0000-4000-8000-000000000002', 'sugar', null, 5, 'Sugar S-30', '1701', false, '{}',
   'Loose', 'ANP-SUGAR', 'kg', 200, '[{"u":"kg","f":1,"p":42.50,"moq":10,"def":true},{"u":"bag","f":50,"p":2075.00,"moq":1}]', 2500, false),
  ('10000000-0000-4000-8000-000000000002', 'cooking-oil', 'Suryakiran', 5, 'Suryakiran Sunflower Oil', '1512', false, '{"oil_type":"Refined sunflower"}',
   '1 litre pouch', 'ANP-SURY-SUN-1L', 'packet', 60, '[{"u":"packet","f":1,"p":138.00,"mrp":165,"moq":10,"def":true},{"u":"carton","f":10,"p":1360.00,"mrp":1650,"moq":1}]', 600, false),
  ('10000000-0000-4000-8000-000000000002', 'cooking-oil', 'Suryakiran', 5, 'Suryakiran Sunflower Oil Tin', '1512', false, '{"oil_type":"Refined sunflower"}',
   '15 litre tin', 'ANP-SURY-SUN-15L', 'tin', 5, '[{"u":"tin","f":1,"p":2050.00,"mrp":2350,"moq":1,"def":true}]', 40, false),
  ('10000000-0000-4000-8000-000000000002', 'kirana', 'Sagar', 0, 'Sagar Iodised Salt', '2501', false, '{}',
   '1 kg', 'ANP-SAGARSALT-1', 'packet', 50, '[{"u":"packet","f":1,"p":25.00,"mrp":28,"moq":25,"step":25,"def":true}]', 1000, false),
  ('10000000-0000-4000-8000-000000000002', 'household', 'Shubhra', 18, 'Shubhra Easy Wash Detergent', '3402', true, '{}',
   '1 kg', 'ANP-SHUB-1', 'packet', 24, '[{"u":"packet","f":1,"p":118.00,"mrp":140,"moq":6,"def":true},{"u":"carton","f":12,"p":1390.00,"mrp":1680,"moq":1}]', 240, false),
  -- Konkan Gas & Water
  ('10000000-0000-4000-8000-000000000003', 'gas-cylinders', null, 18, 'Commercial LPG Cylinder', '2711', true, '{"net_weight_kg":19,"cylinder_type":"Commercial"}',
   '19 kg', 'KGW-LPG-19', 'cylinder', 10, '[{"u":"cylinder","f":1,"p":1780.00,"moq":1,"def":true}]', 80, false),
  ('10000000-0000-4000-8000-000000000003', 'gas-cylinders', null, 18, 'Free Trade LPG Cylinder', '2711', true, '{"net_weight_kg":5,"cylinder_type":"FTL"}',
   '5 kg', 'KGW-LPG-5', 'cylinder', 10, '[{"u":"cylinder","f":1,"p":560.00,"moq":1,"def":true}]', 60, false),
  ('10000000-0000-4000-8000-000000000003', 'bottled-water', null, 18, 'Packaged Drinking Water Jar', '2201', true, '{"volume_ml":20000}',
   '20 litre jar', 'KGW-JAR-20', 'jar', 20, '[{"u":"jar","f":1,"p":70.00,"moq":5,"def":true}]', 400, false),
  -- Deccan Bakery
  ('10000000-0000-4000-8000-000000000004', 'bakery', 'Deccan Bake House (house brand)', 0, 'Milk Bread', '1905', false, '{"shelf_life_days":3}',
   '400 g', 'DBW-BREAD-400', 'packet', 20, '[{"u":"packet","f":1,"p":36.00,"mrp":45,"moq":10,"def":true},{"u":"crate","f":20,"p":700.00,"moq":1}]', 200, false),
  ('10000000-0000-4000-8000-000000000004', 'bakery', 'Deccan Bake House (house brand)', 5, 'Elaichi Rusk', '1905', false, '{"shelf_life_days":60}',
   '300 g', 'DBW-RUSK-300', 'packet', 20, '[{"u":"packet","f":1,"p":48.00,"mrp":60,"moq":10,"def":true}]', 150, false),
  ('10000000-0000-4000-8000-000000000004', 'bakery', 'Deccan Bake House (house brand)', 0, 'Ladi Pav', '1905', false, '{"shelf_life_days":2}',
   '6 pieces', 'DBW-PAV-6', 'packet', 30, '[{"u":"packet","f":1,"p":18.00,"mrp":24,"moq":20,"def":true}]', 300, false),
  -- Suspended company (must never be orderable or listed)
  ('10000000-0000-4000-8000-000000000005', 'kirana', 'Sagar', 0, 'Sagar Iodised Salt', '2501', false, '{}',
   '1 kg', 'GCT-SAGARSALT-1', 'packet', 50, '[{"u":"packet","f":1,"p":24.00,"moq":25,"def":true}]', 500, false);

insert into public.products (company_id, category_id, brand_id, tax_class_id, name, hsn_code, price_includes_tax, attributes, created_by, created_at)
select sp.company,
       (select id from public.product_categories where company_id is null and slug = sp.cat),
       (select id from public.brands b where b.name = sp.brand and (b.company_id is null or b.company_id = sp.company) limit 1),
       (select id from public.tax_classes where company_id is null and rate = sp.tax order by name limit 1),
       sp.name, sp.hsn, sp.inclusive, sp.attrs,
       (select user_id from public.company_memberships where company_id = sp.company and role = 'owner'),
       now() - interval '60 days'
  from seed_products sp;

insert into public.product_variants (product_id, company_id, name, sku, base_unit, low_stock_threshold, track_batches)
select p.id, p.company_id, sp.vname, sp.sku, sp.base_unit, sp.low, sp.batch
  from seed_products sp join public.products p on p.company_id = sp.company and p.name = sp.name;

insert into public.variant_units (variant_id, company_id, unit_code, factor_to_base, price, mrp, discount_percent, min_order_qty, qty_step, is_default)
select v.id, v.company_id, u ->> 'u', (u ->> 'f')::numeric, (u ->> 'p')::numeric, (u ->> 'mrp')::numeric,
       coalesce((u ->> 'disc')::numeric, 0), coalesce((u ->> 'moq')::numeric, 1), coalesce((u ->> 'step')::numeric, 1),
       coalesce((u ->> 'def')::boolean, false)
  from seed_products sp
  join public.product_variants v on v.sku = sp.sku and v.company_id = sp.company
  cross join lateral jsonb_array_elements(sp.units) u;

insert into public.suppliers (company_id, name, contact_name, phone, address) values
  ('10000000-0000-4000-8000-000000000001', 'Western Snack Foods Depot (demo)', 'Depot desk', '9000003001', 'Chakan MIDC, Pune (fictional)'),
  ('10000000-0000-4000-8000-000000000001', 'Pune Beverage Bottlers (demo)', 'Sales desk', '9000003002', 'Ranjangaon, Pune (fictional)'),
  ('10000000-0000-4000-8000-000000000002', 'Nashik Grain Traders (demo)', 'Order desk', '9000003003', 'APMC Nashik (fictional)');

-- ---------------------------------------------------------------------------
-- Opening stock (as each owner, 60 days ago) and a purchase order
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select sp.*, v.id as variant_id,
                  (select user_id from public.company_memberships where company_id = sp.company and role = 'owner') as owner_id
             from seed_products sp join public.product_variants v on v.sku = sp.sku and v.company_id = sp.company
            where sp.company <> '10000000-0000-4000-8000-000000000005'  -- suspended companies cannot move stock
  loop
    perform pg_temp.act(r.owner_id, now() - interval '60 days');
    perform app.adjust_stock(r.variant_id, 'opening', r.opening, 'Opening stock (demo)',
      case when r.batch then 'OPEN-' || to_char(now() - interval '60 days', 'YYMM') end,
      case when r.batch then (now() + interval '200 days')::date end);
  end loop;

  -- A received purchase order for Sahyadri
  perform pg_temp.act('00000000-0000-4000-8000-000000000101', now() - interval '20 days');
  perform app.receive_goods(
    app.create_purchase_order('10000000-0000-4000-8000-000000000001',
      (select id from public.suppliers where name = 'Western Snack Foods Depot (demo)'),
      jsonb_build_array(
        jsonb_build_object('variant_id', (select id from public.product_variants where sku = 'SSB-CRS-CS-52'), 'quantity', 480, 'unit_cost', 15.20),
        jsonb_build_object('variant_id', (select id from public.product_variants where sku = 'SSB-CHT-MM-75'), 'quantity', 360, 'unit_cost', 15.40)),
      (now() - interval '18 days')::date, 'Monthly replenishment (demo)'),
    (select jsonb_agg(jsonb_build_object('purchase_order_item_id', poi.id, 'quantity', poi.quantity))
       from public.purchase_order_items poi join public.purchase_orders po on po.id = poi.purchase_order_id
      where po.company_id = '10000000-0000-4000-8000-000000000001'),
    'Received in full (demo)');
  -- An open purchase order (awaiting delivery) for Annapurna
  perform pg_temp.act('00000000-0000-4000-8000-000000000201', now() - interval '2 days');
  perform app.create_purchase_order('10000000-0000-4000-8000-000000000002',
    (select id from public.suppliers where name = 'Nashik Grain Traders (demo)'),
    jsonb_build_array(jsonb_build_object('variant_id', (select id from public.product_variants where sku = 'ANP-MOONG'), 'quantity', 500, 'unit_cost', 104.00)),
    (now() + interval '3 days')::date, 'Moong dal is running low (demo)');
end $$;

-- ---------------------------------------------------------------------------
-- Orders through their whole lifecycle
-- ---------------------------------------------------------------------------
create or replace function pg_temp.vu(p_sku text, p_unit text) returns uuid language sql as $$
  select vu.id from public.variant_units vu join public.product_variants v on v.id = vu.variant_id
   where v.sku = p_sku and vu.unit_code = p_unit
$$;

do $$
declare
  ssb uuid := '10000000-0000-4000-8000-000000000001';
  anp uuid := '10000000-0000-4000-8000-000000000002';
  kgw uuid := '10000000-0000-4000-8000-000000000003';
  ssb_owner uuid := '00000000-0000-4000-8000-000000000101';
  anp_owner uuid := '00000000-0000-4000-8000-000000000201';
  kgw_owner uuid := '00000000-0000-4000-8000-000000000301';
  ravi uuid := '00000000-0000-4000-8000-000000002001';
  sunil uuid := '00000000-0000-4000-8000-000000002002';
  imran uuid := '00000000-0000-4000-8000-000000002003';
  r_ganesh uuid := '20000000-0000-4000-8000-000000000001';
  r_omsai uuid := '20000000-0000-4000-8000-000000000002';
  r_laxmi uuid := '20000000-0000-4000-8000-000000000003';
  r_navi uuid := '20000000-0000-4000-8000-000000000004';
  u_ganesh uuid := '00000000-0000-4000-8000-000000001001';
  u_omsai uuid := '00000000-0000-4000-8000-000000001002';
  u_laxmi uuid := '00000000-0000-4000-8000-000000001003';
  u_navi uuid := '00000000-0000-4000-8000-000000001004';
  -- age_days, wholesaler, retailer, items, final stage, payment plan
  plan jsonb := '[
    [44,"ssb","ganesh",[["SSB-CRS-CS-52","carton",2],["SSB-SUNG-250","carton",1],["SSB-NEER-1L","box",5]],"delivered","full"],
    [42,"anp","ganesh",[["ANP-RICE-SM","bag",4],["ANP-TOOR","bag",1],["ANP-SUGAR","bag",2]],"delivered","full"],
    [40,"ssb","omsai",[["SSB-RNJ-SS-45","box",6],["SSB-AAMRIT-160","box",4]],"delivered","full"],
    [38,"anp","omsai",[["ANP-ATTA-10","packet",10],["ANP-SURY-SUN-1L","carton",2]],"delivered","partial"],
    [36,"kgw","navi",[["KGW-LPG-19","cylinder",4],["KGW-JAR-20","jar",20]],"delivered","full"],
    [35,"ssb","ganesh",[["SSB-CHT-MM-75","carton",2],["SSB-TOOFAN-750","crate",2]],"delivered","full"],
    [33,"anp","laxmi",[["ANP-RICE-KOLAM","quintal",1],["ANP-SAGARSALT-1","packet",50]],"delivered","full"],
    [31,"ssb","omsai",[["SSB-CRS-MM-52","carton",2],["SSB-NEER-1L","box",10]],"cancelled","none"],
    [30,"anp","ganesh",[["ANP-SURY-SUN-15L","tin",2],["ANP-SHUB-1","carton",1]],"delivered","partial"],
    [28,"ssb","ganesh",[["SSB-RNJ-MM-45","box",4],["SSB-SUNG-250","packet",48]],"delivered","partial"],
    [26,"kgw","navi",[["KGW-LPG-19","cylinder",3],["KGW-LPG-5","cylinder",4]],"delivered","none"],
    [24,"anp","omsai",[["ANP-RICE-SM","kg",50],["ANP-MOONG","kg",10]],"delivered","full"],
    [22,"ssb","omsai",[["SSB-CRS-CS-52","carton",1],["SSB-MDEW-200","packet",12]],"partial_delivery","none"],
    [20,"anp","laxmi",[["ANP-SUGAR","kg",100],["ANP-ATTA-10","packet",6]],"delivered","partial"],
    [18,"ssb","ganesh",[["SSB-AAMRIT-160","box",6],["SSB-TOOFAN-750","crate",1]],"delivered","none"],
    [16,"anp","ganesh",[["ANP-TOOR","kg",30],["ANP-SHUB-1","packet",12]],"delivered","full"],
    [14,"ssb","omsai",[["SSB-CHT-MM-75","carton",1],["SSB-RNJ-SS-45","box",4]],"failed_then_delivered","partial"],
    [12,"kgw","navi",[["KGW-JAR-20","jar",30]],"delivered","advance"],
    [10,"anp","omsai",[["ANP-SURY-SUN-1L","carton",3],["ANP-SAGARSALT-1","packet",25]],"delivered","none"],
    [8,"ssb","ganesh",[["SSB-CRS-MM-52","carton",1],["SSB-SUNG-250","carton",1]],"delivered","reversed"],
    [6,"anp","laxmi",[["ANP-RICE-SM","bag",2]],"delivered","none"],
    [5,"ssb","omsai",[["SSB-NEER-1L","box",8],["SSB-AAMRIT-160","box",2]],"delivered","none"],
    [3,"ssb","ganesh",[["SSB-CRS-CS-52","carton",1],["SSB-CHT-MM-75","packet",24]],"out_for_delivery","none"],
    [2,"anp","ganesh",[["ANP-SUGAR","bag",1],["ANP-MOONG","kg",10]],"ready_for_delivery","none"],
    [2,"ssb","omsai",[["SSB-RNJ-MM-45","box",2],["SSB-TOOFAN-750","bottle",24]],"ready_for_delivery","none"],
    [1,"ssb","ganesh",[["SSB-SUNG-250","packet",24],["SSB-MDEW-200","packet",12]],"preparing","none"],
    [1,"anp","laxmi",[["ANP-ATTA-10","packet",4],["ANP-SURY-SUN-1L","packet",10]],"accepted","none"],
    [0,"ssb","ganesh",[["SSB-CRS-CS-52","packet",24],["SSB-NEER-1L","bottle",48]],"placed","none"],
    [0,"ssb","omsai",[["SSB-RNJ-SS-45","packet",48],["SSB-AAMRIT-160","piece",81]],"placed","none"],
    [0,"anp","omsai",[["ANP-RICE-KOLAM","kg",25],["ANP-TOOR","kg",10]],"placed","none"]
  ]'::jsonb;
  p jsonb;
  n int := 0;
  v_age int; v_w uuid; v_r uuid; v_ru uuid; v_wo uuid; v_worker uuid; v_stage text; v_pay text;
  v_items jsonb; v_t timestamptz; v_order uuid; v_delivery uuid; v_inv uuid; v_due numeric; v_pid uuid;
begin
  for p in select * from jsonb_array_elements(plan) loop
    n := n + 1;
    v_age := (p ->> 0)::int;
    v_w := case p ->> 1 when 'ssb' then ssb when 'anp' then anp else kgw end;
    v_wo := case p ->> 1 when 'ssb' then ssb_owner when 'anp' then anp_owner else kgw_owner end;
    v_worker := case p ->> 1 when 'ssb' then case when n % 2 = 0 then ravi else sunil end when 'anp' then imran else null end;
    v_r := case p ->> 2 when 'ganesh' then r_ganesh when 'omsai' then r_omsai when 'laxmi' then r_laxmi else r_navi end;
    v_ru := case p ->> 2 when 'ganesh' then u_ganesh when 'omsai' then u_omsai when 'laxmi' then u_laxmi else u_navi end;
    v_stage := p ->> 4;
    v_pay := p ->> 5;
    select jsonb_agg(jsonb_build_object('variant_unit_id', pg_temp.vu(i ->> 0, i ->> 1), 'quantity', (i ->> 2)::numeric))
      into v_items from jsonb_array_elements(p -> 3) i;

    v_t := date_trunc('day', now()) - make_interval(days => v_age) + interval '9 hours' + make_interval(mins => n * 7);
    if v_age = 0 then v_t := now() - make_interval(mins => 200 - n * 5); end if;

    perform pg_temp.act(v_ru, v_t);
    v_order := app.place_order(v_r, v_w, v_items, 'seed-order-' || lpad(n::text, 4, '0'), case when n % 5 = 0 then 'Please deliver before 11 am (demo note)' end);

    continue when v_stage = 'placed';
    perform pg_temp.act(v_wo, v_t + interval '40 minutes');
    if v_stage = 'cancelled' then
      perform app.transition_order(v_order, 'cancelled', 'Retailer asked to cancel by phone (demo)');
      continue;
    end if;
    perform app.transition_order(v_order, 'accepted', null);
    continue when v_stage = 'accepted';
    perform pg_temp.act(v_wo, v_t + interval '2 hours');
    perform app.transition_order(v_order, 'preparing', null);
    continue when v_stage = 'preparing';
    perform pg_temp.act(v_wo, v_t + interval '4 hours');
    perform app.transition_order(v_order, 'ready_for_delivery', null);
    if v_age >= 5 or v_stage = 'out_for_delivery' then
      v_inv := app.generate_invoice(v_order, null);
    end if;
    if v_worker is not null then
      v_delivery := app.assign_delivery(v_order, v_worker, null);
    end if;
    continue when v_stage = 'ready_for_delivery';

    if v_worker is null then
      -- Konkan delivers with its own staff; recorded directly on the order.
      perform pg_temp.act(v_wo, v_t + interval '5 hours');
      perform app.transition_order(v_order, 'out_for_delivery', null);
      perform pg_temp.act(v_wo, v_t + interval '7 hours');
      perform app.transition_order(v_order, 'delivered', 'Delivered by owner (demo)');
    else
      perform pg_temp.act(v_worker, v_t + interval '5 hours');
      perform app.update_delivery(v_delivery, 'out_for_delivery', null);
      continue when v_stage = 'out_for_delivery';
      perform pg_temp.act(v_worker, v_t + interval '7 hours');
      if v_stage = 'failed_then_delivered' then
        perform app.update_delivery(v_delivery, 'failed', null, 'Shop closed on arrival (demo)');
        perform pg_temp.act(v_wo, v_t + interval '1 day');
        v_delivery := app.assign_delivery(v_order, ravi, 'Second attempt');
        perform pg_temp.act(ravi, v_t + interval '1 day 2 hours');
        perform app.update_delivery(v_delivery, 'out_for_delivery', null);
        perform pg_temp.act(ravi, v_t + interval '1 day 4 hours');
        perform app.update_delivery(v_delivery, 'delivered', null, null, null, 'Shop owner (demo)');
      elsif v_stage = 'partial_delivery' then
        perform app.update_delivery(v_delivery, 'partially_delivered', '12 packets of cookies were damaged in transit (demo)', null,
          (select jsonb_agg(jsonb_build_object('order_item_id', oi.id,
                     'delivered_quantity', case when oi.sku = 'SSB-MDEW-200' then 0 else oi.quantity end))
             from public.order_items oi where oi.order_id = v_order),
          'Shop owner (demo)');
      else
        perform app.update_delivery(v_delivery, 'delivered', null, null, null, 'Shop owner (demo)');
      end if;
    end if;

    -- Invoice orders that were not invoiced before dispatch.
    perform pg_temp.act(v_wo, v_t + interval '1 day 6 hours');
    v_inv := app.generate_invoice(v_order, null);
    v_due := app.invoice_due(v_inv);

    if v_pay = 'full' then
      perform pg_temp.act(v_wo, v_t + interval '6 days');
      perform app.record_payment(v_w, v_r, v_due, case when n % 2 = 0 then 'upi' else 'cash' end::public.payment_method,
        case when n % 2 = 0 then 'UPI-DEMO-' || lpad(n::text, 6, '0') end, v_t + interval '6 days', null, 'seed-pay-' || n, null);
    elsif v_pay = 'partial' then
      perform pg_temp.act(v_wo, v_t + interval '5 days');
      perform app.record_payment(v_w, v_r, round(v_due * 0.6, 0), 'cash', null, v_t + interval '5 days',
        'Part payment (demo)', 'seed-pay-' || n, null);
    elsif v_pay = 'advance' then
      perform pg_temp.act(v_wo, v_t + interval '2 days');
      perform app.record_payment(v_w, v_r, v_due + 1000, 'bank_transfer', 'NEFT-DEMO-' || n, v_t + interval '2 days',
        'Paid in full plus Rs 1000 advance (demo)', 'seed-pay-' || n, null);
    elsif v_pay = 'reversed' then
      perform pg_temp.act(v_wo, v_t + interval '3 days');
      v_pid := app.record_payment(v_w, v_r, v_due, 'cheque', 'CHQ-DEMO-' || n, v_t + interval '3 days', null, 'seed-pay-' || n, null);
      perform pg_temp.act(v_wo, v_t + interval '5 days');
      perform app.reverse_payment(v_pid, 'Cheque bounced (demo)');
    end if;
  end loop;

  -- A goodwill credit note on one fully delivered, unpaid invoice.
  perform pg_temp.act(ssb_owner, now() - interval '1 day');
  perform app.create_credit_note(
    (select i.id from public.invoices i join public.orders o on o.id = i.order_id
      where o.idempotency_key = 'seed-order-0015'), 250.00, 'discount', 'Scheme discount on beverages (demo)');

  -- Tidy up: notifications for demo history are marked read except recent ones.
  update public.notifications set read_at = created_at + interval '1 hour' where created_at < now() - interval '2 days';
end $$;

-- Low-stock demonstration: a damaged-stock write-off.
select pg_temp.act('00000000-0000-4000-8000-000000000201', now() - interval '1 day');
select app.adjust_stock((select id from public.product_variants where sku = 'ANP-ATTA-10'), 'damage', 4, 'Torn bags written off (demo)');

-- Contact form messages
select pg_temp.act(null, now() - interval '3 days');
select set_config('request.jwt.claims', '', false);
select app.submit_support_request('Demo Visitor', 'visitor@example.com', null, 'sales',
  'I run a distribution business in Kolhapur and would like to know when plans will be available. (demo message)', 'contact_form');

select set_config('request.jwt.claims', '', false), set_config('app.seed_clock', '', false);
