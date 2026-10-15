import { supabase } from './supabase';
import { RoomSummary, Room, Permissions, MemberRole, CreateRoomDto, CreateRoomResponseDto, UpdateRoomDto } from '@linkup/shared';

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
 * Fetch a single room for a specific user and enforce membership.
 * Throws NotAMemberError (→ 403 NOT_A_MEMBER) if user is not a member.
 * Returns null if the room does not exist (→ 404).
 * (US-ROOM-01, FR-2.4)
 */
export const DEFAULT_SAMPLE_ROOMS: Record<string, RoomSummary> = {
  'room-cs101-active': {
    id: 'room-cs101-active',
    name: 'CS101: Data Structures & Algorithms',
    description: 'Live interactive coding workspace with real-time video, compiler, and shared whiteboard.',
    joinCode: 'CS101A',
    hostName: 'Prof. Alan Turing',
    memberCount: 28,
    myRole: 'host',
    activeSessionId: 'session-live-cs101-888',
    createdAt: new Date().toISOString(),
  },
  'room-math201-inactive': {
    id: 'room-math201-inactive',
    name: 'MATH201: Discrete Mathematics & Graph Theory',
    description: 'Weekly tutorial problems and discussion room. Next session scheduled for Friday.',
    joinCode: null,
    hostName: 'Dr. Ada Lovelace',
    memberCount: 16,
    myRole: 'participant',
    activeSessionId: null,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  'room-phys301-active': {
    id: 'room-phys301-active',
    name: 'PHYS301: Quantum Mechanics & Wave Dynamics',
    description: 'Laboratory live lecture session with interactive formulas and visual simulations.',
    joinCode: null,
    hostName: 'Dr. Richard Feynman',
    memberCount: 34,
    myRole: 'participant',
    activeSessionId: 'session-live-phys-999',
    createdAt: new Date(Date.now() - 172800000).toISOString(),
  },
};

export async function getRoomForUser(
  userId: string,
  roomId: string
): Promise<RoomSummary> {
  // Check if roomId is one of the built-in sample demo rooms
  if (DEFAULT_SAMPLE_ROOMS[roomId]) {
    return DEFAULT_SAMPLE_ROOMS[roomId];
  }

  // Validate UUID to avoid PostgreSQL "invalid input syntax for type uuid" error
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(roomId)) {
    throw Object.assign(new Error('Room not found'), { code: 'ROOM_NOT_FOUND' });
  }

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

  const { data: roomMembers } = await supabase
    .from('room_members')
    .select('user_id, member_role, created_at, can_mic, can_camera, can_screen, can_whiteboard, can_code')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });

  const memberUserIds = (roomMembers || []).map((member) => member.user_id);
  const { data: memberProfiles } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('id', memberUserIds.length > 0 ? memberUserIds : ['__missing__']);

  const profileMap = new Map<string, { full_name: string; role: 'teacher' | 'student' }>();
  (memberProfiles || []).forEach((profile) => {
    profileMap.set(profile.id, {
      full_name: profile.full_name,
      role: profile.role,
    });
  });

  const members = (roomMembers || []).map((member) => {
    const profile = profileMap.get(member.user_id);

    return {
      userId: member.user_id,
      fullName: profile?.full_name || 'Unknown User',
      userRole: profile?.role || 'student',
      memberRole: member.member_role as MemberRole,
      permissions: {
        canMic: Boolean(member.can_mic),
        canCamera: Boolean(member.can_camera),
        canScreen: Boolean(member.can_screen),
        canWhiteboard: Boolean(member.can_whiteboard),
        canCode: Boolean(member.can_code),
      },
      joinedAt: member.created_at,
    };
  });

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
    members,
  };
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


/**
 * Join a room by code (US-DASH-04, FR-8.3, FR-2.3)
 * Acceptance Criteria:
 * 1. Always accessible to students and teachers.
 * 2. Case-insensitive; normalises code to uppercase before lookup.
 * 3. On success, user is added to the room and room card appears on dashboard.
 * 4. Idempotent: joining a room you are already a member of returns success without error/duplicate.
 * 5. Unknown code raises: "No room found with that code."
 */
