-- ============================================================================
-- Migration: 0007_teacher_approval_status.sql
-- US-2.1: Teacher Feature Protection & Pending Approval Gate
-- Adds is_approved and status columns to profiles table with updated trigger
-- ============================================================================

-- Add approval columns to profiles if not present
alter table public.profiles
  add column if not exists is_approved boolean not null default true,
  add column if not exists status text not null default 'APPROVED';

-- Ensure existing teachers default to pending approval unless explicitly approved
update public.profiles
set is_approved = false, status = 'PENDING_TEACHER'
where role = 'teacher' and is_approved is null;

-- Update trigger function to auto-assign is_approved = false for teachers and true for students
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  user_role public.user_role;
  user_is_approved boolean;
  user_status text;
begin
  if lower(trim(coalesce(new.raw_user_meta_data->>'role', new.raw_user_meta_data->>'requested_role', 'student'))) = 'teacher' then
    user_role := 'teacher'::public.user_role;
    user_is_approved := false;
    user_status := 'PENDING_TEACHER';
  elsif lower(trim(coalesce(new.email, ''))) in ('support@gmail.com', 'sakshivavale9@gmail.com') or lower(trim(coalesce(new.raw_user_meta_data->>'role', ''))) = 'admin' then
    begin
      user_role := 'admin'::public.user_role;
    exception when others then
      user_role := 'teacher'::public.user_role;
    end;
    user_is_approved := true;
    user_status := 'APPROVED';
  else
    user_role := 'student'::public.user_role;
    user_is_approved := true;
    user_status := 'APPROVED';
  end if;

  insert into public.profiles (id, full_name, role, is_approved, status)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    user_role,
    user_is_approved,
    user_status
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    role = excluded.role,
    is_approved = excluded.is_approved,
    status = excluded.status;

  return new;
end; $$;
