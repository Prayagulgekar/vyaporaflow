-- =============================================================================
-- 0900 Reference data required in every environment
-- =============================================================================

insert into public.indian_states (code, name) values
  ('01', 'Jammu and Kashmir'), ('02', 'Himachal Pradesh'), ('03', 'Punjab'), ('04', 'Chandigarh'),
  ('05', 'Uttarakhand'), ('06', 'Haryana'), ('07', 'Delhi'), ('08', 'Rajasthan'), ('09', 'Uttar Pradesh'),
  ('10', 'Bihar'), ('11', 'Sikkim'), ('12', 'Arunachal Pradesh'), ('13', 'Nagaland'), ('14', 'Manipur'),
  ('15', 'Mizoram'), ('16', 'Tripura'), ('17', 'Meghalaya'), ('18', 'Assam'), ('19', 'West Bengal'),
  ('20', 'Jharkhand'), ('21', 'Odisha'), ('22', 'Chhattisgarh'), ('23', 'Madhya Pradesh'), ('24', 'Gujarat'),
  ('26', 'Dadra and Nagar Haveli and Daman and Diu'), ('27', 'Maharashtra'), ('29', 'Karnataka'), ('30', 'Goa'),
  ('31', 'Lakshadweep'), ('32', 'Kerala'), ('33', 'Tamil Nadu'), ('34', 'Puducherry'),
  ('35', 'Andaman and Nicobar Islands'), ('36', 'Telangana'), ('37', 'Andhra Pradesh'), ('38', 'Ladakh')
on conflict (code) do nothing;

insert into public.units_of_measure (code, name, plural_name, dimension, base_factor, allows_fraction) values
  ('piece', 'Piece', 'Pieces', 'count', null, false),
  ('packet', 'Packet', 'Packets', 'count', null, false),
  ('box', 'Box', 'Boxes', 'count', null, false),
  ('carton', 'Carton', 'Cartons', 'count', null, false),
  ('bag', 'Bag', 'Bags', 'count', null, false),
  ('crate', 'Crate', 'Crates', 'count', null, false),
  ('bottle', 'Bottle', 'Bottles', 'count', null, false),
  ('jar', 'Jar', 'Jars', 'count', null, false),
  ('tin', 'Tin', 'Tins', 'count', null, false),
  ('dozen', 'Dozen', 'Dozens', 'count', null, false),
  ('cylinder', 'Cylinder', 'Cylinders', 'count', null, false),
  ('kg', 'Kilogram', 'Kilograms', 'mass', 1000, true),
  ('g', 'Gram', 'Grams', 'mass', 1, true),
  ('quintal', 'Quintal', 'Quintals', 'mass', 100000, true),
  ('litre', 'Litre', 'Litres', 'volume', 1000, true),
  ('ml', 'Millilitre', 'Millilitres', 'volume', 1, true)
on conflict (code) do nothing;

-- Platform default tax classes. Rates must be confirmed per HSN code by the
-- business; the platform does not determine the correct GST rate.
insert into public.tax_classes (company_id, name, rate) values
  (null, 'GST exempt / nil rated (0%)', 0),
  (null, 'GST 5%', 5),
  (null, 'GST 18%', 18),
  (null, 'GST 40%', 40),
  (null, 'GST 12% (legacy rate)', 12),
  (null, 'GST 28% (legacy rate)', 28)
on conflict do nothing;

insert into public.product_categories (company_id, name, slug, attribute_schema, workflow_flags, sort_order) values
  (null, 'Packaged snacks', 'packaged-snacks', '[{"key":"flavour","label":"Flavour","type":"text"},{"key":"shelf_life_days","label":"Shelf life (days)","type":"number"}]', '{}', 10),
  (null, 'Biscuits', 'biscuits', '[{"key":"shelf_life_days","label":"Shelf life (days)","type":"number"}]', '{}', 20),
  (null, 'Bakery', 'bakery', '[{"key":"shelf_life_days","label":"Shelf life (days)","type":"number","required":true}]', '{"perishable": true}', 30),
  (null, 'Rice and grains', 'rice-grains', '[{"key":"grain_type","label":"Grain type","type":"text"},{"key":"crop_year","label":"Crop year","type":"text"}]', '{}', 40),
  (null, 'Flour (atta)', 'flour', '[{"key":"grain_type","label":"Made from","type":"text"}]', '{}', 50),
  (null, 'Pulses (dal)', 'pulses', '[{"key":"grade","label":"Grade","type":"text"}]', '{}', 60),
  (null, 'Sugar and jaggery', 'sugar', '[]', '{}', 70),
  (null, 'Cooking oil', 'cooking-oil', '[{"key":"oil_type","label":"Oil type","type":"text","required":true}]', '{}', 80),
  (null, 'Beverages', 'beverages', '[{"key":"volume_ml","label":"Volume (ml)","type":"number"}]', '{}', 90),
  (null, 'Bottled water', 'bottled-water', '[{"key":"volume_ml","label":"Volume (ml)","type":"number","required":true}]', '{"returnable_containers": true}', 100),
  (null, 'Household products', 'household', '[]', '{}', 110),
  (null, 'Kirana and grocery', 'kirana', '[]', '{}', 120),
  (null, 'Gas cylinders', 'gas-cylinders', '[{"key":"net_weight_kg","label":"Net gas weight (kg)","type":"number","required":true},{"key":"cylinder_type","label":"Cylinder type","type":"text"}]', '{"requires_empty_return": true}', 130),
  (null, 'Other', 'other', '[]', '{}', 999)
