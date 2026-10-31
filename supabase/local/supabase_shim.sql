-- =============================================================================
-- VyaporaFlow: Supabase compatibility shim (LOCAL DEMO AND TEST DATABASES ONLY)
--
-- A hosted Supabase project already provides the roles, the `auth` schema,
-- `auth.users` and `auth.uid()`. Local demo mode (PGlite or a plain PostgreSQL
-- server) does not, so this file recreates the minimal subset the migrations
-- depend on. It is NEVER applied to a Supabase project.
--
-- The demo auth tables (auth.demo_sessions, auth.demo_password_resets) back the
-- local-only email/password login. They do not exist in Supabase mode, where
-- Supabase Auth issues and validates sessions.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create extension if not exists pgcrypto;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  banned_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mirrors Supabase: auth.uid() reads the `sub` claim of the request JWT, which
-- the trusted server sets per transaction with set_config(..., true).
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- Demo-only session store. Tokens are stored as SHA-256 hashes.
create table if not exists auth.demo_sessions (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists auth.demo_password_resets (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

revoke all on auth.users, auth.demo_sessions, auth.demo_password_resets from anon, authenticated;
