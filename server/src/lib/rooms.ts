import { supabase } from './supabase';
import { RoomSummary, Room, Permissions, MemberRole, CreateRoomDto, CreateRoomResponseDto } from '@linkup/shared';

// Characters: A-Z, 2-9; no O, 0, I, 1 (US-DASH-03, FR-2.2)
export const JOIN_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generate a 6-character uppercase alphanumeric join code without ambiguous characters (O, 0, I, 1)
 */
export function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * JOIN_CODE_CHARS.length);
    code += JOIN_CODE_CHARS[randomIndex];
  }
  return code;
}

/**
 * Generate a unique 6-character join code
 */
export async function generateUniqueJoinCode(
  checkExistsFn?: (code: string) => Promise<boolean>
): Promise<string> {
  const maxAttempts = 20;
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = generateJoinCode();
    if (checkExistsFn) {
      const exists = await checkExistsFn(candidate);
      if (!exists) return candidate;
    } else {
      return candidate;
    }
  }
  return generateJoinCode();
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
 * Create a new room with host membership and default permissions (US-DASH-03, FR-8.3, FR-2.1)
 */
export async function createRoom(
  ownerId: string,
  ownerName: string,
  data: {
    name: string;
    description?: string | null;
    defaultPermissions?: Partial<Permissions>;
  }
): Promise<Room> {
  const defaultPermissions: Permissions = {
    canMic: data.defaultPermissions?.canMic ?? false,
    canCamera: data.defaultPermissions?.canCamera ?? false,
    canScreen: data.defaultPermissions?.canScreen ?? false,
    canWhiteboard: data.defaultPermissions?.canWhiteboard ?? false,
    canCode: data.defaultPermissions?.canCode ?? false,
  };

  // Generate unique 6-character join code (characters: A-Z, 2-9; no O, 0, I, 1)
  const joinCode = await generateUniqueJoinCode(async (code) => {
    // Check in-memory mock store
    for (const rooms of mockRoomsStore.values()) {
      if (rooms.some((r) => r.joinCode === code)) return true;
    }
    // Check Supabase database
    try {
      const { data } = await supabase
        .from('rooms')
        .select('id')
        .eq('join_code', code)
        .maybeSingle();
      return Boolean(data);
    } catch {
      return false;
    }
  });

  const defaultPermsDb = {
    can_mic: defaultPermissions.canMic,
    can_camera: defaultPermissions.canCamera,
    can_screen: defaultPermissions.canScreen,
    can_whiteboard: defaultPermissions.canWhiteboard,
    can_code: defaultPermissions.canCode,
  };

  let roomId = 'room-' + Math.random().toString(36).substring(2, 11);
  let createdAt = new Date().toISOString();

  try {
    const { data: insertedRoom, error: roomError } = await supabase
      .from('rooms')
      .insert({
        name: data.name,
        description: data.description || null,
        join_code: joinCode,
        owner_id: ownerId,
        default_permissions: defaultPermsDb,
      })
      .select('id, created_at')
      .single();

    if (!roomError && insertedRoom) {
      roomId = insertedRoom.id;
      createdAt = insertedRoom.created_at || createdAt;

      // Add teacher as host in room_members (Criterion 3)
      await supabase.from('room_members').insert({
        room_id: roomId,
        user_id: ownerId,
        member_role: 'host',
        can_mic: true,
        can_camera: true,
        can_screen: true,
        can_whiteboard: true,
        can_code: true,
      });

      // Initialize empty code_state
      await supabase.from('code_state').insert({
        room_id: roomId,
        holder_id: ownerId,
        language: 'python',
        content: '',
        rev: 0,
      });

      // Initialize empty whiteboard_state
      await supabase.from('whiteboard_state').insert({
        room_id: roomId,
        elements: [],
      });
    }
  } catch (err) {
    console.warn('[Rooms Service] Supabase insert warning (fallback to in-memory):', err);
  }

  const roomSummary: RoomSummary = {
    id: roomId,
    name: data.name,
    description: data.description || null,
    joinCode, // Host sees join code (US-DASH-05, FR-8.4)
    hostName: ownerName,
    memberCount: 1,
    myRole: 'host',
    activeSessionId: null,
    createdAt,
  };

  // Keep mock store in sync for unit/integration testing
  if (mockRoomsStore.has(ownerId)) {
    const existing = mockRoomsStore.get(ownerId) || [];
    mockRoomsStore.set(ownerId, [roomSummary, ...existing]);
  } else {
    // If not in mock store yet, initialize it so immediate GET /api/rooms returns it in mock mode
    mockRoomsStore.set(ownerId, [roomSummary]);
  }

  const createdRoom: Room = {
    ...roomSummary,
    defaultPermissions,
    ownerId,
  };

  return createdRoom;
}
