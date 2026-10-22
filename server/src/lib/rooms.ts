import { supabase } from './supabase';
import {
  RoomSummary,
  Room,
  Permissions,
  MemberRole,
  CreateRoomDto,
  CreateRoomResponseDto,
  UpdateRoomDto,
  Session,
  PermissionKey,
  PERMISSION_KEYS,
  Member,
  AttendanceRow,
} from '@linkup/shared';
import { getActiveScreenShare } from '../realtime/screenShare';
import { deleteLivekitRoom } from './livekit';

export const mockAttendanceStore = new Map<string, any>();

export class NotAMemberError extends Error {
  public readonly code = 'NOT_A_MEMBER';
  constructor() {
    super('You are not a member of this room');
    this.name = 'NotAMemberError';
  }
}


export const JOIN_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';



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
const mockSessionsStore = new Map<string, Session>();

export {
  MockAttendanceRecord,
  getMockAttendance,
  clearMockAttendance,
  addMockAttendance,
  close_session_attendance,
  closeAllSessionAttendance,
  calculateMockAttendanceSummary,
  attendanceToCSV,
  aggregateAttendanceRecords,
  escapeCsvField,
} from './attendance';

import {
  getMockAttendance,
  clearMockAttendance,
  close_session_attendance,
  closeAllSessionAttendance,
  closeDanglingMockAttendance,
  calculateMockAttendanceSummary,
  attendanceToCSV,
  aggregateAttendanceRecords,
  computeAttendanceStatus,
} from './attendance';

export function setMockRooms(userId: string, rooms: RoomSummary[]) {
  mockRoomsStore.set(userId, rooms);
}

export function clearMockSessions() {
  mockSessionsStore.clear();
}

export function getMockSessions(): Map<string, Session> {
  return mockSessionsStore;
}

export function setMockSession(arg1: string | Session, arg2?: Session) {
  if (typeof arg1 === 'string' && arg2) {
    mockSessionsStore.set(arg1, arg2);
    if (arg2.id) mockSessionsStore.set(arg2.id, arg2);
  } else if (typeof arg1 === 'object' && arg1) {
    mockSessionsStore.set(arg1.id, arg1);
    if (arg1.roomId) mockSessionsStore.set(arg1.roomId, arg1);
  }
}
export const addMockSession = setMockSession;

export function clearMockRooms(userId?: string) {
  if (userId) {
    mockRoomsStore.delete(userId);
  } else {
    mockRoomsStore.clear();
    mockSessionsStore.clear();
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
import { getRoomPresence } from '../realtime/presence';

export const DEFAULT_SAMPLE_ROOMS: Record<string, RoomSummary> = {
  'room-cs101-active': {
    id: 'room-cs101-active',
    name: 'CS101: Data Structures & Algorithms',
    description: 'Live interactive coding workspace with real-time video, compiler, and shared whiteboard.',
    joinCode: 'CS101A',
    hostName: 'Prof. Alan Turing',
    memberCount: 3,
    myRole: 'host',
    activeSessionId: 'session-live-cs101-888',
    createdAt: new Date().toISOString(),
    members: [
      {
        userId: 'user-turing',
        fullName: 'Prof. Alan Turing',
        userRole: 'teacher',
        memberRole: 'host',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        userId: 'user-grace',
        fullName: 'Grace Hopper',
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: true, canCode: true },
        joinedAt: new Date(Date.now() - 1800000).toISOString(),
      },
      {
        userId: 'user-john',
        fullName: 'John von Neumann',
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: true, canCode: true },
        joinedAt: new Date(Date.now() - 900000).toISOString(),
      },
    ],
    presence: [
      { userId: 'user-turing', fullName: 'Prof. Alan Turing', inLive: true, handRaised: false, micOn: true, cameraOn: false },
      { userId: 'user-grace', fullName: 'Grace Hopper', inLive: true, handRaised: false, micOn: true, cameraOn: false },
    ],
  },
  'room-math201-inactive': {
    id: 'room-math201-inactive',
    name: 'MATH201: Discrete Mathematics & Graph Theory',
    description: 'Weekly tutorial problems and discussion room. Next session scheduled for Friday.',
    joinCode: null,
    hostName: 'Dr. Ada Lovelace',
    memberCount: 2,
    myRole: 'participant',
    activeSessionId: null,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    members: [
      {
        userId: 'user-lovelace',
        fullName: 'Dr. Ada Lovelace',
        userRole: 'teacher',
        memberRole: 'host',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        userId: 'user-babbage',
        fullName: 'Charles Babbage',
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: true, canCode: true },
        joinedAt: new Date(Date.now() - 86000000).toISOString(),
      },
    ],
    presence: [
      { userId: 'user-lovelace', fullName: 'Dr. Ada Lovelace', inLive: false, handRaised: false, micOn: true, cameraOn: false },
    ],
  },
  'room-phys301-active': {
    id: 'room-phys301-active',
    name: 'PHYS301: Quantum Mechanics & Wave Dynamics',
    description: 'Laboratory live lecture session with interactive formulas and visual simulations.',
    joinCode: null,
    hostName: 'Dr. Richard Feynman',
    memberCount: 2,
    myRole: 'participant',
    activeSessionId: 'session-live-phys-999',
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    members: [
      {
        userId: 'user-feynman',
        fullName: 'Dr. Richard Feynman',
        userRole: 'teacher',
        memberRole: 'host',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date(Date.now() - 172800000).toISOString(),
      },
      {
        userId: 'user-curie',
        fullName: 'Marie Curie',
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date(Date.now() - 170000000).toISOString(),
      },
    ],
    presence: [
      { userId: 'user-feynman', fullName: 'Dr. Richard Feynman', inLive: true, handRaised: false, micOn: true, cameraOn: false },
      { userId: 'user-curie', fullName: 'Marie Curie', inLive: true, handRaised: false, micOn: true, cameraOn: false },
    ],
  },
};

