import { supabase } from './supabase';
import { getActiveSession } from './rooms';
import { AttendanceRecord } from '@linkup/shared';

export type MockAttendanceRecord = AttendanceRecord;

// In-memory mock store for attendance records
const mockAttendanceStore: MockAttendanceRecord[] = [];

// Grace timers map: key = `${sessionId}:${userId}` -> NodeJS.Timeout
const graceTimers = new Map<string, NodeJS.Timeout>();

// Active live sockets map: key = `${roomId}:${userId}` -> Set<socketId>
const liveSocketsMap = new Map<string, Set<string>>();

// Default grace period in ms: 15 seconds (FR-3.8, FR-6.2, US-LIVE-07 AC-4, US-ATT-02)
let configuredGracePeriodMs = 15000;

export function setAttendanceGracePeriodMs(ms: number) {
  configuredGracePeriodMs = ms;
}

export function resetAttendanceGracePeriodMs() {
  configuredGracePeriodMs = 15000;
}

export function getGraceTimersCount(): number {
  return graceTimers.size;
}

export function hasActiveGraceTimer(sessionId: string, userId: string): boolean {
  return graceTimers.has(`${sessionId}:${userId}`);
}

export function clearAllGraceTimers(): void {
  for (const timer of graceTimers.values()) {
    clearTimeout(timer);
  }
  graceTimers.clear();
  liveSocketsMap.clear();
}

export function getMockAttendance(): MockAttendanceRecord[] {
  return mockAttendanceStore;
}

export function clearMockAttendance(): void {
  mockAttendanceStore.length = 0;
  clearAllGraceTimers();
}

export function addMockAttendance(rec: MockAttendanceRecord): void {
  mockAttendanceStore.push(rec);
}

/**
 * Handle a user joining the live call (live:joined event).
 * Acceptance Criteria (US-LIVE-07 AC-4, US-ATT-01 AC-1, US-ATT-02 AC-1):
 * - If user disconnects/leaves and reconnects within 15 seconds, cancel the grace timer
 *   and reuse the single open attendance record.
 * - Otherwise, create or reuse an open attendance record.
 */
export async function recordLiveJoin(
  roomId: string,
  userId: string,
  socketId: string
): Promise<MockAttendanceRecord | null> {
  const normRoom = roomId?.trim();
  const normUser = userId?.trim();
  if (!normRoom || !normUser) return null;

  // Track live socket for user
  const liveKey = `${normRoom}:${normUser}`;
  let sockets = liveSocketsMap.get(liveKey);
  if (!sockets) {
    sockets = new Set<string>();
    liveSocketsMap.set(liveKey, sockets);
  }
  if (socketId) {
    sockets.add(socketId);
  }

  // Find active session for room
  const activeSession = await getActiveSession(normRoom);
  if (!activeSession?.id) {
    return null;
  }

  const timerKey = `${activeSession.id}:${normUser}`;

  // If a grace timer is active for this user, CANCEL IT!
  // This satisfies US-LIVE-07 AC-4: "A reconnect within 15 seconds reuses the open attendance record."
  if (graceTimers.has(timerKey)) {
    clearTimeout(graceTimers.get(timerKey)!);
    graceTimers.delete(timerKey);
    console.log(`[Attendance] Reconnect within 15s grace period! Cancelled timer for user ${normUser} in session ${activeSession.id}. Reusing open record.`);

    // Return existing open record
    const openMock = mockAttendanceStore.find(
      (a) => a.sessionId === activeSession.id && a.userId === normUser && a.leftAt === null
    );
    if (openMock) return openMock;
  }

  // Check if open record already exists in mock store
  const existingOpen = mockAttendanceStore.find(
    (a) => a.sessionId === activeSession.id && a.userId === normUser && a.leftAt === null
  );
  if (existingOpen) {
    return existingOpen;
  }

  // Check in Supabase DB if not mock
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isDbRoom = UUID_REGEX.test(normRoom);

  if (isDbRoom) {
    try {
      const { data: dbOpen } = await supabase
        .from('attendance')
        .select('*')
        .eq('session_id', activeSession.id)
        .eq('user_id', normUser)
        .is('left_at', null)
        .maybeSingle();

      if (dbOpen) {
        return {
          id: dbOpen.id,
          sessionId: dbOpen.session_id,
          roomId: dbOpen.room_id,
          userId: dbOpen.user_id,
          joinedAt: dbOpen.joined_at,
          leftAt: dbOpen.left_at,
        };
      }

      // Create new attendance record in Supabase
      const { data: inserted, error: insErr } = await supabase
        .from('attendance')
        .insert({
          session_id: activeSession.id,
          room_id: normRoom,
          user_id: normUser,
          joined_at: new Date().toISOString(),
          left_at: null,
        })
        .select()
        .single();

      if (insErr) {
        console.warn('[Attendance] Error inserting attendance record:', insErr.message);
      } else if (inserted) {
        return {
          id: inserted.id,
          sessionId: inserted.session_id,
          roomId: inserted.room_id,
          userId: inserted.user_id,
          joinedAt: inserted.joined_at,
          leftAt: inserted.left_at,
        };
      }
    } catch (err: any) {
      console.warn('[Attendance] DB error in recordLiveJoin:', err?.message || err);
    }
  }

  // Create new record in mock store
  const newRecord: MockAttendanceRecord = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    sessionId: activeSession.id,
    roomId: normRoom,
    userId: normUser,
    joinedAt: new Date().toISOString(),
    leftAt: null,
  };
  mockAttendanceStore.push(newRecord);
  return newRecord;
}

