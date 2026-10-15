-- Dashboard: rooms for a user with host name, member count, my role, and active session
create or replace function public.my_rooms(p_user uuid)
returns table (
  id uuid,
  name text,
  description text,
  join_code char(6),
  host_name text,
  member_count bigint,
  my_role public.member_role,
  active_session_id uuid,
  created_at timestamptz
)
language sql
stable
as $$
  select
    r.id,
    r.name,
    r.description,
    case when m.member_role = 'host' then r.join_code else null end,
    hp.full_name,
    (select count(*) from public.room_members x where x.room_id = r.id),
    m.member_role,
    (select s.id from public.live_sessions s where s.room_id = r.id and s.ended_at is null),
    r.created_at
  from public.room_members m
  join public.rooms r
    on r.id = m.room_id and r.archived_at is null
  join public.profiles hp
    on hp.id = r.owner_id
  where m.user_id = p_user
  order by r.created_at desc;
$$;
