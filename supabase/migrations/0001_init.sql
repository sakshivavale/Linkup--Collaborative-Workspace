-- ============ Types ============
do $$ begin
  create type public.user_role as enum ('teacher', 'student');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.member_role as enum ('host', 'participant');
exception when duplicate_object then null;
end $$;

-- ============ Profiles ============
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null check (char_length(full_name) between 1 and 100),
  role        public.user_role not null default 'student',
  created_at  timestamptz not null default now()
);

-- Auto-create a profile on signup from user metadata {full_name, role}
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    case when new.raw_user_meta_data->>'role' = 'teacher'
         then 'teacher'::public.user_role else 'student'::public.user_role end
  );
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ Rooms ============
create table if not exists public.rooms (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (char_length(name) between 1 and 80),
  description          text check (description is null or char_length(description) <= 500),
  join_code            char(6) not null unique,
  owner_id             uuid not null references public.profiles(id),
  default_permissions  jsonb not null default
    '{"can_mic":false,"can_camera":false,"can_screen":false,"can_whiteboard":false,"can_code":false}'::jsonb,
  archived_at          timestamptz,
  created_at           timestamptz not null default now()
);

-- ============ Members + permissions ============
create table if not exists public.room_members (
  room_id         uuid not null references public.rooms(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  member_role     public.member_role not null default 'participant',
  can_mic         boolean not null default false,
  can_camera      boolean not null default false,
  can_screen      boolean not null default false,
  can_whiteboard  boolean not null default false,
  can_code        boolean not null default false,
  joined_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists room_members_user_idx on public.room_members (user_id);

-- ============ Live sessions ============
create table if not exists public.live_sessions (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,
  started_by    uuid not null references public.profiles(id),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  livekit_room  text generated always as ('linkup-' || id::text) stored unique
);
-- at most one active session per room
create unique index if not exists live_sessions_one_active
  on public.live_sessions (room_id) where ended_at is null;

-- ============ Attendance ============
create table if not exists public.attendance (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references public.live_sessions(id) on delete cascade,
  room_id     uuid not null references public.rooms(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,
  check (left_at is null or left_at >= joined_at)
);
-- at most one OPEN record per user per session (reconnect reuses it)
create unique index if not exists attendance_one_open
  on public.attendance (session_id, user_id) where left_at is null;
create index if not exists attendance_session_idx on public.attendance (session_id);

-- ============ Chat ============
create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  room_id     uuid not null references public.rooms(id) on delete cascade,
  session_id  uuid references public.live_sessions(id) on delete set null,
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists messages_room_created_idx on public.messages (room_id, created_at desc);

-- ============ Code workspace ============
create table if not exists public.code_state (
  room_id     uuid primary key references public.rooms(id) on delete cascade,
  language    text not null default 'python'
              check (language in ('python','javascript','cpp','java')),
  content     text not null default '' check (octet_length(content) <= 65536),
  holder_id   uuid references public.profiles(id) on delete set null,
  rev         integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- ============ Whiteboard ============
create table if not exists public.whiteboard_state (
  room_id     uuid primary key references public.rooms(id) on delete cascade,
  elements    jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ============ RLS: on, no policies (backend-only access) ============
alter table public.profiles          enable row level security;
alter table public.rooms             enable row level security;
alter table public.room_members      enable row level security;
alter table public.live_sessions     enable row level security;
alter table public.attendance        enable row level security;
alter table public.messages          enable row level security;
alter table public.code_state        enable row level security;
alter table public.whiteboard_state  enable row level security;
