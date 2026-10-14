import { supabase } from './supabase';
import { RoomSummary, MemberRole, CreateRoomDto, CreateRoomResponseDto, Permissions } from '@linkup/shared';

/**
 * Typed error thrown when a user attempts to access a room they are not a member of.
 * Maps to HTTP 403 NOT_A_MEMBER (US-ROOM-01, FR-2.4 AC-2).
 */
export class NotAMemberError extends Error {
  public readonly code = 'NOT_A_MEMBER';
  constructor() {
    super('You are not a member of this room');
    this.name = 'NotAMemberError';
  }
}

// ---------------------------------------------------------------------------
// Join-code generator (US-DASH-03 AC-4)
// Characters: A-Z, 2-9 — excludes O, 0, I, 1 to avoid visual ambiguity.
// ---------------------------------------------------------------------------
const JOIN_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += JOIN_CODE_CHARS[Math.floor(Math.random() * JOIN_CODE_CHARS.length)];
  }
  return code;
}

const DEFAULT_PERMISSIONS: Permissions = {
  canMic: true,
  canCamera: true,
  canScreen: false,
  canWhiteboard: true,
  canCode: true,
};

/**
 * Create a new room and add the creator as host (US-DASH-03, FR-8.3, FR-2.1)
 */
export async function createRoom(
  ownerId: string,
  ownerName: string,
  dto: CreateRoomDto
): Promise<CreateRoomResponseDto> {
  const joinCode = generateJoinCode();
  const permissions: Permissions = { ...DEFAULT_PERMISSIONS, ...dto.defaultPermissions };

  // 1. Insert the room row
  const { data: room, error: roomErr } = await supabase
    .from('rooms')
    .insert({
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      owner_id: ownerId,
      join_code: joinCode,
      default_permissions: permissions,
    })
    .select('id, name, description, join_code, owner_id, created_at')
    .single();

  if (roomErr || !room) {
    throw new Error(roomErr?.message || 'Failed to create room');
  }

  // 2. Add creator as host member
  const { error: memberErr } = await supabase
    .from('room_members')
    .insert({
      room_id: room.id,
      user_id: ownerId,
      member_role: 'host',
      permissions,
    });

  if (memberErr) {
    console.warn('[createRoom] Could not add host member row:', memberErr.message);
  }

  return {
    id: room.id,
    name: room.name,
    description: room.description,
    joinCode: room.join_code,
    hostName: ownerName,
    memberCount: 1,
    myRole: 'host',
    activeSessionId: null,
    createdAt: room.created_at,
  };
}

// In-memory mock store for unit/integration testing (e.g. scripts/test-dash-live-badge.ts)
const mockRoomsStore = new Map<string, RoomSummary[]>();

export function setMockRooms(userId: string, rooms: RoomSummary[]) {
  mockRoomsStore.set(userId, rooms);
}

export function clearMockRooms(userId?: string) {
  if (userId) {
    mockRoomsStore.delete(userId);
  } else {
    mockRoomsStore.clear();
  }
}

/**
 * Fetch all rooms the user is a member of with activeSessionId status (US-DASH-01, US-DASH-02, FR-8.1, FR-8.2)
 */
