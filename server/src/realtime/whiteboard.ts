import { WB_PERSIST_DEBOUNCE_MS } from '@linkup/shared';
import { supabase } from '../lib/supabase';
import { getRoomPresence } from './presence';
import { getRoomForUser } from '../lib/rooms';

// UUID regex to validate Postgres UUID keys
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// In-memory whiteboard elements: roomId -> elements array (boardCache)
const whiteboardMap = new Map<string, unknown[]>();

// In-memory persistent fallback store for tests / offline mode
const mockWhiteboardDb = new Map<string, unknown[]>();

// Debounce timers: roomId -> NodeJS.Timeout (5 seconds)
const debounceTimers = new Map<string, NodeJS.Timeout>();

/**
 * Get whiteboard elements for a room synchronously from memory cache.
 */
export function getWhiteboardElements(roomId: string): unknown[] {
  const normalized = roomId?.trim();
  if (!normalized) return [];
  return whiteboardMap.get(normalized) || [];
}

/**
 * Asynchronously retrieve whiteboard state for a room, loading from Postgres if not cached.
 * US-WB-03: Board state survives a server restart and restores on rejoin.
 */
export async function getOrLoadWhiteboardState(
  roomId: string
): Promise<{ elements: unknown[] }> {
  const normalized = roomId?.trim();
  if (!normalized) {
    return { elements: [] };
  }

  const existing = whiteboardMap.get(normalized);
  if (existing) {
    return { elements: existing };
  }

  // 1. If roomId is a valid UUID, attempt to load from Postgres (Supabase)
  if (UUID_REGEX.test(normalized)) {
    try {
      const { data, error } = await supabase
        .from('whiteboard_state')
        .select('elements')
        .eq('room_id', normalized)
        .maybeSingle();

      if (!error && data && Array.isArray(data.elements)) {
        whiteboardMap.set(normalized, data.elements);
        mockWhiteboardDb.set(normalized, [...data.elements]);
        return { elements: data.elements };
      }
    } catch (err: any) {
      console.warn(`[whiteboard] Failed to query whiteboard_state for room ${normalized}:`, err?.message || err);
    }
  }

  // 2. Fall back to mockWhiteboardDb if present
  const mockSaved = mockWhiteboardDb.get(normalized);
  if (mockSaved && Array.isArray(mockSaved)) {
    whiteboardMap.set(normalized, [...mockSaved]);
    return { elements: [...mockSaved] };
  }

  // 3. Fallback initial default (empty board)
  const initial: unknown[] = [];
  whiteboardMap.set(normalized, initial);
  return { elements: initial };
}

/**
 * Update whiteboard elements for a room.
 * Schedules debounced 5s persistence to Postgres.
 */
export function setWhiteboardElements(roomId: string, elements: unknown[]): void {
  const normalized = roomId?.trim();
  if (!normalized) return;
  const safeElements = Array.isArray(elements) ? elements : [];
  whiteboardMap.set(normalized, safeElements);
  scheduleDebouncedPersist(normalized, WB_PERSIST_DEBOUNCE_MS);
}

/**
 * Merge whiteboard elements for a room according to US-WB-02 / architecture §5.6:
 * Keep higher version; tie -> lower versionNonce wins.
 * Deletions (Excalidraw isDeleted: true) sync correctly.
 * Schedules debounced 5s persistence to Postgres (US-WB-03 AC-1).
 */
export function mergeWhiteboardElements(roomId: string, incomingElements: any[]): any[] {
  const normalized = roomId?.trim();
  if (!normalized) return [];
  const current = (whiteboardMap.get(normalized) || []) as any[];
  const elementMap = new Map<string, any>(current.map((el) => [el.id, el]));

  for (const el of incomingElements) {
    if (!el || !el.id) continue;
    const existing = elementMap.get(el.id);
    if (!existing) {
      elementMap.set(el.id, el);
    } else {
      const elVersion = typeof el.version === 'number' ? el.version : 0;
      const exVersion = typeof existing.version === 'number' ? existing.version : 0;
      if (elVersion > exVersion) {
        elementMap.set(el.id, el);
      } else if (elVersion === exVersion) {
        const elNonce = typeof el.versionNonce === 'number' ? el.versionNonce : 0;
        const exNonce = typeof existing.versionNonce === 'number' ? existing.versionNonce : 0;
        if (elNonce < exNonce) {
          elementMap.set(el.id, el);
        }
      }
    }
  }

  const merged = Array.from(elementMap.values());
  whiteboardMap.set(normalized, merged);
  scheduleDebouncedPersist(normalized, WB_PERSIST_DEBOUNCE_MS);
  return merged;
}

/**
 * Schedules debounced persistence to Postgres (5 seconds per US-WB-03 AC-1).
 */
