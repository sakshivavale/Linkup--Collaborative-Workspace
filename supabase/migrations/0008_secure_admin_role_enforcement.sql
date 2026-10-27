-- Migration 0008: Secure Admin Role Enforcement & Public Signup Restrictions
-- Prevents public users from provisioning an admin role via client-supplied metadata.
-- Only pre-designated super-admin emails ('support@gmail.com', 'sakshivavale9@gmail.com') receive role = 'admin'.
-- Any client-supplied 'admin' role from untrusted emails is rejected and falls back to 'student'.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role_str text;
  v_is_approved boolean;
  v_status text;
  v_role public.user_role;
  v_email text;
begin
  v_email := lower(coalesce(new.email, ''));
  v_role_str := lower(coalesce(new.raw_user_meta_data->>'role', 'student'));
  
  -- Super-admin auto-provisioning for authorized emails only
  if v_email in ('support@gmail.com', 'sakshivavale9@gmail.com') then
    begin
      v_role := 'admin'::public.user_role;
    exception when others then
      v_role := 'teacher'::public.user_role;
    end;
    v_is_approved := true;
    v_status := 'APPROVED';
  elsif v_role_str = 'teacher' then
    v_role := 'teacher'::public.user_role;
    -- Teacher accounts are pending admin verification by default
    v_is_approved := false;
    v_status := 'PENDING_TEACHER';
  else
    -- All other signups (including any client-supplied 'admin' role) fall back to 'student'
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
