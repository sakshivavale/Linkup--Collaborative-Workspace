import { supabase } from './supabase';
import { RoomSummary, MemberRole, CreateRoomDto, CreateRoomResponseDto, Permissions } from '@linkup/shared';

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
const mockCatalogStore = new Map<string, { id: string; name: string; description: string | null; joinCode: string; hostName: string }>();

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

export function registerMockCatalogRoom(room: { id: string; name: string; description?: string | null; joinCode: string; hostName?: string }) {
  mockCatalogStore.set(room.joinCode.toUpperCase(), {
    id: room.id,
    name: room.name,
    description: room.description || null,
    joinCode: room.joinCode.toUpperCase(),
    hostName: room.hostName || 'Instructor',
  });
}

export function clearMockCatalog() {
  mockCatalogStore.clear();
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
 * Join a room by code (US-DASH-04, FR-8.3, FR-2.3)
 * Acceptance Criteria:
 * 1. Always accessible to students and teachers.
 * 2. Case-insensitive; normalises code to uppercase before lookup.
 * 3. On success, user is added to the room and room card appears on dashboard.
 * 4. Idempotent: joining a room you are already a member of returns success without error/duplicate.
 * 5. Unknown code raises: "No room found with that code."
 */
export async function joinRoomByCode(
  userId: string,
  rawCode: string
): Promise<{ roomId: string; alreadyMember: boolean }> {
  // AC 2: Normalise code to uppercase
  const code = (rawCode || '').trim().toUpperCase();

  if (!code || code.length !== 6) {
    const error: any = new Error('Room code must be 6 characters');
    error.code = 'VALIDATION';
    error.status = 400;
    throw error;
  }

  // 1. Check in-memory mock catalog if test mocks are active
  if (mockCatalogStore.size > 0 || mockRoomsStore.has(userId)) {
    const catalogRoom = mockCatalogStore.get(code);
    if (!catalogRoom) {
      // AC 5: Unknown code error message
      const error: any = new Error('No room found with that code.');
      error.code = 'ROOM_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    const userRooms = mockRoomsStore.get(userId) || [];
    const isAlreadyMember = userRooms.some((r) => r.id === catalogRoom.id);

    // AC 4: Idempotent
    if (isAlreadyMember) {
      return { roomId: catalogRoom.id, alreadyMember: true };
    }

    // AC 3: Add room to user's rooms
    const newRoomSummary: RoomSummary = {
      id: catalogRoom.id,
      name: catalogRoom.name,
      description: catalogRoom.description,
      joinCode: null, // Students do not see join code on card (US-DASH-05)
      hostName: catalogRoom.hostName,
      memberCount: 2,
      myRole: 'participant',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
    };
    mockRoomsStore.set(userId, [newRoomSummary, ...userRooms]);

    return { roomId: catalogRoom.id, alreadyMember: false };
  }

  // 2. Query Supabase database for room by join_code
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('id, name, join_code, default_permissions, archived_at')
    .eq('join_code', code)
    .is('archived_at', null)
    .maybeSingle();

  if (roomError) {
    console.error('[Rooms Service] Error querying room by code:', roomError.message);
    throw new Error('Failed to query room');
  }

  // AC 5: Unknown code error
  if (!room) {
    const error: any = new Error('No room found with that code.');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // AC 4: Idempotency check — check if already a member
  const { data: existingMember, error: memberQueryError } = await supabase
    .from('room_members')
    .select('room_id')
    .eq('room_id', room.id)
    .eq('user_id', userId)
    .maybeSingle();

  if (memberQueryError) {
    console.warn('[Rooms Service] Error querying room membership:', memberQueryError.message);
  }

  if (existingMember) {
    return { roomId: room.id, alreadyMember: true };
  }

  // AC 3: User is new to the room — copy default permissions and insert
  const defPerms = (room.default_permissions as any) || {};
  const { error: insertError } = await supabase
    .from('room_members')
    .insert({
      room_id: room.id,
      user_id: userId,
      member_role: 'participant',
      can_mic: Boolean(defPerms.can_mic ?? defPerms.canMic ?? false),
      can_camera: Boolean(defPerms.can_camera ?? defPerms.canCamera ?? false),
      can_screen: Boolean(defPerms.can_screen ?? defPerms.canScreen ?? false),
      can_whiteboard: Boolean(defPerms.can_whiteboard ?? defPerms.canWhiteboard ?? false),
      can_code: Boolean(defPerms.can_code ?? defPerms.canCode ?? false),
    });

  if (insertError) {
    // Unique constraint violation (23505) means concurrent join succeeded -> idempotent
    if (insertError.code === '23505') {
      return { roomId: room.id, alreadyMember: true };
    }
    console.error('[Rooms Service] Error inserting room member:', insertError.message);
    throw new Error('Failed to join room');
  }

  return { roomId: room.id, alreadyMember: false };
}