export function scheduleDebouncedPersist(roomId: string, delayMs = WB_PERSIST_DEBOUNCE_MS): void {
  const normalized = roomId?.trim();
  if (!normalized) return;

  const existingTimer = debounceTimers.get(normalized);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    debounceTimers.delete(normalized);
    persistWhiteboardState(normalized).catch((err) => {
      console.warn(`[whiteboard] Debounced persist error for room ${normalized}:`, err);
    });
  }, delayMs);

  debounceTimers.set(normalized, timer);
}

/**
 * Persists the current whiteboard state for a room to Postgres immediately.
 * Called after 5 s debounce and immediately when the last editor leaves.
 */
export async function persistWhiteboardState(roomId: string): Promise<boolean> {
  const normalized = roomId?.trim();
  if (!normalized) return false;

  // Clear any pending debounce timer
  const existingTimer = debounceTimers.get(normalized);
  if (existingTimer) {
    clearTimeout(existingTimer);
    debounceTimers.delete(normalized);
  }

  const elements = whiteboardMap.get(normalized);
  if (elements === undefined) return false;

  // Persist to mock store for test resilience / offline recovery
  mockWhiteboardDb.set(normalized, Array.isArray(elements) ? [...elements] : []);

  // If valid UUID, persist to Postgres via Supabase
  if (UUID_REGEX.test(normalized)) {
    try {
      const { error } = await supabase
        .from('whiteboard_state')
        .upsert(
          {
            room_id: normalized,
            elements: elements,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'room_id' }
        );

      if (error) {
        console.warn(`[whiteboard] Supabase upsert error for room ${normalized}:`, error.message);
        return false;
      }
      return true;
    } catch (err: any) {
      console.warn(`[whiteboard] Exception persisting room ${normalized}:`, err?.message || err);
      return false;
    }
  }

  return true;
}

/**
 * US-WB-03 AC-1: Immediately persist whiteboard state to Postgres if the leaving user
 * was an editor and there are no other active editors in the room, or if the room is now empty.
 */
export async function checkAndPersistWhiteboardOnLeave(
  roomId: string,
  leavingUserId?: string
): Promise<void> {
  const normalized = roomId?.trim();
  if (!normalized) return;

  const presence = getRoomPresence(normalized);
  // If room is now empty, immediately persist
  if (presence.length === 0) {
    await persistWhiteboardState(normalized);
    return;
  }

  if (leavingUserId) {
    try {
      const room = await getRoomForUser(leavingUserId, normalized);
      const isHost = (uid: string) => {
        const m = room.members?.find((member) => member.userId === uid);
        return m?.memberRole === 'host' || (room as any).owner_id === uid;
      };
      const canEdit = (uid: string) => {
        const m = room.members?.find((member) => member.userId === uid);
        return isHost(uid) || Boolean(m?.permissions?.canWhiteboard);
      };

      const leavingWasEditor = canEdit(leavingUserId);
      if (leavingWasEditor) {
        const remainingEditors = presence.filter((p) => canEdit(p.userId));
        if (remainingEditors.length === 0) {
          await persistWhiteboardState(normalized);
        }
      }
    } catch {
      // Fallback: if presence is 0, persist
      if (presence.length === 0) {
        await persistWhiteboardState(normalized);
      }
    }
  }
}

/**
 * Flush all pending whiteboard states across all rooms (e.g. on server SIGTERM/shutdown).
 */
export async function flushAllWhiteboardState(): Promise<void> {
  const promises: Promise<boolean>[] = [];
  for (const roomId of whiteboardMap.keys()) {
    promises.push(persistWhiteboardState(roomId));
  }
  await Promise.all(promises);
}

/**
 * Clear whiteboard elements for a room and persist the cleared empty state (US-WB-05 AC-3, AC-4).
 */
export async function clearAndPersistWhiteboard(roomId: string): Promise<boolean> {
  const normalized = roomId?.trim();
  if (!normalized) return false;
  const timer = debounceTimers.get(normalized);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(normalized);
  }
  whiteboardMap.set(normalized, []);
  mockWhiteboardDb.set(normalized, []);
  return await persistWhiteboardState(normalized);
}

/**
 * Clear whiteboard elements for a room.
 */
export function clearWhiteboardRoom(roomId: string): void {
  const normalized = roomId?.trim();
  if (!normalized) return;
  const timer = debounceTimers.get(normalized);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(normalized);
  }
  whiteboardMap.delete(normalized);
}

/**
 * Clear all whiteboard rooms (for testing)
 */
export function clearWhiteboard(): void {
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
  whiteboardMap.clear();
}

/**
 * Test helper: inspect mock DB entry
 */
export function getMockWhiteboardDb(roomId?: string): any {
  if (roomId) return mockWhiteboardDb.get(roomId);
  return mockWhiteboardDb;
}

/**
 * Test helper: clear mock DB
 */
export function clearMockWhiteboardDb(): void {
  mockWhiteboardDb.clear();
}
