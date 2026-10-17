-- Attendance summary for one session (US-ATT-04, US-ATT-06, FR-6.4, FR-6.6, docs/database.md)
create or replace function public.attendance_summary(p_session uuid)
returns table (
  user_id uuid,
  full_name text,
  first_join timestamptz,
  last_leave timestamptz,
  minutes int,
  joins bigint
)
language sql stable as $$
  select a.user_id,
         p.full_name,
         min(a.joined_at),
         max(coalesce(a.left_at, now())),
         round(sum(extract(epoch from coalesce(a.left_at, now()) - a.joined_at)) / 60)::int,
         count(*)
  from public.attendance a
  join public.profiles p on p.id = a.user_id
  where a.session_id = p_session
  group by a.user_id, p.full_name
  order by p.full_name;
$$;

revoke execute on function public.attendance_summary(uuid) from public, anon;
grant  execute on function public.attendance_summary(uuid) to authenticated, service_role;
