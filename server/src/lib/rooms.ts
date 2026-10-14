import { supabase } from './supabase';
import { RoomSummary, MemberRole } from '@linkup/shared';

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