/**
 * Handle a user leaving the live call (live:left event).
 * Starts 15-second grace period. If no reconnect happens, closes the attendance record.
 */
export async function recordLiveLeave(
  roomId: string,
  userId: string,
  socketId: string,
  customGracePeriodMs?: number
): Promise<void> {
  const normRoom = roomId?.trim();
  const normUser = userId?.trim();
  if (!normRoom || !normUser) return;

  const liveKey = `${normRoom}:${normUser}`;
  const sockets = liveSocketsMap.get(liveKey);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size > 0) {
      // User still has another live socket in this room (multi-tab support US-ATT-03)
      return;
    }
    liveSocketsMap.delete(liveKey);
  }

  const activeSession = await getActiveSession(normRoom);
  if (!activeSession?.id) return;

  startGraceTimer(activeSession.id, normUser, normRoom, customGracePeriodMs ?? configuredGracePeriodMs);
}

/**
 * Handle a socket disconnecting.
 * Checks if the socket belonged to any user's liveSockets and starts 15s grace period if no live sockets remain.
 */
export async function recordSocketDisconnect(
  socketId: string,
  customGracePeriodMs?: number,
  userId?: string
): Promise<void> {
  let matched = false;
  for (const [key, sockets] of Array.from(liveSocketsMap.entries())) {
    if (sockets.has(socketId)) {
      matched = true;
      sockets.delete(socketId);
      const [roomId, uId] = key.split(':');
      if (sockets.size === 0) {
        liveSocketsMap.delete(key);
        const activeSession = await getActiveSession(roomId);
        if (activeSession?.id) {
          startGraceTimer(activeSession.id, uId, roomId, customGracePeriodMs ?? configuredGracePeriodMs);
        }
      }
    }
  }

  // Fallback: if not matched by socketId but userId was in a live session with an open record
  if (!matched && userId) {
    const normUser = userId.trim();
    for (const att of mockAttendanceStore) {
      if (att.userId === normUser && att.leftAt === null) {
        const activeSession = await getActiveSession(att.roomId);
        if (activeSession?.id === att.sessionId) {
          startGraceTimer(activeSession.id, normUser, att.roomId, customGracePeriodMs ?? configuredGracePeriodMs);
        }
      }
    }

    try {
      const { data: dbRecords } = await supabase
        .from('attendance')
        .select('*')
        .eq('user_id', normUser)
        .is('left_at', null);

      if (dbRecords && dbRecords.length > 0) {
        for (const rec of dbRecords) {
          const activeSession = await getActiveSession(rec.room_id);
          if (activeSession?.id === rec.session_id) {
            startGraceTimer(activeSession.id, normUser, rec.room_id, customGracePeriodMs ?? configuredGracePeriodMs);
          }
        }
      }
    } catch {
      // Fallback DB error ignored
    }
  }
}

function startGraceTimer(
  sessionId: string,
  userId: string,
  roomId: string,
  gracePeriodMs: number
): void {
  const timerKey = `${sessionId}:${userId}`;
  if (graceTimers.has(timerKey)) {
    return; // Timer already running
  }

  console.log(`[Attendance] Starting ${gracePeriodMs}ms grace timer for user ${userId} in session ${sessionId}`);

  const timer = setTimeout(async () => {
    graceTimers.delete(timerKey);
    console.log(`[Attendance] Grace period expired (${gracePeriodMs}ms) for user ${userId}. Closing attendance record.`);
    await closeUserAttendance(sessionId, userId);
  }, gracePeriodMs);

  graceTimers.set(timerKey, timer);
}

/**
 * Close open attendance record for a user in a session.
 */
export async function closeUserAttendance(
  sessionId: string,
  userId: string,
  leftAt: string = new Date().toISOString()
): Promise<void> {
  // Close in mock store
  for (const att of mockAttendanceStore) {
    if (att.sessionId === sessionId && att.userId === userId && att.leftAt === null) {
      att.leftAt = leftAt;
    }
  }

  // Close in Supabase DB
  try {
    await supabase
      .from('attendance')
      .update({ left_at: leftAt })
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .is('left_at', null);
  } catch (err) {
    console.warn('[Attendance] DB close attendance error:', err);
  }
}

/**
 * Close all open attendance records for a session (e.g. on session end).
 */
export async function closeAllSessionAttendance(
  sessionId: string,
  endedAt: string = new Date().toISOString()
): Promise<void> {
  // Clear any pending grace timers for this session
  for (const [timerKey, timer] of Array.from(graceTimers.entries())) {
    if (timerKey.startsWith(`${sessionId}:`)) {
      clearTimeout(timer);
      graceTimers.delete(timerKey);
    }
  }

  // Close mock records
  for (const att of mockAttendanceStore) {
    if (att.sessionId === sessionId && att.leftAt === null) {
      att.leftAt = endedAt;
    }
  }

  // Supabase RPC or fallback
  try {
    const { error: rpcErr } = await supabase.rpc('close_session_attendance', {
      p_session: sessionId,
      p_at: endedAt,
    });
    if (rpcErr) {
      await supabase
        .from('attendance')
        .update({ left_at: endedAt })
        .eq('session_id', sessionId)
        .is('left_at', null);
    }
  } catch (err) {
    console.warn('[Attendance] Error closing session attendance in DB:', err);
  }
}