export async function getRoomForUser(
  userId: string,
  roomId: string
): Promise<RoomSummary> {
  // Check if roomId is one of the built-in sample demo rooms
  if (DEFAULT_SAMPLE_ROOMS[roomId]) {
    const sample = DEFAULT_SAMPLE_ROOMS[roomId];
    const livePresence = getRoomPresence(roomId);
    return {
      ...sample,
      presence: livePresence.length > 0 ? livePresence : sample.presence || [],
    };
  }

  // Validate UUID to avoid PostgreSQL "invalid input syntax for type uuid" error
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isRealDbRoom = UUID_REGEX.test(roomId);

  // Mock store checks only apply to test-harness room ids (e.g. "room-abc123"). A real
  // Supabase-backed room (UUID id) is mirrored into mockRoomsStore too (see createRoom's
  // "keep mock store in sync" comment), so without this guard, any OTHER user's mock-room
  // list containing this same real room id would wrongly short-circuit to NotAMemberError
  // here before ever checking the real room_members table.
  if (!isRealDbRoom) {
    // Check mock store for testing harness (US-ROOM-01, US-ROOM-02, US-ROOM-03)
    if (mockRoomsStore.has(userId)) {
      const userRooms = mockRoomsStore.get(userId) || [];
      const found = userRooms.find((r) => r.id === roomId);
      if (found) {
        return {
          ...found,
          presence: getRoomPresence(roomId),
        };
      }
    }

    // If mock store is being used and the room exists in the mock store for other users,
    // but the requesting user is not a member, throw NotAMemberError
    for (const rooms of mockRoomsStore.values()) {
      if (Array.isArray(rooms) && rooms.some((r) => r.id === roomId)) {
        throw new NotAMemberError();
      }
    }

    throw Object.assign(new Error('You are not a member of this room'), { code: 'NOT_A_MEMBER', status: 403 });
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
    .select('user_id, member_role, joined_at, can_mic, can_camera, can_screen, can_whiteboard, can_code')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });

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
      joinedAt: member.joined_at,
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
    presence: getRoomPresence(room.id),
    activeScreenShare: getActiveScreenShare(room.id),
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
  let dbInsertSucceeded = false;

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

    if (roomError) {
      // Log the detailed Supabase error for debugging
      console.error('[Rooms Service] Supabase rooms INSERT failed:', {
        code: roomError.code,
        message: roomError.message,
        details: roomError.details,
        hint: roomError.hint,
      });
      // Re-throw so the API route returns a 500 with a clear error message
      // rather than silently returning an ephemeral in-memory room
      throw Object.assign(new Error(roomError.message || 'Database insert failed'), {
        code: 'DB_INSERT_FAILED',
        status: 500,
        supabaseCode: roomError.code,
      });
    }

    if (insertedRoom) {
      roomId = insertedRoom.id;
      createdAt = insertedRoom.created_at || createdAt;
      dbInsertSucceeded = true;

      // Add teacher as host in room_members (Criterion 3)
      const { error: memberError } = await supabase.from('room_members').insert({
        room_id: roomId,
        user_id: ownerId,
        member_role: 'host',
        can_mic: true,
        can_camera: true,
        can_screen: true,
        can_whiteboard: true,
        can_code: true,
      });
      if (memberError) {
        console.warn('[Rooms Service] Failed to insert host room_member (non-fatal):', memberError.message);
      }

      // Initialize empty code_state (non-fatal if it fails)
      const { error: codeStateError } = await supabase.from('code_state').insert({
        room_id: roomId,
        holder_id: ownerId,
        language: 'python',
        content: '',
        rev: 0,
      });
      if (codeStateError) {
        console.warn('[Rooms Service] Failed to init code_state (non-fatal):', codeStateError.message);
      }

      // Initialize empty whiteboard_state (non-fatal if it fails)
      const { error: wbError } = await supabase.from('whiteboard_state').insert({
        room_id: roomId,
        elements: [],
      });
      if (wbError) {
        console.warn('[Rooms Service] Failed to init whiteboard_state (non-fatal):', wbError.message);
      }
    }
  } catch (err: any) {
    // Only rethrow structured errors from our own throw above (DB_INSERT_FAILED)
    // — genuine Supabase client/network exceptions are caught here too
    if (err?.code === 'DB_INSERT_FAILED') {
      throw err;
    }
    console.warn('[Rooms Service] Unexpected exception during room creation (fallback to in-memory):', err?.message || err);
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

  if (!dbInsertSucceeded) {
    // No real DB persistence happened - mockRoomsStore IS the storage for this room, for every caller.
    if (mockRoomsStore.has(ownerId)) {
      const existing = mockRoomsStore.get(ownerId) || [];
      mockRoomsStore.set(ownerId, [roomSummary, ...existing]);
    } else {
      mockRoomsStore.set(ownerId, [roomSummary]);
    }
  } else if (mockRoomsStore.has(ownerId)) {
    // Real DB room, but this owner already has pre-seeded mock state (test harness) - keep it in sync.
    // Do NOT bootstrap a new mock entry for owners who don't have one: that would wrongly flag every
    // real-DB room as "mock" for every mockRoomsStore.has(ownerId)/cross-user-scan check elsewhere
    // (getRoomForUser, startSession, etc.), breaking real rooms for all other real users.
    const existing = mockRoomsStore.get(ownerId) || [];
    mockRoomsStore.set(ownerId, [roomSummary, ...existing]);
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
const ROOM_MEMBER_PERMISSION_COLUMNS: Record<PermissionKey, string> = {
  canMic: 'can_mic',
  canCamera: 'can_camera',
  canScreen: 'can_screen',
  canWhiteboard: 'can_whiteboard',
  canCode: 'can_code',
};

export function normalizePermissionPatch(patch: Partial<Permissions>): Partial<Permissions> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    const error: any = new Error('Permission update payload must be an object');
    error.code = 'VALIDATION';
    error.status = 400;
    throw error;
  }

  const keys = PERMISSION_KEYS.filter((key) => patch[key] !== undefined);
  if (keys.length === 0) {
    const error: any = new Error('At least one permission must be provided');
    error.code = 'VALIDATION';
    error.status = 400;
    throw error;
  }

  const normalized: Partial<Permissions> = {};
  for (const key of keys) {
    if (typeof patch[key] !== 'boolean') {
      const error: any = new Error(`Permission '${key}' must be a boolean`);
      error.code = 'VALIDATION';
      error.status = 400;
      throw error;
    }
    normalized[key] = patch[key] as boolean;
  }

  return normalized;
}

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
 * Update a member's permissions in a room (host only).
 * Traces to FR-3.5, US-LIVE-04, architecture doc 5.3.
 */
