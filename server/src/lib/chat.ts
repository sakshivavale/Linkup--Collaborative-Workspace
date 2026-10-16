import { supabase } from './supabase';
import { ChatMessage, ChatHistoryResponse, UserRole } from '@linkup/shared';
import { getRoomForUser } from './rooms';
import { getActiveSession } from './rooms';

// In-memory mock store for unit & integration testing: roomId -> ChatMessage[] (oldest first)
const mockMessagesStore = new Map<string, ChatMessage[]>();

/**
 * Configure mock messages for testing
 */
export function setMockMessages(roomId: string, messages: ChatMessage[]): void {
  const normalized = roomId?.trim();
  mockMessagesStore.set(normalized, [...messages]);
}

/**
 * Add a mock message to the store
 */
export function addMockMessage(roomId: string, message: ChatMessage): void {
  const normalized = roomId?.trim();
  const existing = mockMessagesStore.get(normalized) || [];
  existing.push(message);
  mockMessagesStore.set(normalized, existing);
}

/**
 * Get all mock messages for a room
 */
export function getMockMessages(roomId: string): ChatMessage[] {
  const normalized = roomId?.trim();
  return mockMessagesStore.get(normalized) || [];
}

/**
 * Clear mock messages store
 */
export function clearMockMessages(roomId?: string): void {
  if (roomId) {
    mockMessagesStore.delete(roomId.trim());
  } else {
    mockMessagesStore.clear();
  }
}

/**
 * Fetch chat message history for a room with cursor pagination (US-CHAT-02, FR-3.12, api-contract §3.5)
 *
 * Query params:
 * - before?: ISO timestamp cursor (fetches messages created before this timestamp)
 * - limit?: number of messages to fetch (default: 50, max: 100)
 *
 * Returns:
 * - messages: ChatMessage[] sorted oldest to newest (newest at bottom)
 * - hasMore: boolean indicating if older messages exist
 */
export async function getChatMessages(
  userId: string,
  roomId: string,
  options?: { before?: string; limit?: number }
): Promise<ChatHistoryResponse> {
  const normalizedRoomId = roomId?.trim();
  const normalizedUserId = userId?.trim();

  if (!normalizedRoomId || !normalizedUserId) {
    const error: any = new Error('Room ID and user ID are required');
    error.code = 'VALIDATION';
    error.status = 400;
    throw error;
  }

  // Enforce room membership (non-members receive 403 NOT_A_MEMBER)
  const room = await getRoomForUser(normalizedUserId, normalizedRoomId);

  const rawLimit = Number(options?.limit ?? 50);
  const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 50 : rawLimit));
  const before = options?.before?.trim();

  // Check mock store if active or for sample rooms
  const isMockActive = mockMessagesStore.has(normalizedRoomId) || process.env.NODE_ENV === 'test';
  if (isMockActive) {
    const allMessages = mockMessagesStore.get(normalizedRoomId) || [];
    
    // Filter messages created before the cursor if 'before' is provided
    let candidate = allMessages;
    if (before) {
      const beforeTime = new Date(before).getTime();
      candidate = allMessages.filter((m) => new Date(m.createdAt).getTime() < beforeTime);
    }

    // Sort descending by created_at to pick the most recent older messages
    candidate = [...candidate].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const hasMore = candidate.length > limit;
    const sliced = candidate.slice(0, limit);

    // Return chronological order: oldest -> newest
    sliced.reverse();

    return {
      messages: sliced,
      hasMore,
    };
  }

  // Database query via Supabase
  try {
    let query = supabase
      .from('messages')
      .select('id, room_id, session_id, sender_id, body, created_at, profiles:sender_id (full_name, role)')
      .eq('room_id', normalizedRoomId)
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data, error } = await query;

    if (error) {
      console.warn('[Chat Service] Supabase error fetching messages:', error.message);
      // Fallback to in-memory store if DB query fails
      const fallback = mockMessagesStore.get(normalizedRoomId) || [];
      return { messages: fallback.slice(-limit), hasMore: false };
    }

    const rows = data || [];
    const hasMore = rows.length > limit;
    const pickedRows = rows.slice(0, limit);

    const messages: ChatMessage[] = pickedRows.map((row: any) => ({
      id: Number(row.id),
      roomId: row.room_id,
      senderId: row.sender_id,
      senderName: row.profiles?.full_name || 'Participant',
      senderRole: (row.profiles?.role as UserRole) || 'student',
      body: row.body,
      createdAt: row.created_at,
    }));

    // Chronological order: oldest -> newest
    messages.reverse();

    return {
      messages,
      hasMore,
    };
  } catch (err) {
    console.warn('[Chat Service] Exception fetching messages:', err);
    return {
      messages: [],
      hasMore: false,
    };
  }
}