on conflict do nothing;

insert into public.platform_settings (key, value, description) values
  ('default_search_radius_km', '50', 'Default marketplace search radius'),
  ('allowed_search_radii_km', '[10, 25, 50, 60]', 'Radius options shown to retailers'),
  ('marketplace_enabled', 'true', 'Show the public marketplace'),
  ('new_wholesalers_listed', 'true', 'List newly registered wholesalers in the marketplace by default'),
  ('support_email', '"support@example.com"', 'Shown on the contact page. Replace before launch.')
on conflict (key) do nothing;

-- Approximate city and PIN code centroids for location entry without a
-- geocoding API. Coordinates are approximate (about 1-3 km) and cover a small
-- set of areas only. Production deployments should add a geocoding provider.
insert into public.geo_places (kind, name, pincode, state_code, latitude, longitude) values
  ('city', 'Pune', null, '27', 18.5204, 73.8567),
  ('city', 'Pimpri-Chinchwad', null, '27', 18.6298, 73.7997),
  ('city', 'Mumbai', null, '27', 19.0760, 72.8777),
  ('city', 'Thane', null, '27', 19.2183, 72.9781),
  ('city', 'Navi Mumbai', null, '27', 19.0330, 73.0297),
  ('city', 'Nashik', null, '27', 19.9975, 73.7898),
  ('city', 'Lonavala', null, '27', 18.7546, 73.4062),
  ('city', 'Nagpur', null, '27', 21.1458, 79.0882),
  ('city', 'Ahmedabad', null, '24', 23.0225, 72.5714),
  ('city', 'Surat', null, '24', 21.1702, 72.8311),
  ('city', 'Bengaluru', null, '29', 12.9716, 77.5946),
  ('city', 'Hyderabad', null, '36', 17.3850, 78.4867),
  ('city', 'Chennai', null, '33', 13.0827, 80.2707),
  ('city', 'Delhi', null, '07', 28.6139, 77.2090),
  ('city', 'Jaipur', null, '08', 26.9124, 75.7873),
  ('city', 'Lucknow', null, '09', 26.8467, 80.9462),
  ('city', 'Kolkata', null, '19', 22.5726, 88.3639),
  ('city', 'Indore', null, '23', 22.7196, 75.8577),
  ('pincode', 'Pune GPO', '411001', '27', 18.5196, 73.8553),
  ('pincode', 'Shivajinagar, Pune', '411005', '27', 18.5308, 73.8475),
  ('pincode', 'Kothrud, Pune', '411038', '27', 18.5074, 73.8077),
  ('pincode', 'Viman Nagar, Pune', '411014', '27', 18.5679, 73.9143),
  ('pincode', 'Hadapsar, Pune', '411028', '27', 18.5089, 73.9260),
  ('pincode', 'Market Yard, Pune', '411037', '27', 18.4869, 73.8722),
  ('pincode', 'Pimpri, Pune', '411018', '27', 18.6279, 73.8009),
  ('pincode', 'Hinjewadi, Pune', '411057', '27', 18.5913, 73.7389),
  ('pincode', 'Wagholi, Pune', '412207', '27', 18.5793, 73.9787),
  ('pincode', 'Lonavala', '410401', '27', 18.7546, 73.4062),
  ('pincode', 'Fort, Mumbai', '400001', '27', 18.9353, 72.8355),
  ('pincode', 'Kurla, Mumbai', '400070', '27', 19.0726, 72.8845),
  ('pincode', 'Vashi, Navi Mumbai', '400703', '27', 19.0771, 72.9986),
  ('pincode', 'Thane West', '400601', '27', 19.1943, 72.9702),
  ('pincode', 'Nashik', '422001', '27', 19.9975, 73.7898),
  ('pincode', 'Bengaluru GPO', '560001', '29', 12.9763, 77.6033),
  ('pincode', 'Ahmedabad', '380001', '24', 23.0258, 72.5873),
  ('pincode', 'New Delhi', '110001', '07', 28.6328, 77.2197),
  ('pincode', 'Hyderabad', '500001', '36', 17.3850, 78.4867)
on conflict do nothing;
