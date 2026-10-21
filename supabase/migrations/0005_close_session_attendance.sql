-- Migration 0003: US-ATT-05 End Session Closes All Records (FR-6.5)
-- Close open attendance for a session (on session end or server boot recovery)

create or replace function public.close_session_attendance(p_session uuid, p_at timestamptz)
returns void language sql as $$
  update public.attendance set left_at = greatest(p_at, joined_at)
  where session_id = p_session and left_at is null;
$$;

revoke execute on function public.close_session_attendance(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.close_session_attendance(uuid, timestamptz) to service_role;
