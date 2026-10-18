-- Migration 0003: Attendance Summary RPC for US-ATT-04 (FR-6.4)
create or replace function public.attendance_summary(p_session uuid)
returns table (
  user_id uuid,
  name text,
  first_join timestamptz,
  last_leave timestamptz,
  total_minutes numeric,
  join_count bigint
)
language sql
stable
as $$
  select
    a.user_id,
    coalesce(p.full_name, 'Unknown') as name,
    min(a.joined_at) as first_join,
    case
      when count(*) filter (where a.left_at is null) > 0 then null
      else max(a.left_at)
    end as last_leave,
    round(sum(extract(epoch from (coalesce(a.left_at, s.ended_at, now()) - a.joined_at)) / 60)) as total_minutes,
    count(a.id) as join_count
  from public.attendance a
  join public.live_sessions s on s.id = a.session_id
  left join public.profiles p on p.id = a.user_id
  where a.session_id = p_session
  group by a.user_id, p.full_name;
$$;
