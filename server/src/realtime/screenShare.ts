import { ActiveScreenShare } from '@linkup/shared';

// In-memory map: roomId -> ActiveScreenShare
const roomScreenShareMap = new Map<string, ActiveScreenShare>();

/**
 * Get active screen share for a room.
 */
export function getActiveScreenShare(roomId: string): ActiveScreenShare | null {
  const normalized = roomId?.trim();
  if (!normalized) return null;
  return roomScreenShareMap.get(normalized) || null;
}

/**
 * Start a screen share in a room.
 * Enforces US-LIVE-04 Acceptance Criteria 3:
 * "Only one screen share is active at a time."
 */
export function startScreenShare(
  roomId: string,
  userId: string,
  userName: string
): { success: boolean; error?: string; screenShare?: ActiveScreenShare } {
  const normalizedRoomId = roomId?.trim();
  const normalizedUserId = userId?.trim();

  if (!normalizedRoomId || !normalizedUserId) {
    return { success: false, error: 'VALIDATION' };
  }

  const existing = roomScreenShareMap.get(normalizedRoomId);
  if (existing) {
    // If the same user restarts, update; if another user, reject
    if (existing.userId !== normalizedUserId) {
      return {
        success: false,
        error: 'SCREEN_SHARE_ACTIVE',
      };
    }
  }

  const screenShare: ActiveScreenShare = {
    roomId: normalizedRoomId,
    userId: normalizedUserId,
    userName: userName?.trim() || 'Participant',
    startedAt: new Date().toISOString(),
  };

  roomScreenShareMap.set(normalizedRoomId, screenShare);
  return { success: true, screenShare };
}

/**
 * Stop active screen share in a room.
 * Returns the stopped screen share object if one was active.
 */
export function stopScreenShare(
  roomId: string,
  userId?: string
): ActiveScreenShare | null {
  const normalizedRoomId = roomId?.trim();
  if (!normalizedRoomId) return null;

  const existing = roomScreenShareMap.get(normalizedRoomId);
  if (!existing) return null;

  // If userId specified, only allow if matching or host/system stop
  if (userId && existing.userId !== userId.trim()) {
    return null;
  }

  roomScreenShareMap.delete(normalizedRoomId);
  return existing;
}

/**
 * Force stop active screen share for a room (e.g., when permission revoked or session ended)
 */
export function forceStopScreenShare(roomId: string): ActiveScreenShare | null {
  const normalizedRoomId = roomId?.trim();
  if (!normalizedRoomId) return null;

  const existing = roomScreenShareMap.get(normalizedRoomId);
  if (!existing) return null;

  roomScreenShareMap.delete(normalizedRoomId);
  return existing;
}

/**
 * Cleanup any screen shares owned by a user when they disconnect.
 */
export function handleUserDisconnectScreenShare(
  userId: string
): Array<{ roomId: string; stopped: ActiveScreenShare }> {
  const normalizedUserId = userId?.trim();
  if (!normalizedUserId) return [];

  const affected: Array<{ roomId: string; stopped: ActiveScreenShare }> = [];

  for (const [roomId, share] of roomScreenShareMap.entries()) {
    if (share.userId === normalizedUserId) {
      roomScreenShareMap.delete(roomId);
      affected.push({ roomId, stopped: share });
    }
  }

  return affected;
}

/**
 * Clear active screen share for a room or all rooms (for testing cleanup)
 */
export function clearActiveScreenShare(roomId?: string): void {
  if (roomId) {
    const normalized = roomId.trim();
    if (normalized) roomScreenShareMap.delete(normalized);
  } else {
    roomScreenShareMap.clear();
  }
}

/**
 * Clear all screen shares (for testing)
 */
export function clearAllScreenShares(): void {
  roomScreenShareMap.clear();
}
