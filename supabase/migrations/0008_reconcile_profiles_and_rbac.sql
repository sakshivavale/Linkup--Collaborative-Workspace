-- ============================================================================
-- Migration: 0008_reconcile_profiles_and_rbac.sql
-- Purpose:
-- 1. Ensure user_role enum supports 'admin', 'teacher', 'student'.
-- 2. Add missing columns: is_verified, is_approved, "isApproved", is_suspended, "isSuspended", status.
-- 3. Synchronize snake_case and camelCase column pairs automatically.
-- 4. Fix handle_new_user() trigger to be case-insensitive for role matching ('TEACHER' vs 'teacher')
--    and correctly support super-admin and auto-approved student roles.
-- 5. Add RLS policies on public.profiles so authenticated users can read profiles and edit their own.
-- ============================================================================

-- 1. Ensure user_role enum includes 'admin'
do $$ begin
  alter type public.user_role add value if not exists 'admin';
exception when others then null;
end $$;

-- 2. Ensure all required columns exist in public.profiles
alter table public.profiles
  add column if not exists is_verified boolean not null default false,
  add column if not exists is_approved boolean not null default true,
  add column if not exists "isApproved" boolean not null default true,
  add column if not exists is_suspended boolean not null default false,
  add column if not exists "isSuspended" boolean not null default false,
  add column if not exists status text not null default 'APPROVED';

-- 3. Function and trigger to keep snake_case and camelCase flags in sync
create or replace function public.sync_profile_columns()
returns trigger language plpgsql as $$
begin
  -- Sync approval
  if new.is_approved is distinct from old.is_approved then
    new."isApproved" := new.is_approved;
  elsif new."isApproved" is distinct from old."isApproved" then
    new.is_approved := new."isApproved";
  end if;

  -- Sync suspension
  if new.is_suspended is distinct from old.is_suspended then
    new."isSuspended" := new.is_suspended;
  elsif new."isSuspended" is distinct from old."isSuspended" then
    new.is_suspended := new."isSuspended";
  end if;

  return new;
end; $$;

drop trigger if exists trg_sync_profile_columns on public.profiles;
create trigger trg_sync_profile_columns
  before insert or update on public.profiles
  for each row execute function public.sync_profile_columns();

-- 4. Reconcile handle_new_user() trigger function
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_raw_role text;
  v_role_str text;
  v_is_approved boolean;
  v_status text;
  v_role public.user_role;
  v_email text;
begin
  v_email := lower(coalesce(new.email, ''));
  v_raw_role := coalesce(
    new.raw_user_meta_data->>'role',
    new.raw_user_meta_data->>'requested_role',
    new.raw_user_meta_data->>'requestedRole',
    'student'
  );
  v_role_str := lower(trim(v_raw_role));

  -- Case A: Super-Admin auto-approval or explicit admin selection
  if v_email in ('support@gmail.com', 'sakshivavale9@gmail.com') or v_role_str = 'admin' then
    begin
      v_role := 'admin'::public.user_role;
    exception when others then
      v_role := 'teacher'::public.user_role;
    end;
    v_is_approved := true;
    v_status := 'APPROVED';

  -- Case B: Teacher registration (requires administrator approval unless pre-approved)
  elsif v_role_str = 'teacher' then
    v_role := 'teacher'::public.user_role;
    v_is_approved := coalesce(
      (new.raw_user_meta_data->>'isApproved')::boolean,
      (new.raw_user_meta_data->>'is_approved')::boolean,
      false
    );
    v_status := case
      when v_is_approved then 'APPROVED'
      else coalesce(new.raw_user_meta_data->>'status', 'PENDING_TEACHER')
    end;

  -- Case C: Student auto-approval
  else
    v_role := 'student'::public.user_role;
    v_is_approved := true;
    v_status := 'APPROVED';
  end if;

  insert into public.profiles (
    id,
    full_name,
    role,
    is_verified,
    is_approved,
    "isApproved",
    is_suspended,
    "isSuspended",
    status
  ) values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), nullif(trim(new.raw_user_meta_data->>'fullName'), ''), split_part(new.email, '@', 1)),
    v_role,
    v_is_approved,
    v_is_approved,
    v_is_approved,
    false,
    false,
    v_status
  )
  on conflict (id) do update set
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    role = excluded.role,
    is_verified = excluded.is_verified,
    is_approved = excluded.is_approved,
    "isApproved" = excluded."isApproved",
    status = excluded.status;

  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. Row Level Security Policies for public.profiles
alter table public.profiles enable row level security;

drop policy if exists "Authenticated users can view profiles" on public.profiles;
create policy "Authenticated users can view profiles" on public.profiles
  for select to authenticated using (true);

drop policy if exists "Anon users can view profiles" on public.profiles;
create policy "Anon users can view profiles" on public.profiles
  for select to anon using (true);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Service role full access to profiles" on public.profiles;
create policy "Service role full access to profiles" on public.profiles
  for all to service_role
  using (true)
  with check (true);

-- 6. Reconcile existing data
update public.profiles
set "isApproved" = is_approved
where "isApproved" is distinct from is_approved;

update public.profiles
set "isSuspended" = is_suspended
where "isSuspended" is distinct from is_suspended;
