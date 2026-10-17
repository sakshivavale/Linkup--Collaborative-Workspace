import { CodeState, Language, MAX_CODE_BYTES } from '@linkup/shared';
import { supabase } from '../lib/supabase';

export { MAX_CODE_BYTES };

/**
 * Validate source code size (max 64 KB per US-CODE-03, FR-5.2)
 */
export function validateCodeSize(content: string): { valid: boolean; sizeBytes: number; error?: string } {
  const sizeBytes = Buffer.byteLength(content || '', 'utf8');
  if (sizeBytes > MAX_CODE_BYTES) {
    return {
      valid: false,
      sizeBytes,
      error: 'Source code exceeds the 64 KB limit.',
    };
  }
  return { valid: true, sizeBytes };
}

// UUID regex to validate Postgres UUID keys
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// In-memory state: roomId -> CodeState (codeCache)
const codeStateMap = new Map<string, CodeState>();

// In-memory persistent fallback store for tests / offline mode
const mockCodeDb = new Map<string, CodeState>();

// Debounce timers: roomId -> NodeJS.Timeout (3 seconds)
const debounceTimers = new Map<string, NodeJS.Timeout>();

const DEFAULT_INITIAL_CONTENT = '# Shared Python Code Workspace\nprint("Hello, Linkup!")\n';

/**
 * Get code state for a room synchronously from memory / mock store.
 * Defaults to python, revision 0, and defaultHostId as pen holder.
 */
export function getCodeState(roomId: string, defaultHostId?: string | null): CodeState {
  const normalized = roomId?.trim();
  if (!normalized) {
    return { content: '', language: 'python', rev: 0, holderId: null };
  }

  const existing = codeStateMap.get(normalized);
  if (existing) {
    if (!existing.holderId && defaultHostId) {
      existing.holderId = defaultHostId;
    }
    return existing;
  }

  const mockSaved = mockCodeDb.get(normalized);
  if (mockSaved) {
    const loaded: CodeState = {
      content: mockSaved.content ?? '',
      language: (mockSaved.language as Language) || 'python',
      rev: typeof mockSaved.rev === 'number' ? mockSaved.rev : 0,
      holderId: mockSaved.holderId || defaultHostId || null,
    };
    codeStateMap.set(normalized, loaded);
    return loaded;
  }

  const initial: CodeState = {
    content: DEFAULT_INITIAL_CONTENT,
    language: 'python',
    rev: 0,
    holderId: defaultHostId || null,
  };
  codeStateMap.set(normalized, initial);
  return initial;
}

/**
 * Asynchronously retrieve code state for a room, loading from Postgres if not cached.
 * US-CODE-06: Code state survives a server restart and restores on rejoin.
 */
export async function getOrLoadCodeState(
  roomId: string,
  defaultHostId?: string | null
): Promise<CodeState> {
  const normalized = roomId?.trim();
  if (!normalized) {
    return { content: '', language: 'python', rev: 0, holderId: null };
  }

  const existing = codeStateMap.get(normalized);
  if (existing) {
    if (!existing.holderId && defaultHostId) {
      existing.holderId = defaultHostId;
    }
    return existing;
  }

  // 1. If roomId is a valid UUID, attempt to load from Postgres (Supabase)
  if (UUID_REGEX.test(normalized)) {
    try {
      const { data, error } = await supabase
        .from('code_state')
        .select('language, content, holder_id, rev')
        .eq('room_id', normalized)
        .maybeSingle();

      if (!error && data) {
        const loaded: CodeState = {
          content: data.content ?? '',
          language: (data.language as Language) || 'python',
          rev: typeof data.rev === 'number' ? data.rev : 0,
          holderId: data.holder_id || defaultHostId || null,
        };
        codeStateMap.set(normalized, loaded);
        mockCodeDb.set(normalized, { ...loaded });
        return loaded;
      }
    } catch (err: any) {
      console.warn(`[codeWorkspace] Failed to query code_state for room ${normalized}:`, err?.message || err);
    }
  }

  // 2. Fall back to mockCodeDb if present
  const mockSaved = mockCodeDb.get(normalized);
  if (mockSaved) {
    const loaded: CodeState = {
      content: mockSaved.content ?? '',
      language: (mockSaved.language as Language) || 'python',
      rev: typeof mockSaved.rev === 'number' ? mockSaved.rev : 0,
      holderId: mockSaved.holderId || defaultHostId || null,
    };
    codeStateMap.set(normalized, loaded);
    return loaded;
  }

  // 3. Fallback initial default
  const initial: CodeState = {
    content: DEFAULT_INITIAL_CONTENT,
    language: 'python',
    rev: 0,
    holderId: defaultHostId || null,
  };
  codeStateMap.set(normalized, initial);
  return initial;
}

/**
 * Get the current pen holder for a room.
 */