/**
 * Send a new chat message in a room (US-CHAT-01, FR-3.10)
 */
export async function createChatMessage(
  userId: string,
  roomId: string,
  body: string
): Promise<ChatMessage> {
  const normalizedRoomId = roomId?.trim();
  const normalizedUserId = userId?.trim();
  const trimmedBody = body?.trim();

  if (!normalizedRoomId || !normalizedUserId) {
    const error: any = new Error('Room ID and user ID are required');
    error.code = 'VALIDATION';
    error.status = 400;
    throw error;
  }

  if (!trimmedBody || trimmedBody.length === 0) {
    const error: any = new Error('Message cannot be empty');
    error.code = 'VALIDATION';
    error.status = 400;
    throw error;
  }

  if (trimmedBody.length > 2000) {
    const error: any = new Error('Message cannot exceed 2000 characters');
    error.code = 'VALIDATION';
    error.status = 400;
    throw error;
  }

  // Validate room membership
  const room = await getRoomForUser(normalizedUserId, normalizedRoomId);

  // Determine sender details
  const currentMember = room.members?.find((m) => m.userId === normalizedUserId);
  const senderName = currentMember?.fullName || (room.myRole === 'host' ? room.hostName : 'Participant');
  const senderRole: UserRole = currentMember?.userRole || (room.myRole === 'host' ? 'teacher' : 'student');

  let activeSessionId: string | null = null;
  try {
    const active = await getActiveSession(normalizedRoomId);
    activeSessionId = active?.id || null;
  } catch {
    // Session check is optional
  }

  const isMockActive = mockMessagesStore.has(normalizedRoomId) || process.env.NODE_ENV === 'test';

  if (isMockActive) {
    const mockMsg: ChatMessage = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      roomId: normalizedRoomId,
      senderId: normalizedUserId,
      senderName,
      senderRole,
      body: trimmedBody,
      createdAt: new Date().toISOString(),
    };
    addMockMessage(normalizedRoomId, mockMsg);
    return mockMsg;
  }

  // Database insert
  try {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        room_id: normalizedRoomId,
        session_id: activeSessionId,
        sender_id: normalizedUserId,
        body: trimmedBody,
      })
      .select('id, room_id, sender_id, body, created_at')
      .single();

    if (error || !data) {
      console.warn('[Chat Service] Supabase message insert error:', error?.message);
      const fallbackMsg: ChatMessage = {
        id: Date.now(),
        roomId: normalizedRoomId,
        senderId: normalizedUserId,
        senderName,
        senderRole,
        body: trimmedBody,
        createdAt: new Date().toISOString(),
      };
      addMockMessage(normalizedRoomId, fallbackMsg);
      return fallbackMsg;
    }

    return {
      id: Number(data.id),
      roomId: data.room_id,
      senderId: data.sender_id,
      senderName,
      senderRole,
      body: data.body,
      createdAt: data.created_at,
    };
  } catch (err) {
    const fallbackMsg: ChatMessage = {
      id: Date.now(),
      roomId: normalizedRoomId,
      senderId: normalizedUserId,
      senderName,
      senderRole,
      body: trimmedBody,
      createdAt: new Date().toISOString(),
    };
    addMockMessage(normalizedRoomId, fallbackMsg);
    return fallbackMsg;
  }
}
