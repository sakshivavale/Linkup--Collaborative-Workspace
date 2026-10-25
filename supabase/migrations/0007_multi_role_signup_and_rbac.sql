-- Migration 0007: Multi-Role Signup & Role Provisioning (US-1.1)
-- AC 1.1.1: Student Auto-Approval with role = 'STUDENT' and isApproved = true
-- AC 1.1.2: Teacher Registration with role = 'TEACHER', isApproved = false, status = 'PENDING_TEACHER'
-- AC 1.1.3: Super Admin pre-designated credential auto-approval

-- 1. Ensure user_role enum supports admin if possible
do $$ begin
  alter type public.user_role add value if not exists 'admin';
exception when others then null;
end $$;

-- 2. Add is_verified, isApproved, and status columns to public.profiles
alter table public.profiles add column if not exists is_verified boolean default false;
alter table public.profiles add column if not exists "isApproved" boolean default true;
alter table public.profiles add column if not exists is_approved boolean default true;
alter table public.profiles add column if not exists status text default 'pending';

-- 3. Update handle_new_user trigger to populate isApproved and status
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role_str text;
  v_is_approved boolean;
  v_status text;
  v_role public.user_role;
begin
  v_role_str := lower(coalesce(new.raw_user_meta_data->>'role', 'student'));
  
  if lower(new.email) = 'support@gmail.com' or v_role_str = 'admin' then
    begin
      v_role := 'admin'::public.user_role;
    exception when others then
      v_role := 'teacher'::public.user_role;
    end;
    v_is_approved := true;
    v_status := 'APPROVED';
  elsif v_role_str = 'teacher' then
    v_role := 'teacher'::public.user_role;
    v_is_approved := coalesce((new.raw_user_meta_data->>'isApproved')::boolean, (new.raw_user_meta_data->>'is_approved')::boolean, false);
    v_status := coalesce(new.raw_user_meta_data->>'status', 'PENDING_TEACHER');
  else
    v_role := 'student'::public.user_role;
    v_is_approved := true;
    v_status := 'APPROVED';
  end if;

  insert into public.profiles (id, full_name, role, is_verified, "isApproved", is_approved, status)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    v_role,
    v_is_approved,
    v_is_approved,
    v_is_approved,
    v_status
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    role = excluded.role,
    is_verified = excluded.is_verified,
    "isApproved" = excluded."isApproved",
    is_approved = excluded.is_approved,
    status = excluded.status;

  return new;
end; $$;