export async function getRoomsForUser(userId: string): Promise<RoomSummary[]> {
  // If mock rooms are registered for this user (e.g., in test harness), return them
  if (mockRoomsStore.has(userId)) {
    return mockRoomsStore.get(userId) || [];
  }

  try {
    // 1. Fetch memberships for the user
    const { data: memberRows, error: memError } = await supabase
      .from('room_members')
      .select('room_id, member_role')
      .eq('user_id', userId);

    if (memError) {
      console.warn('[Rooms Service] Error fetching room_members:', memError.message);
      return [];
    }

    if (!memberRows || memberRows.length === 0) {
      return [];
    }

    const roomIds = memberRows.map((m) => m.room_id);
    const roleByRoomId = new Map(memberRows.map((m) => [m.room_id, m.member_role as MemberRole]));

    // 2. Fetch room details ordered newest first (US-DASH-01 Criterion 3)
    const { data: roomRows, error: roomsError } = await supabase
      .from('rooms')
      .select('id, name, description, join_code, owner_id, created_at, archived_at')
      .in('id', roomIds)
      .is('archived_at', null)
      .order('created_at', { ascending: false });

    if (roomsError) {
      console.warn('[Rooms Service] Error fetching rooms:', roomsError.message);
      return [];
    }

    if (!roomRows || roomRows.length === 0) {
      return [];
    }

    // 3. Fetch host profile names
    const ownerIds = Array.from(new Set(roomRows.map((r) => r.owner_id)));
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', ownerIds);

    const hostNameById = new Map<string, string>();
    (profiles || []).forEach((p) => {
      hostNameById.set(p.id, p.full_name);
    });

    // 4. Fetch total member count per room
    const { data: allMembers } = await supabase
      .from('room_members')
      .select('room_id')
      .in('room_id', roomIds);

    const countByRoomId = new Map<string, number>();
    (allMembers || []).forEach((m) => {
      countByRoomId.set(m.room_id, (countByRoomId.get(m.room_id) || 0) + 1);
    });

    // 5. Fetch active live sessions where ended_at is null (US-DASH-02, FR-8.2)
    const { data: activeSessions } = await supabase
      .from('live_sessions')
      .select('id, room_id')
      .in('room_id', roomIds)
      .is('ended_at', null);

    const activeSessionByRoomId = new Map<string, string>();
    (activeSessions || []).forEach((s) => {
      activeSessionByRoomId.set(s.room_id, s.id);
    });

    // 6. Map to RoomSummary DTO
    const summaries: RoomSummary[] = roomRows.map((r) => {
      const myRole = roleByRoomId.get(r.id) || 'participant';
      const activeSessionId = activeSessionByRoomId.get(r.id) || null;

      return {
        id: r.id,
        name: r.name,
        description: r.description,
        joinCode: myRole === 'host' ? r.join_code : null, // FR-8.4, US-DASH-05: only host sees join code
        hostName: hostNameById.get(r.owner_id) || 'Instructor',
        memberCount: countByRoomId.get(r.id) || 1,
        myRole,
        activeSessionId, // US-DASH-02: non-null if live session active
        createdAt: r.created_at,
      };
    });

    return summaries;
  } catch (err) {
    console.error('[Rooms Service] Unexpected error:', err);
    return [];
  }
}

/**
 * Fetch a single room for a specific user and enforce membership.
 * Throws NotAMemberError (→ 403 NOT_A_MEMBER) if user is not a member.
 * Returns null if the room does not exist (→ 404).
 * (US-ROOM-01, FR-2.4)
 */
export async function getRoomForUser(
  userId: string,
  roomId: string
): Promise<RoomSummary> {
  // 1. Check membership
  const { data: memberRow, error: memErr } = await supabase
    .from('room_members')
    .select('member_role')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();

  if (memErr) {
    console.warn('[Rooms Service] Membership check error:', memErr.message);
    throw new Error(memErr.message);
  }

  if (!memberRow) {
    // User is not a member — check if the room even exists for a better error
    const { data: exists } = await supabase
      .from('rooms')
      .select('id')
      .eq('id', roomId)
      .maybeSingle();

    if (!exists) {
      // Room truly not found — caller maps to 404
      throw Object.assign(new Error('Room not found'), { code: 'ROOM_NOT_FOUND' });
    }

    throw new NotAMemberError();
  }

  const myRole = memberRow.member_role as MemberRole;

  // 2. Fetch room details
  const { data: room, error: roomErr } = await supabase
    .from('rooms')
    .select('id, name, description, join_code, owner_id, created_at, archived_at')
    .eq('id', roomId)
    .is('archived_at', null)
    .maybeSingle();

  if (roomErr || !room) {
    throw Object.assign(new Error('Room not found'), { code: 'ROOM_NOT_FOUND' });
  }

  // 3. Host name
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', room.owner_id)
    .maybeSingle();

  // 4. Member count
  const { count } = await supabase
    .from('room_members')
    .select('room_id', { count: 'exact', head: true })
    .eq('room_id', roomId);

  // 5. Active session
  const { data: session } = await supabase
    .from('live_sessions')
    .select('id')
    .eq('room_id', roomId)
    .is('ended_at', null)
    .maybeSingle();

  return {
    id: room.id,
    name: room.name,
    description: room.description,
    joinCode: myRole === 'host' ? room.join_code : null,
    hostName: profile?.full_name || 'Instructor',
    memberCount: count ?? 1,
    myRole,
    activeSessionId: session?.id ?? null,
    createdAt: room.created_at,
  };
}