export async function updateMemberPermissions(
  requesterUserId: string,
  roomId: string,
  targetUserId: string,
  patch: Partial<Permissions>
): Promise<{ member: Member; permissions: Permissions }> {
  const normalizedRoomId = roomId?.trim();
  const normalizedRequester = requesterUserId?.trim();
  const normalizedTarget = targetUserId?.trim();

  if (!normalizedRoomId || !normalizedRequester || !normalizedTarget) {
    const error: any = new Error('Room ID, requester ID, and target member ID are required');
    error.code = 'VALIDATION';
    error.status = 400;
    throw error;
  }

  // Check built-in sample demo rooms
  if (DEFAULT_SAMPLE_ROOMS[normalizedRoomId]) {
    const sample = DEFAULT_SAMPLE_ROOMS[normalizedRoomId];
    if (normalizedRequester === normalizedTarget) {
      const error: any = new Error('The host always retains full permissions');
      error.code = 'FORBIDDEN';
      error.status = 403;
      throw error;
    }
    const target = sample.members?.find((m) => m.userId === normalizedTarget);
    if (!target) {
      const error: any = new Error('Member not found in room');
      error.code = 'NOT_FOUND';
      error.status = 404;
      throw error;
    }
    target.permissions = {
      ...target.permissions,
      ...(patch.canMic !== undefined && { canMic: Boolean(patch.canMic) }),
      ...(patch.canCamera !== undefined && { canCamera: Boolean(patch.canCamera) }),
      ...(patch.canScreen !== undefined && { canScreen: Boolean(patch.canScreen) }),
      ...(patch.canWhiteboard !== undefined && { canWhiteboard: Boolean(patch.canWhiteboard) }),
      ...(patch.canCode !== undefined && { canCode: Boolean(patch.canCode) }),
    };
    return { member: target, permissions: target.permissions };
  }

  // Check mock store
  const mockRoomLists = Array.from(mockRoomsStore.values());
  const isMockRoomKnown = mockRoomLists.some((rooms) => rooms.some((room) => room.id === normalizedRoomId));

  if (isMockRoomKnown) {
    const hostRoom = (mockRoomsStore.get(normalizedRequester) || []).find((room) => room.id === normalizedRoomId);
    if (!hostRoom || hostRoom.myRole !== 'host') {
      const error: any = new Error('Only the room host can update member permissions');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }

    if (normalizedRequester === normalizedTarget) {
      const error: any = new Error('The host always retains full permissions');
      error.code = 'FORBIDDEN';
      error.status = 403;
      throw error;
    }

    let targetMember: Member | null = null;
    let updatedPermissions: Permissions | null = null;

    for (const [userId, rooms] of mockRoomsStore.entries()) {
      for (const room of rooms) {
        if (room.id === normalizedRoomId && room.members) {
          const m = room.members.find((item) => item.userId === normalizedTarget);
          if (m) {
            m.permissions = {
              ...m.permissions,
              ...(patch.canMic !== undefined && { canMic: Boolean(patch.canMic) }),
              ...(patch.canCamera !== undefined && { canCamera: Boolean(patch.canCamera) }),
              ...(patch.canScreen !== undefined && { canScreen: Boolean(patch.canScreen) }),
              ...(patch.canWhiteboard !== undefined && { canWhiteboard: Boolean(patch.canWhiteboard) }),
              ...(patch.canCode !== undefined && { canCode: Boolean(patch.canCode) }),
            };
            targetMember = m;
            updatedPermissions = m.permissions;
          }
        }
      }
    }

    if (!targetMember || !updatedPermissions) {
      const error: any = new Error('Member not found in room');
      error.code = 'NOT_FOUND';
      error.status = 404;
      throw error;
    }

    return { member: targetMember, permissions: updatedPermissions };
  }

  // Database path
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('id, owner_id')
    .eq('id', normalizedRoomId)
    .maybeSingle();

  if (roomError) {
    console.warn('[Rooms Service] Error verifying room for permissions update:', roomError.message);
    throw new Error(roomError.message);
  }

  if (!room) {
    const error: any = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  if (normalizedRequester !== room.owner_id) {
    const error: any = new Error('Only the room host can update member permissions');
    error.code = 'HOST_ONLY';
    error.status = 403;
    throw error;
  }

  if (normalizedTarget === room.owner_id) {
    const error: any = new Error('The host always retains full permissions');
    error.code = 'FORBIDDEN';
    error.status = 403;
    throw error;
  }

  const { data: memberRow, error: memberError } = await supabase
    .from('room_members')
    .select('user_id, member_role, joined_at, can_mic, can_camera, can_screen, can_whiteboard, can_code')
    .eq('room_id', normalizedRoomId)
    .eq('user_id', normalizedTarget)
    .maybeSingle();

  if (memberError) {
    console.warn('[Rooms Service] Error fetching room member for permission update:', memberError.message);
    throw new Error(memberError.message);
  }

  if (!memberRow) {
    const error: any = new Error('Member not found in room');
    error.code = 'NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const dbUpdates: any = {};
  if (patch.canMic !== undefined) dbUpdates.can_mic = Boolean(patch.canMic);
  if (patch.canCamera !== undefined) dbUpdates.can_camera = Boolean(patch.canCamera);
  if (patch.canScreen !== undefined) dbUpdates.can_screen = Boolean(patch.canScreen);
  if (patch.canWhiteboard !== undefined) dbUpdates.can_whiteboard = Boolean(patch.canWhiteboard);
  if (patch.canCode !== undefined) dbUpdates.can_code = Boolean(patch.canCode);

  const { data: updatedRow, error: updateError } = await supabase
    .from('room_members')
    .update(dbUpdates)
    .eq('room_id', normalizedRoomId)
    .eq('user_id', normalizedTarget)
    .select('user_id, member_role, joined_at, can_mic, can_camera, can_screen, can_whiteboard, can_code')
    .single();

  if (updateError) {
    console.warn('[Rooms Service] Error updating member permissions:', updateError.message);
    throw new Error(updateError.message);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', normalizedTarget)
    .maybeSingle();

  const permissions: Permissions = {
    canMic: Boolean(updatedRow.can_mic),
    canCamera: Boolean(updatedRow.can_camera),
    canScreen: Boolean(updatedRow.can_screen),
    canWhiteboard: Boolean(updatedRow.can_whiteboard),
    canCode: Boolean(updatedRow.can_code),
  };

  const member: Member = {
    userId: updatedRow.user_id,
    fullName: profile?.full_name || 'Participant',
    userRole: profile?.role || 'student',
    memberRole: updatedRow.member_role,
    permissions,
    joinedAt: updatedRow.joined_at,
  };

  return { member, permissions };
}

/**
 * Bulk update member permissions in a room (host only).
 * Traces to FR-4.7, US-PERM-06, api-contract §3.3.
 * Sets permissions (e.g. canMic = false) for every participant (not the host) in a single bulk request.
 */
export async function bulkUpdateMemberPermissions(
  requesterUserId: string,
  roomId: string,
  patch: Partial<Permissions>
): Promise<{ members: Member[]; affectedCount: number }> {
  const normalizedRoomId = roomId?.trim();
  const normalizedRequester = requesterUserId?.trim();

  if (!normalizedRoomId || !normalizedRequester) {
    const error: any = new Error('Room ID and requester ID are required');
    error.code = 'VALIDATION';
    error.status = 400;
    throw error;
  }

  // 1. Check mock store
  const mockRoomLists = Array.from(mockRoomsStore.values());
  const isMockRoomKnown = mockRoomLists.some((rooms) => rooms.some((room) => room.id === normalizedRoomId));

  if (isMockRoomKnown) {
    const hostRoom = (mockRoomsStore.get(normalizedRequester) || []).find((room) => room.id === normalizedRoomId);
    if (!hostRoom || hostRoom.myRole !== 'host') {
      const error: any = new Error('Only the room host can update member permissions');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }

    const updatedMembersMap = new Map<string, Member>();
    let affectedCount = 0;

    for (const [userId, rooms] of mockRoomsStore.entries()) {
      for (const room of rooms) {
        if (room.id === normalizedRoomId && room.members) {
          for (const m of room.members) {
            // Apply to all participants, never the host!
            if (m.memberRole !== 'host' && m.userId !== normalizedRequester) {
              const previousCanMic = m.permissions?.canMic;
              m.permissions = {
                ...m.permissions,
                ...(patch.canMic !== undefined && { canMic: Boolean(patch.canMic) }),
                ...(patch.canCamera !== undefined && { canCamera: Boolean(patch.canCamera) }),
                ...(patch.canScreen !== undefined && { canScreen: Boolean(patch.canScreen) }),
                ...(patch.canWhiteboard !== undefined && { canWhiteboard: Boolean(patch.canWhiteboard) }),
                ...(patch.canCode !== undefined && { canCode: Boolean(patch.canCode) }),
              };
              if (patch.canMic !== undefined && previousCanMic !== m.permissions.canMic) {
                affectedCount++;
              }
              if (!updatedMembersMap.has(m.userId)) {
                updatedMembersMap.set(m.userId, m);
              }
            }
          }
        }
      }
    }

    return { members: Array.from(updatedMembersMap.values()), affectedCount };
  }

  // 2. Database path (Supabase)
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('id, owner_id')
    .eq('id', normalizedRoomId)
    .maybeSingle();

  if (roomError) {
    console.warn('[Rooms Service] Error verifying room for bulk permissions update:', roomError.message);
    throw new Error(roomError.message);
  }

  if (!room) {
    const error: any = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  if (normalizedRequester !== room.owner_id) {
    const error: any = new Error('Only the room host can update member permissions');
    error.code = 'HOST_ONLY';
    error.status = 403;
    throw error;
  }

  const dbUpdates: any = {};
  if (patch.canMic !== undefined) dbUpdates.can_mic = Boolean(patch.canMic);
  if (patch.canCamera !== undefined) dbUpdates.can_camera = Boolean(patch.canCamera);
  if (patch.canScreen !== undefined) dbUpdates.can_screen = Boolean(patch.canScreen);
  if (patch.canWhiteboard !== undefined) dbUpdates.can_whiteboard = Boolean(patch.canWhiteboard);
  if (patch.canCode !== undefined) dbUpdates.can_code = Boolean(patch.canCode);

  const { data: updatedRows, error: updateError } = await supabase
    .from('room_members')
    .update(dbUpdates)
    .eq('room_id', normalizedRoomId)
    .neq('user_id', room.owner_id)
    .neq('member_role', 'host')
    .select('user_id, member_role, joined_at, can_mic, can_camera, can_screen, can_whiteboard, can_code');

  if (updateError) {
    console.warn('[Rooms Service] Error bulk updating member permissions:', updateError.message);
    throw new Error(updateError.message);
  }

  const userIds = (updatedRows || []).map((r) => r.user_id);
  const { data: profiles } = userIds.length > 0
    ? await supabase.from('profiles').select('id, full_name, role').in('id', userIds)
    : { data: [] };

  const members: Member[] = (updatedRows || []).map((row) => {
    const profile = profiles?.find((p) => p.id === row.user_id);
    return {
      userId: row.user_id,
      fullName: profile?.full_name || 'Participant',
      userRole: profile?.role || 'student',
      memberRole: row.member_role,
      permissions: {
        canMic: Boolean(row.can_mic),
        canCamera: Boolean(row.can_camera),
        canScreen: Boolean(row.can_screen),
        canWhiteboard: Boolean(row.can_whiteboard),
        canCode: Boolean(row.can_code),
      },
      joinedAt: row.joined_at,
    };
  });

  return { members, affectedCount: members.length };
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
): Promise<{ roomId: string; alreadyMember: boolean; permissions?: Permissions }> {
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
  const permissions: Permissions = {
    canMic: Boolean(defPerms.can_mic ?? defPerms.canMic ?? false),
    canCamera: Boolean(defPerms.can_camera ?? defPerms.canCamera ?? false),
    canScreen: Boolean(defPerms.can_screen ?? defPerms.canScreen ?? false),
    canWhiteboard: Boolean(defPerms.can_whiteboard ?? defPerms.canWhiteboard ?? false),
    canCode: Boolean(defPerms.can_code ?? defPerms.canCode ?? false),
  };
  const { error: insertError } = await supabase
    .from('room_members')
    .insert({
      room_id: room.id,
      user_id: userId,
      member_role: 'participant',
      can_mic: permissions.canMic,
      can_camera: permissions.canCamera,
      can_screen: permissions.canScreen,
      can_whiteboard: permissions.canWhiteboard,
      can_code: permissions.canCode,
    });

  if (insertError) {
    // Unique constraint violation (23505) means concurrent join succeeded -> idempotent
    if (insertError.code === '23505') {
      return { roomId: room.id, alreadyMember: true };
    }
    console.error('[Rooms Service] Error inserting room member:', insertError.message);
    throw new Error('Failed to join room');
  }

  return { roomId: room.id, alreadyMember: false, permissions };
}

/**
 * Starts a live session in a room (US-LIVE-01, FR-3.1)
 * - Only the room host can start a session.
 * - Only one session can be active per room at a time (409 SESSION_ACTIVE).
 * - Returns the newly created Session.
 */
export async function startSession(
  requesterUserId: string,
  roomId: string
): Promise<Session> {
  const normalizedRoomId = roomId?.trim();
  const normalizedUserId = requesterUserId?.trim();

  if (!normalizedRoomId || !normalizedUserId) {
    const error: any = new Error('Room ID and user ID are required');
    error.code = 'VALIDATION';
    error.status = 400;
    throw error;
  }

  // 1. Check demo sample rooms
  if (DEFAULT_SAMPLE_ROOMS[normalizedRoomId]) {
    const sampleRoom = DEFAULT_SAMPLE_ROOMS[normalizedRoomId];
    if (sampleRoom.myRole !== 'host') {
      const error: any = new Error('Only the room host can start a session');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }

    if (sampleRoom.activeSessionId) {
      const error: any = new Error('A session is already active in this room');
      error.code = 'SESSION_ACTIVE';
      error.status = 409;
      throw error;
    }

    const newSessionId = `session-live-${Date.now()}`;
    const startedAt = new Date().toISOString();
    sampleRoom.activeSessionId = newSessionId;

    const session: Session = {
      id: newSessionId,
      roomId: normalizedRoomId,
      startedAt,
      endedAt: null,
      startedBy: normalizedUserId,
      livekit_room: `linkup-${newSessionId}`,
      livekitRoom: `linkup-${newSessionId}`,
    };
    mockSessionsStore.set(newSessionId, session);
    return session;
  }

  // 2. Check in-memory mock store
  const mockRoomLists = Array.from(mockRoomsStore.values());
  const isMockRoomKnown = mockRoomLists.some((rooms) => rooms.some((r) => r.id === normalizedRoomId));

  if (isMockRoomKnown) {
    const userRooms = mockRoomsStore.get(normalizedUserId) || [];
    const hostRoom = userRooms.find((r) => r.id === normalizedRoomId);

    if (!hostRoom) {
      const error: any = new Error('Only the room host can start a session');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }

    if (hostRoom.myRole !== 'host') {
      const error: any = new Error('Only the room host can start a session');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }

    // Check if session is already active in this room
    if (hostRoom.activeSessionId) {
      const error: any = new Error('A session is already active in this room');
      error.code = 'SESSION_ACTIVE';
      error.status = 409;
      throw error;
    }

    const newSessionId = `session-live-${Date.now()}`;
    const startedAt = new Date().toISOString();

    // Update activeSessionId across all mock users with this room
    for (const [uid, rList] of mockRoomsStore.entries()) {
      const targetRoom = rList.find((r) => r.id === normalizedRoomId);
      if (targetRoom) {
        targetRoom.activeSessionId = newSessionId;
      }
    }

    const session: Session = {
      id: newSessionId,
      roomId: normalizedRoomId,
      startedAt,
      endedAt: null,
      startedBy: normalizedUserId,
      livekit_room: `linkup-${newSessionId}`,
      livekitRoom: `linkup-${newSessionId}`,
    };
    mockSessionsStore.set(newSessionId, session);
    return session;
  }

  // 3. PostgreSQL / Supabase
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(normalizedRoomId)) {
    const error: any = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Check room exists
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('id, owner_id, archived_at')
    .eq('id', normalizedRoomId)
    .is('archived_at', null)
    .maybeSingle();

  if (roomError) {
    console.warn('[Session Service] Error fetching room:', roomError.message);
    throw new Error(roomError.message);
  }

  if (!room) {
    const error: any = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Check requester is host
  if (room.owner_id !== normalizedUserId) {
    const { data: membership } = await supabase
      .from('room_members')
      .select('member_role')
      .eq('room_id', normalizedRoomId)
      .eq('user_id', normalizedUserId)
      .maybeSingle();

    if (!membership || membership.member_role !== 'host') {
      const error: any = new Error('Only the room host can start a session');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }
  }

  // Check if session is already active
  const { data: existingSession, error: sessionCheckError } = await supabase
    .from('live_sessions')
    .select('id, started_at, started_by')
    .eq('room_id', normalizedRoomId)
    .is('ended_at', null)
    .maybeSingle();

  if (sessionCheckError) {
    console.warn('[Session Service] Error checking active session:', sessionCheckError.message);
    throw new Error(sessionCheckError.message);
  }

  if (existingSession) {
    const error: any = new Error('A session is already active in this room');
    error.code = 'SESSION_ACTIVE';
    error.status = 409;
    throw error;
  }

  // Insert new live session
  const startedAt = new Date().toISOString();
  const { data: newSession, error: insertError } = await supabase
    .from('live_sessions')
    .insert({
      room_id: normalizedRoomId,
      started_by: normalizedUserId,
      started_at: startedAt,
    })
    .select('id, room_id, started_at, ended_at, started_by, livekit_room')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      const error: any = new Error('A session is already active in this room');
      error.code = 'SESSION_ACTIVE';
      error.status = 409;
      throw error;
    }
    console.error('[Session Service] Error inserting live session:', insertError.message);
    throw new Error('Failed to create session');
  }

  return {
    id: newSession.id,
    roomId: newSession.room_id,
    startedAt: newSession.started_at,
    endedAt: newSession.ended_at,
    startedBy: newSession.started_by,
    livekit_room: newSession.livekit_room || `linkup-${newSession.id}`,
    livekitRoom: newSession.livekit_room || `linkup-${newSession.id}`,
  };
}

/**
 * Ends an active live session in a room (US-LIVE-05, FR-3.6)
 * - Only the room host can end the session (403 HOST_ONLY).
 * - Sets ended_at on the session.
 * - Deletes the LiveKit room.
 * - Closes all open attendance records.
 * - Emits session:ended to room members via caller.
 * - Returns the updated Session.
 */
export async function endSession(
  requesterUserId: string,
  roomId: string,
  sessionId?: string
): Promise<Session> {
  const normalizedRoomId = roomId?.trim();
  const normalizedUserId = requesterUserId?.trim();
  const normalizedSessionId = sessionId?.trim();

  if (!normalizedRoomId || !normalizedUserId) {
    const error: any = new Error('Room ID and user ID are required');
    error.code = 'VALIDATION';
    error.status = 400;
    throw error;
  }

  const endedAt = new Date().toISOString();

  // 1. Check demo sample rooms
  if (DEFAULT_SAMPLE_ROOMS[normalizedRoomId]) {
    const sampleRoom = DEFAULT_SAMPLE_ROOMS[normalizedRoomId];
    if (sampleRoom.myRole !== 'host') {
      const error: any = new Error('Only the room host can end a session');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }

    const currentSessionId = sampleRoom.activeSessionId;
    if (!currentSessionId) {
      const error: any = new Error('No active session found in this room');
      error.code = 'NO_ACTIVE_SESSION';
      error.status = 404;
      throw error;
    }

    if (normalizedSessionId && normalizedSessionId !== currentSessionId) {
      const error: any = new Error('Session not found or already ended');
      error.code = 'SESSION_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    sampleRoom.activeSessionId = null;

    let session = mockSessionsStore.get(currentSessionId);
    if (!session) {
      session = {
        id: currentSessionId,
        roomId: normalizedRoomId,
        startedAt: sampleRoom.createdAt || endedAt,
        endedAt,
        startedBy: normalizedUserId,
      };
    } else {
      session.endedAt = endedAt;
    }
    mockSessionsStore.set(currentSessionId, session);

    // Close all open attendance records (US-ATT-05, FR-6.5)
    await close_session_attendance(currentSessionId, endedAt);

    await deleteLivekitRoom(`linkup-${currentSessionId}`);
    return session;
  }

  // 2. Check in-memory mock store
  const mockRoomLists = Array.from(mockRoomsStore.values());
  const isMockRoomKnown = mockRoomLists.some((rooms) => rooms.some((r) => r.id === normalizedRoomId));

  if (isMockRoomKnown) {
    const userRooms = mockRoomsStore.get(normalizedUserId) || [];
    const hostRoom = userRooms.find((r) => r.id === normalizedRoomId);

    if (!hostRoom || hostRoom.myRole !== 'host') {
      const error: any = new Error('Only the room host can end a session');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }

    const currentSessionId = hostRoom.activeSessionId;
    if (!currentSessionId) {
      const error: any = new Error('No active session found in this room');
      error.code = 'NO_ACTIVE_SESSION';
      error.status = 404;
      throw error;
    }

    if (normalizedSessionId && normalizedSessionId !== currentSessionId) {
      const error: any = new Error('Session not found or already ended');
      error.code = 'SESSION_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    // Reset activeSessionId across all mock users for this room
    for (const [, rList] of mockRoomsStore.entries()) {
      const targetRoom = rList.find((r) => r.id === normalizedRoomId);
      if (targetRoom) {
        targetRoom.activeSessionId = null;
      }
    }

    let session = mockSessionsStore.get(currentSessionId);
    if (!session) {
      session = {
        id: currentSessionId,
        roomId: normalizedRoomId,
        startedAt: hostRoom.createdAt || endedAt,
        endedAt,
        startedBy: normalizedUserId,
      };
    } else {
      session.endedAt = endedAt;
    }
    mockSessionsStore.set(currentSessionId, session);

    // Close all open attendance records (US-ATT-05, FR-6.5)
    await close_session_attendance(currentSessionId, endedAt);

    await deleteLivekitRoom(`linkup-${currentSessionId}`);
    return session;
  }

  // 3. PostgreSQL / Supabase
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(normalizedRoomId)) {
    const error: any = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Check room exists
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('id, owner_id, archived_at')
    .eq('id', normalizedRoomId)
    .is('archived_at', null)
    .maybeSingle();

  if (roomError) {
    console.warn('[Session Service] Error fetching room:', roomError.message);
    throw new Error(roomError.message);
  }

  if (!room) {
    const error: any = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Check requester is host
  if (room.owner_id !== normalizedUserId) {
    const { data: membership } = await supabase
      .from('room_members')
      .select('member_role')
      .eq('room_id', normalizedRoomId)
      .eq('user_id', normalizedUserId)
      .maybeSingle();

    if (!membership || membership.member_role !== 'host') {
      const error: any = new Error('Only the room host can end a session');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }
  }

  // Fetch active session in room
  let sessionQuery = supabase
    .from('live_sessions')
    .select('id, room_id, started_at, ended_at, started_by, livekit_room')
    .eq('room_id', normalizedRoomId)
    .is('ended_at', null);

  if (normalizedSessionId) {
    sessionQuery = sessionQuery.eq('id', normalizedSessionId);
  }

  const { data: activeSession, error: sessionFetchErr } = await sessionQuery.maybeSingle();

  if (sessionFetchErr) {
    console.warn('[Session Service] Error fetching active session:', sessionFetchErr.message);
    throw new Error(sessionFetchErr.message);
  }

  if (!activeSession) {
    const error: any = new Error('No active session found in this room');
    error.code = 'NO_ACTIVE_SESSION';
    error.status = 404;
    throw error;
  }

  // 1. Set ended_at on session
  const { data: updatedSession, error: updateError } = await supabase
    .from('live_sessions')
    .update({ ended_at: endedAt })
    .eq('id', activeSession.id)
    .select('id, room_id, started_at, ended_at, started_by, livekit_room')
    .single();

  if (updateError) {
    console.error('[Session Service] Error ending live session:', updateError.message);
    throw new Error('Failed to end session');
  }

  // 2. Close all open attendance records (US-ATT-05, FR-6.5)
  await close_session_attendance(activeSession.id, endedAt);

  // 3. Delete LiveKit room
  const livekitRoomName = activeSession.livekit_room || `linkup-${activeSession.id}`;
  await deleteLivekitRoom(livekitRoomName);

  return {
    id: updatedSession.id,
    roomId: updatedSession.room_id,
    startedAt: updatedSession.started_at,
    endedAt: updatedSession.ended_at,
    startedBy: updatedSession.started_by,
    livekit_room: updatedSession.livekit_room || `linkup-${updatedSession.id}`,
    livekitRoom: updatedSession.livekit_room || `linkup-${updatedSession.id}`,
  };
}

/**
 * On server boot, close open records for already-ended sessions (US-ATT-05 crash recovery)
 */
export async function closeDanglingAttendanceRecords(): Promise<void> {
  // 1. In-memory / mock store crash recovery
  closeDanglingMockAttendance((sessionId) => {
    const session = mockSessionsStore.get(sessionId);
    return session?.endedAt;
  });

  // 2. Supabase DB crash recovery
  try {
    const { data: dangling, error } = await supabase
      .from('attendance')
      .select('id, session_id, live_sessions!inner(ended_at)')
      .is('left_at', null)
      .not('live_sessions.ended_at', 'is', null);

    if (!error && dangling && dangling.length > 0) {
      for (const row of dangling as any[]) {
        const endedAt = row.live_sessions?.ended_at || new Date().toISOString();
        await supabase
          .from('attendance')
          .update({ left_at: endedAt })
          .eq('id', row.id);
      }
      console.log(`[Attendance] Closed ${dangling.length} dangling attendance records from ended sessions.`);
    }
  } catch (err) {
    // Non-fatal on boot
  }
}

/**
 * Returns the currently active session for a room, or null if none is active.
 */
export async function getActiveSession(roomId: string): Promise<Session | null> {
  const normalizedRoomId = roomId?.trim();
  if (!normalizedRoomId) return null;

  if (mockSessionsStore.has(normalizedRoomId)) {
    return mockSessionsStore.get(normalizedRoomId)!;
  }

  // Check demo sample rooms
  if (DEFAULT_SAMPLE_ROOMS[normalizedRoomId]) {
    const sRoom = DEFAULT_SAMPLE_ROOMS[normalizedRoomId];
    if (!sRoom.activeSessionId) return null;
    return (
      mockSessionsStore.get(sRoom.activeSessionId) || {
        id: sRoom.activeSessionId,
        roomId: normalizedRoomId,
        startedAt: sRoom.createdAt || new Date().toISOString(),
        endedAt: null,
        startedBy: 'user-turing',
        livekit_room: `linkup-${sRoom.activeSessionId}`,
        livekitRoom: `linkup-${sRoom.activeSessionId}`,
      }
    );
  }

  // Check mock store
  for (const rooms of mockRoomsStore.values()) {
    if (Array.isArray(rooms)) {
      const r = rooms.find((rm) => rm.id === normalizedRoomId);
      if (r && r.activeSessionId) {
      return (
        mockSessionsStore.get(r.activeSessionId) || {
          id: r.activeSessionId,
          roomId: normalizedRoomId,
          startedAt: r.createdAt || new Date().toISOString(),
          endedAt: null,
          startedBy: 'host',
          livekit_room: `linkup-${r.activeSessionId}`,
          livekitRoom: `linkup-${r.activeSessionId}`,
        }
      );
    }
  }
}

  // Supabase DB
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(normalizedRoomId)) return null;

  const { data: session } = await supabase
    .from('live_sessions')
    .select('id, room_id, started_at, ended_at, started_by, livekit_room')
    .eq('room_id', normalizedRoomId)
    .is('ended_at', null)
    .maybeSingle();

  if (!session) return null;

  return {
    id: session.id,
    roomId: session.room_id,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    startedBy: session.started_by,
    livekit_room: session.livekit_room || `linkup-${session.id}`,
    livekitRoom: session.livekit_room || `linkup-${session.id}`,
  };
}

/**
 * Fetch all sessions for a room (ordered newest first) — host only.
 */
export async function getSessionsForRoom(
  userId: string,
  roomId: string
): Promise<Session[]> {
  const normalizedRoomId = roomId?.trim();
  const normalizedUserId = userId?.trim();

  if (!normalizedRoomId || !normalizedUserId) {
    const error: any = new Error('Room ID and user ID are required');
    error.code = 'VALIDATION';
    error.status = 400;
    throw error;
  }

  if (DEFAULT_SAMPLE_ROOMS[normalizedRoomId]) {
    const r = DEFAULT_SAMPLE_ROOMS[normalizedRoomId];
    if (r.myRole !== 'host') {
      const error: any = new Error('Only the room host can view sessions');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }
    const list: Session[] = [];
    if (r.activeSessionId) {
      const active = mockSessionsStore.get(r.activeSessionId);
      if (active) list.push(active);
    }
    return list;
  }

  const mockRoomLists = Array.from(mockRoomsStore.values());
  const isMockRoomKnown = mockRoomLists.some((rooms) => rooms.some((rm) => rm.id === normalizedRoomId));

  if (isMockRoomKnown) {
    const hostRoom = (mockRoomsStore.get(normalizedUserId) || []).find((rm) => rm.id === normalizedRoomId);
    if (!hostRoom || hostRoom.myRole !== 'host') {
      const error: any = new Error('Only the room host can view sessions');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }
    const list: Session[] = [];
    for (const s of mockSessionsStore.values()) {
      if (s.roomId === normalizedRoomId) list.push(s);
    }
    return list.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(normalizedRoomId)) {
    const error: any = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const { data: room } = await supabase
    .from('rooms')
    .select('id, owner_id')
    .eq('id', normalizedRoomId)
    .maybeSingle();

  if (!room) {
    const error: any = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  if (room.owner_id !== normalizedUserId) {
    const { data: membership } = await supabase
      .from('room_members')
      .select('member_role')
      .eq('room_id', normalizedRoomId)
      .eq('user_id', normalizedUserId)
      .maybeSingle();

    if (!membership || membership.member_role !== 'host') {
      const error: any = new Error('Only the room host can view sessions');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }
  }

  const { data: sessions, error: sessErr } = await supabase
    .from('live_sessions')
    .select('id, room_id, started_at, ended_at, started_by')
    .eq('room_id', normalizedRoomId)
    .order('started_at', { ascending: false });

  if (sessErr) {
    throw new Error(sessErr.message);
  }

  return (sessions || []).map((s) => ({
    id: s.id,
    roomId: s.room_id,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    startedBy: s.started_by,
  }));
}

/**
 * US-ATT-04 / US-ATT-06: Fetch attendance summary for a specific session (Host only).
 * Traces to FR-6.4, FR-6.6, api-contract §3.6.
 */
export async function getAttendanceSummary(
  userId: string,
  roomId: string,
  sessionId: string
): Promise<AttendanceRow[]> {
  const normalizedRoomId = roomId?.trim();
  const normalizedUserId = userId?.trim();
  const normalizedSessionId = sessionId?.trim();

  if (!normalizedRoomId || !normalizedUserId || !normalizedSessionId) {
    const error: any = new Error('Room ID, session ID, and user ID are required');
    error.code = 'VALIDATION';
    error.status = 400;
    throw error;
  }

  // 1. Check DEFAULT_SAMPLE_ROOMS
  if (DEFAULT_SAMPLE_ROOMS[normalizedRoomId]) {
    const r = DEFAULT_SAMPLE_ROOMS[normalizedRoomId];
    if (r.myRole !== 'host') {
      const error: any = new Error('Only the room host can view attendance');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }
    const sess = mockSessionsStore.get(normalizedSessionId);
    if (!sess || sess.roomId !== normalizedRoomId) {
      const error: any = new Error('Session not found');
      error.code = 'SESSION_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    return calculateMockAttendanceSummary(normalizedSessionId, sess.endedAt, sess.startedAt);
  }

  // 2. Check in-memory mock rooms
  const mockRoomLists = Array.from(mockRoomsStore.values());
  const isMockRoomKnown = mockRoomLists.some((rooms) => rooms.some((rm) => rm.id === normalizedRoomId));

  if (isMockRoomKnown) {
    const userRooms = mockRoomsStore.get(normalizedUserId) || [];
    const hostRoom = userRooms.find((rm) => rm.id === normalizedRoomId);
    if (!hostRoom || hostRoom.myRole !== 'host') {
      const error: any = new Error('Only the room host can view attendance');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }

    const sess = mockSessionsStore.get(normalizedSessionId);
    const hasMockRecords = getMockAttendance().some(
      (a) => a.sessionId === normalizedSessionId && a.roomId === normalizedRoomId
    );

    if (!sess && !hasMockRecords) {
      const error: any = new Error('Session not found');
      error.code = 'SESSION_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    if (sess && sess.roomId !== normalizedRoomId) {
      const error: any = new Error('Session not found');
      error.code = 'SESSION_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    return calculateMockAttendanceSummary(normalizedSessionId, sess?.endedAt, sess?.startedAt);
  }

  // 3. PostgreSQL / Supabase
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(normalizedRoomId)) {
    const error: any = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('id, owner_id')
    .eq('id', normalizedRoomId)
    .maybeSingle();

  if (roomError) {
    throw new Error(roomError.message);
  }

  if (!room) {
    const error: any = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  if (room.owner_id !== normalizedUserId) {
    const { data: membership } = await supabase
      .from('room_members')
      .select('member_role')
      .eq('room_id', normalizedRoomId)
      .eq('user_id', normalizedUserId)
      .maybeSingle();

    if (!membership || membership.member_role !== 'host') {
      const error: any = new Error('Only the room host can view attendance');
      error.code = 'HOST_ONLY';
      error.status = 403;
      throw error;
    }
  }

  if (!UUID_REGEX.test(normalizedSessionId)) {
    const error: any = new Error('Session not found');
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const { data: session, error: sessError } = await supabase
    .from('live_sessions')
    .select('id, room_id, started_at, ended_at')
    .eq('id', normalizedSessionId)
    .eq('room_id', normalizedRoomId)
    .maybeSingle();

  if (sessError) {
    throw new Error(sessError.message);
  }

  if (!session) {
    const error: any = new Error('Session not found');
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Try database RPC attendance_summary
  try {
    const { data: rpcRows, error: rpcErr } = await supabase.rpc('attendance_summary', {
      p_session: normalizedSessionId,
    });

    if (!rpcErr && Array.isArray(rpcRows)) {
      return rpcRows.map((r: any) => {
        const minutes = Number(r.minutes) || 0;
        return {
          userId: r.user_id,
          fullName: r.full_name || 'Participant',
          firstJoin: r.first_join,
          lastLeave: r.last_leave,
          minutes,
          joins: Number(r.joins) || 0,
          status: computeAttendanceStatus(minutes, session.started_at, session.ended_at),
        };
      });
    }
  } catch {
    // Fall back to table query below
  }

  // Fallback direct query on attendance table
  const { data: attRows, error: attErr } = await supabase
    .from('attendance')
    .select('user_id, joined_at, left_at')
    .eq('session_id', normalizedSessionId);

  if (attErr) {
    throw new Error(attErr.message);
  }

  if (!attRows || attRows.length === 0) {
    return [];
  }

  const userIds = Array.from(new Set(attRows.map((r) => r.user_id)));
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', userIds);

  const profileMap = new Map<string, string>();
  (profiles || []).forEach((p) => profileMap.set(p.id, p.full_name));

  return aggregateAttendanceRecords(
    attRows.map((r) => ({
      id: 0,
      sessionId: normalizedSessionId,
      roomId: normalizedRoomId,
      userId: r.user_id,
      userName: profileMap.get(r.user_id),
      joinedAt: r.joined_at,
      leftAt: r.left_at,
    })),
    session.ended_at,
    session.started_at
  );
}

/**
 * US-ATT-06: Export attendance summary for a session as CSV (Host only).
 * Traces to FR-6.6, api-contract §3.6.
 */
export async function getAttendanceCSV(
  userId: string,
  roomId: string,
  sessionId: string
): Promise<string> {
  const rows = await getAttendanceSummary(userId, roomId, sessionId);
  return attendanceToCSV(rows);
}