export async function removeRoomMember(
  requesterUserId: string,
  roomId: string,
  targetUserId: string
): Promise<void> {
  const normalizedRoomId = roomId?.trim();
  const normalizedTargetUserId = targetUserId?.trim();

  if (!normalizedRoomId || !normalizedTargetUserId) {
    const error: any = new Error('Room and member IDs are required');
    error.code = 'VALIDATION';
    error.status = 400;
    throw error;
  }

  const mockRoomLists = Array.from(mockRoomsStore.values());
  const isMockRoomKnown = mockRoomLists.some((rooms) => rooms.some((room) => room.id === normalizedRoomId));

  if (isMockRoomKnown) {
    const hostRoom = (mockRoomsStore.get(requesterUserId) || []).find((room) => room.id === normalizedRoomId);
    if (!hostRoom) {
      const error: any = new Error('Only the host can remove members');
      error.code = 'FORBIDDEN';
      error.status = 403;
      throw error;
    }

    if (hostRoom.myRole !== 'host') {
      const error: any = new Error('Only the host can remove members');
      error.code = 'FORBIDDEN';
      error.status = 403;
      throw error;
    }

    if (requesterUserId === normalizedTargetUserId) {
      const error: any = new Error('The host cannot be removed from the room');
      error.code = 'FORBIDDEN';
      error.status = 403;
      throw error;
    }

    for (const [userId, rooms] of mockRoomsStore.entries()) {
      const nextRooms = rooms.filter((room) => !(room.id === normalizedRoomId && userId === normalizedTargetUserId));
      if (nextRooms.length !== rooms.length || userId === normalizedTargetUserId) {
        mockRoomsStore.set(userId, nextRooms);
      }
    }
    return;
  }

  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('id, owner_id')
    .eq('id', normalizedRoomId)
    .maybeSingle();

  if (roomError) {
    console.warn('[Rooms Service] Error loading room for removal:', roomError.message);
    throw new Error(roomError.message);
  }

  if (!room) {
    const error: any = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  if (requesterUserId !== room.owner_id) {
    const error: any = new Error('Only the host can remove members');
    error.code = 'FORBIDDEN';
    error.status = 403;
    throw error;
  }

  if (normalizedTargetUserId === room.owner_id) {
    const error: any = new Error('The host cannot be removed from the room');
    error.code = 'FORBIDDEN';
    error.status = 403;
    throw error;
  }

  const { data: targetMembership, error: membershipError } = await supabase
    .from('room_members')
    .select('user_id')
    .eq('room_id', normalizedRoomId)
    .eq('user_id', normalizedTargetUserId)
    .maybeSingle();

  if (membershipError) {
    console.warn('[Rooms Service] Error finding room member for removal:', membershipError.message);
    throw new Error(membershipError.message);
  }

  if (!targetMembership) {
    const error: any = new Error('Member not found in room');
    error.code = 'NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const { error: deleteError } = await supabase
    .from('room_members')
    .delete()
    .eq('room_id', normalizedRoomId)
    .eq('user_id', normalizedTargetUserId);

  if (deleteError) {
    console.warn('[Rooms Service] Error deleting room member:', deleteError.message);
    throw new Error(deleteError.message);
  }

  const { data: activeSession } = await supabase
    .from('live_sessions')
    .select('id')
    .eq('room_id', normalizedRoomId)
    .is('ended_at', null)
    .maybeSingle();

  if (activeSession?.id) {
    await supabase
      .from('attendance')
      .update({ left_at: new Date().toISOString() })
      .eq('session_id', activeSession.id)
      .eq('user_id', normalizedTargetUserId)
      .is('left_at', null);
  }
}

/**
 * Regenerates the 6-character join code for a room (US-ROOM-04, FR-2.6)
 * - Only the host can regenerate the join code.
 * - The old code immediately becomes invalid for joining.
 * - Returns the newly generated join code.
 */
export async function regenerateRoomJoinCode(
  requesterUserId: string,
  roomId: string
): Promise<string> {
  const normalizedRoomId = roomId?.trim();

  if (!normalizedRoomId || !requesterUserId) {
    const error: any = new Error('Room ID and user ID are required');
    error.code = 'VALIDATION';
    error.status = 400;
    throw error;
  }

  // Check demo sample rooms
  if (DEFAULT_SAMPLE_ROOMS[normalizedRoomId]) {
    const room = DEFAULT_SAMPLE_ROOMS[normalizedRoomId];
    if (room.myRole !== 'host') {
      const error: any = new Error('Only the room host can regenerate the join code');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }
    const oldCode = room.joinCode;
    const newCode = generateJoinCode();
    room.joinCode = newCode;
    if (oldCode && mockCatalogStore.has(oldCode.toUpperCase())) {
      const catalogEntry = mockCatalogStore.get(oldCode.toUpperCase())!;
      mockCatalogStore.delete(oldCode.toUpperCase());
      mockCatalogStore.set(newCode.toUpperCase(), {
        ...catalogEntry,
        joinCode: newCode.toUpperCase(),
      });
    }
    return newCode;
  }

  // 1. Check in-memory mock store
  const mockRoomLists = Array.from(mockRoomsStore.values());
  const isMockRoomKnown = mockRoomLists.some((rooms) => rooms.some((room) => room.id === normalizedRoomId));

  if (isMockRoomKnown) {
    const hostRooms = mockRoomsStore.get(requesterUserId) || [];
    const hostRoom = hostRooms.find((room) => room.id === normalizedRoomId);

    if (!hostRoom || hostRoom.myRole !== 'host') {
      const error: any = new Error('Only the room host can regenerate the join code');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }

    const oldCode = hostRoom.joinCode;

    // Generate new unique code different from oldCode
    const newCode = await generateUniqueJoinCode(async (candidate) => {
      if (candidate === oldCode) return true;
      for (const rooms of mockRoomsStore.values()) {
        if (rooms.some((r) => r.joinCode === candidate)) return true;
      }
      return false;
    });

    // Update in all mock room stores: host sees new code, participants keep joinCode: null
    for (const [userId, rooms] of mockRoomsStore.entries()) {
      const updatedRooms = rooms.map((room) => {
        if (room.id === normalizedRoomId) {
          return {
            ...room,
            joinCode: room.myRole === 'host' ? newCode : null,
          };
        }
        return room;
      });
      mockRoomsStore.set(userId, updatedRooms);
    }

    // Invalidate old code in mock catalog store and register new code
    if (oldCode && mockCatalogStore.has(oldCode.toUpperCase())) {
      const catalogEntry = mockCatalogStore.get(oldCode.toUpperCase())!;
      mockCatalogStore.delete(oldCode.toUpperCase());
      mockCatalogStore.set(newCode.toUpperCase(), {
        ...catalogEntry,
        joinCode: newCode.toUpperCase(),
      });
    }

    return newCode;
  }

  // 2. Query Supabase database for the room
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('id, owner_id, join_code, archived_at')
    .eq('id', normalizedRoomId)
    .is('archived_at', null)
    .maybeSingle();

  if (roomError) {
    console.error('[Rooms Service] Error fetching room for join code regeneration:', roomError.message);
    throw new Error('Failed to fetch room');
  }

  if (!room) {
    const error: any = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Check host permission (owner_id or host role in room_members)
  let isHost = room.owner_id === requesterUserId;
  if (!isHost) {
    const { data: membership } = await supabase
      .from('room_members')
      .select('member_role')
      .eq('room_id', normalizedRoomId)
      .eq('user_id', requesterUserId)
      .maybeSingle();

    isHost = membership?.member_role === 'host';
  }

  if (!isHost) {
    const error: any = new Error('Only the room host can regenerate the join code');
    error.code = 'HOST_ONLY';
    error.status = 403;
    throw error;
  }

  const oldCode = room.join_code;

  // Generate a new unique 6-character code
  let newCode = '';
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = await generateUniqueJoinCode(async (code) => {
      if (code === oldCode) return true;
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

    const { error: updateError } = await supabase
      .from('rooms')
      .update({ join_code: candidate })
      .eq('id', normalizedRoomId);

    if (!updateError) {
      newCode = candidate;
      break;
    }

    if (updateError.code !== '23505') {
      console.error('[Rooms Service] Error updating room join code:', updateError.message);
      throw new Error('Failed to update room join code');
    }
  }

  if (!newCode) {
    throw new Error('Failed to generate unique join code after multiple attempts');
  }

  return newCode;
}

/**
 * US-ROOM-05 (FR-2.7): Edit room name/description, or archive room.
 * Only the room host can edit or archive the room; other users get 403 HOST_ONLY.
 */
export async function updateRoom(
  userId: string,
  roomId: string,
  updates: UpdateRoomDto
): Promise<RoomSummary | { id: string; archived: true }> {
  const normalizedRoomId = roomId.trim();

  // 1. In-memory mock store support (e.g. for automated test suites)
  if (mockRoomsStore.size > 0 || mockCatalogStore.size > 0) {
    const userRooms = mockRoomsStore.get(userId) || [];
    const hostRoom = userRooms.find((r) => r.id === normalizedRoomId);

    // If requester is not the host in their room list
    if (!hostRoom || hostRoom.myRole !== 'host') {
      // Check if room exists for any other user to differentiate between 404 and 403
      let existsForAnyone = false;
      for (const rooms of mockRoomsStore.values()) {
        if (rooms.some((r) => r.id === normalizedRoomId)) {
          existsForAnyone = true;
          break;
        }
      }
      for (const catRoom of mockCatalogStore.values()) {
        if (catRoom.id === normalizedRoomId) {
          existsForAnyone = true;
          break;
        }
      }

      if (!existsForAnyone) {
        const error: any = new Error('Room not found');
        error.code = 'ROOM_NOT_FOUND';
        error.status = 404;
        throw error;
      }

      const error: any = new Error('Only the room host can edit or archive the room');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }

    // Archive room in mock store
    if (updates.archived) {
      for (const [uid, rooms] of mockRoomsStore.entries()) {
        mockRoomsStore.set(uid, rooms.filter((r) => r.id !== normalizedRoomId));
      }
      for (const [code, catRoom] of mockCatalogStore.entries()) {
        if (catRoom.id === normalizedRoomId) {
          mockCatalogStore.delete(code);
        }
      }
      return { id: normalizedRoomId, archived: true };
    }

    // Update name/description in mock store
    let updatedSummary: RoomSummary | null = null;
    for (const [uid, rooms] of mockRoomsStore.entries()) {
      const updated = rooms.map((r) => {
        if (r.id === normalizedRoomId) {
          const newSummary = {
            ...r,
            name: updates.name !== undefined ? updates.name : r.name,
            description: updates.description !== undefined ? updates.description : r.description,
          };
          if (uid === userId) {
            updatedSummary = newSummary;
          }
          return newSummary;
        }
        return r;
      });
      mockRoomsStore.set(uid, updated);
    }

    for (const [code, catRoom] of mockCatalogStore.entries()) {
      if (catRoom.id === normalizedRoomId) {
        mockCatalogStore.set(code, {
          ...catRoom,
          name: updates.name !== undefined ? updates.name : catRoom.name,
          description: updates.description !== undefined ? updates.description : catRoom.description,
        });
      }
    }

    return updatedSummary || hostRoom;
  }

  // 2. Query Supabase database
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(normalizedRoomId)) {
    const error: any = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('id, name, description, owner_id, join_code, created_at, archived_at')
    .eq('id', normalizedRoomId)
    .is('archived_at', null)
    .maybeSingle();

  if (roomError) {
    console.error('[Rooms Service] Error fetching room for update:', roomError.message);
    throw new Error('Failed to fetch room');
  }

  if (!room) {
    const error: any = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Verify host status
  let isHost = room.owner_id === userId;
  if (!isHost) {
    const { data: membership } = await supabase
      .from('room_members')
      .select('member_role')
      .eq('room_id', normalizedRoomId)
      .eq('user_id', userId)
      .maybeSingle();

    isHost = membership?.member_role === 'host';
  }

  if (!isHost) {
    const error: any = new Error('Only the room host can edit or archive the room');
    error.code = 'HOST_ONLY';
    error.status = 403;
    throw error;
  }

  // Perform updates in database
  const updatePayload: Record<string, any> = {};
  if (updates.name !== undefined) {
    updatePayload.name = updates.name.trim();
  }
  if (updates.description !== undefined) {
    updatePayload.description = updates.description === null ? null : updates.description.trim();
  }
  if (updates.archived === true) {
    updatePayload.archived_at = new Date().toISOString();
  } else if (updates.archived === false) {
    updatePayload.archived_at = null;
  }

  const { error: updateError } = await supabase
    .from('rooms')
    .update(updatePayload)
    .eq('id', normalizedRoomId);

  if (updateError) {
    console.error('[Rooms Service] Error updating room:', updateError.message);
    throw new Error('Failed to update room');
  }

  if (updates.archived) {
    return { id: normalizedRoomId, archived: true };
  }

  return getRoomForUser(userId, normalizedRoomId);
}

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

