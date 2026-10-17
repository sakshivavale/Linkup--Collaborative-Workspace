import { CodeState, Language, MAX_CODE_BYTES } from '@linkup/shared';

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

// In-memory state: roomId -> CodeState
const codeStateMap = new Map<string, CodeState>();

/**
 * Get code state for a room.
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

  const initial: CodeState = {
    content: '# Shared Python Code Workspace\nprint("Hello, Linkup!")\n',
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
  return updated;
}

/**
 * Update code content and language for a room.
 * Increments revision number.
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
  return updated;
}

/**
 * Clear all code workspaces (for testing)
 */
export function clearCodeWorkspace(): void {
  codeStateMap.clear();
}
