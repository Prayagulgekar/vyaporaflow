-- =============================================================================
-- 1000 Optional platform features, applied only where available:
--   * PostGIS: geography column + GiST index; app.candidate_wholesalers()
--     switches to ST_DWithin. Without PostGIS the bounding-box + haversine
--     implementation from migration 0700 is used.
--   * Supabase Storage: a public "company-assets" bucket for logos and product
--     images, writable only by owners/managers into their company's folder.
-- =============================================================================

DO $outer$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'postgis'
  ) THEN

    IF EXISTS (
      SELECT 1 FROM pg_namespace WHERE nspname = 'extensions'
    ) THEN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions';
    ELSE
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS postgis';
    END IF;

    EXECUTE $sql$
      ALTER TABLE public.business_addresses
        ADD COLUMN IF NOT EXISTS geog extensions.geography(Point, 4326)
        GENERATED ALWAYS AS (
          CASE
            WHEN latitude IS NOT NULL AND longitude IS NOT NULL
            THEN extensions.ST_SetSRID(
              extensions.ST_MakePoint(
                longitude::float8,
                latitude::float8
              ),
              4326
            )::extensions.geography
          END
        ) STORED
    $sql$;

    EXECUTE '
      CREATE INDEX IF NOT EXISTS business_addresses_geog_idx
      ON public.business_addresses USING gist (geog)
    ';

    EXECUTE $sql$
      CREATE OR REPLACE FUNCTION app.candidate_wholesalers(
        p_lat numeric,
        p_lng numeric,
        p_radius_km numeric
      )
      RETURNS SETOF uuid
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, app, extensions, pg_temp
      AS $f$
        SELECT a.company_id
        FROM public.business_addresses a
        WHERE a.is_primary
          AND extensions.ST_DWithin(
            a.geog,
            extensions.ST_SetSRID(
              extensions.ST_MakePoint(
                p_lng::float8,
                p_lat::float8
              ),
              4326
            )::extensions.geography,
            p_radius_km * 1000
          )
      $f$
    $sql$;

    RAISE NOTICE 'PostGIS enabled for wholesaler discovery';

  ELSE
    RAISE NOTICE 'PostGIS not available; using bounding box + haversine discovery';
  END IF;
END
$outer$;

DO $outer$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'storage'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_tables
    WHERE schemaname = 'storage'
      AND tablename = 'buckets'
  ) THEN

    INSERT INTO storage.buckets (
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    )
    VALUES (
      'company-assets',
      'company-assets',
      TRUE,
      2097152,
      ARRAY['image/png', 'image/jpeg', 'image/webp']
    )
    ON CONFLICT (id) DO NOTHING;

    EXECUTE $sql$
      CREATE POLICY company_assets_insert
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'company-assets'
        AND app.can_manage(((storage.foldername(name))[1])::uuid)
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY company_assets_update
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'company-assets'
        AND app.can_manage(((storage.foldername(name))[1])::uuid)
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY company_assets_delete
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'company-assets'
        AND app.can_manage(((storage.foldername(name))[1])::uuid)
      )
    $sql$;

    RAISE NOTICE 'Supabase Storage bucket company-assets configured';

  END IF;
END
$outer$;