-- Migration 0002: Atomic room creation function (FR-8.3, FR-2.1, US-DASH-03)

create or replace function public.create_room(
  p_owner uuid,
  p_name text,
  p_description text,
  p_code char(6),
  p_defaults jsonb
) returns public.rooms language plpgsql as $$
declare r public.rooms;
begin
  insert into public.rooms (name, description, join_code, owner_id, default_permissions)
  values (p_name, p_description, p_code, p_owner, p_defaults) returning * into r;

  insert into public.room_members (room_id, user_id, member_role,
    can_mic, can_camera, can_screen, can_whiteboard, can_code)
  values (r.id, p_owner, 'host', true, true, true, true, true);

  insert into public.code_state (room_id, holder_id) values (r.id, p_owner);
  insert into public.whiteboard_state (room_id) values (r.id);
  return r;
end; $$;