export function getPenHolder(roomId: string, defaultHostId?: string | null): string | null {
  const state = getCodeState(roomId, defaultHostId);
  return state.holderId;
}

/**
 * Set the pen holder for a room.
 */
export function setPenHolder(roomId: string, holderId: string | null): CodeState {
  const normalized = roomId?.trim();
  const existing = getCodeState(normalized);
  const updated: CodeState = {
    ...existing,
    holderId: holderId ? holderId.trim() : null,
  };
  codeStateMap.set(normalized, updated);
  scheduleDebouncedPersist(normalized, 3000);
  return updated;
}

/**
 * Update code content and language for a room.
 * Increments revision number and schedules a debounced 3s persist.
 */
export function updateCodeState(
  roomId: string,
  content: string,
  language?: Language,
  holderId?: string | null
): CodeState {
  const normalized = roomId?.trim();
  const existing = getCodeState(normalized);

  const updated: CodeState = {
    content: typeof content === 'string' ? content : existing.content,
    language: language || existing.language,
    rev: (existing.rev || 0) + 1,
    holderId: holderId !== undefined ? holderId : existing.holderId,
  };

  codeStateMap.set(normalized, updated);
  scheduleDebouncedPersist(normalized, 3000);
  return updated;
}

/**
 * Schedules debounced persistence to Postgres (3 seconds).
 */
export function scheduleDebouncedPersist(roomId: string, delayMs = 3000): void {
  const normalized = roomId?.trim();
  if (!normalized) return;

  const existingTimer = debounceTimers.get(normalized);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    debounceTimers.delete(normalized);
    persistCodeState(normalized).catch((err) => {
      console.warn(`[codeWorkspace] Debounced persist error for room ${normalized}:`, err);
    });
  }, delayMs);

  debounceTimers.set(normalized, timer);
}

/**
 * Persists the current code state for a room to Postgres immediately.
 * Called after 3 s debounce and immediately when the last member leaves.
 */
export async function persistCodeState(roomId: string): Promise<boolean> {
  const normalized = roomId?.trim();
  if (!normalized) return false;

  // Clear any pending debounce timer
  const existingTimer = debounceTimers.get(normalized);
  if (existingTimer) {
    clearTimeout(existingTimer);
    debounceTimers.delete(normalized);
  }

  const state = codeStateMap.get(normalized);
  if (!state) return false;

  // Persist to mock store for test resilience / offline recovery
  mockCodeDb.set(normalized, { ...state });

  // If valid UUID, persist to Postgres via Supabase
  if (UUID_REGEX.test(normalized)) {
    try {
      const { error } = await supabase
        .from('code_state')
        .upsert(
          {
            room_id: normalized,
            language: state.language || 'python',
            content: typeof state.content === 'string' ? state.content : '',
            holder_id: state.holderId || null,
            rev: typeof state.rev === 'number' ? state.rev : 0,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'room_id' }
        );

      if (error) {
        console.warn(`[codeWorkspace] Supabase upsert error for room ${normalized}:`, error.message);
        return false;
      }
      return true;
    } catch (err: any) {
      console.warn(`[codeWorkspace] Exception persisting room ${normalized}:`, err?.message || err);
      return false;
    }
  }

  return true;
}

/**
 * Flush all pending code states across all rooms (e.g. on server SIGTERM/shutdown).
 */
export async function flushAllCodeState(): Promise<void> {
  const promises: Promise<boolean>[] = [];
  for (const roomId of codeStateMap.keys()) {
    promises.push(persistCodeState(roomId));
  }
  await Promise.all(promises);
}

/**
 * Clear in-memory workspaces and timers (for testing).
 */
export function clearCodeWorkspace(): void {
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
  codeStateMap.clear();
}

/**
 * Reset persistent mock DB (for testing).
 */
export function clearMockCodeDb(): void {
  mockCodeDb.clear();
}

/**
 * Seed or inspect persistent mock DB (for testing).
 */
export function setMockCodeDb(roomId: string, state: Partial<CodeState>): void {
  const normalized = roomId?.trim();
  if (!normalized) return;
  const current = mockCodeDb.get(normalized) || {
    content: DEFAULT_INITIAL_CONTENT,
    language: 'python',
    rev: 0,
    holderId: null,
  };
  mockCodeDb.set(normalized, { ...current, ...state });
}

export function getMockCodeDb(roomId: string): CodeState | undefined {
  return mockCodeDb.get(roomId?.trim());
}

/**
 * Set the pen holder for a room (alias for setPenHolder per US-CODE-04 specification).
 */
export const setPen = setPenHolder;

/**
 * Service abstraction for code workspace operations (US-CODE-04, FR-5.4).
 */
export const codeService = {
  getPen: getPenHolder,
  setPen: setPenHolder,
  setPenHolder,
  getPenHolder,
  getCodeState,
  getOrLoadCodeState,
  updateCodeState,
  persistCodeState,
  clearCodeWorkspace,
  flushAllCodeState,
};
