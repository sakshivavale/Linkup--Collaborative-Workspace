import { PresenceEntry } from '@linkup/shared';

export interface PresenceUser {
  userId: string;
  fullName: string;
  inLive: boolean;
  handRaised: boolean;
  micOn?: boolean;
  cameraOn?: boolean;
  isSpeaking?: boolean;
  role?: string;
  socketIds: Set<string>;
}

// Maps roomId -> Map<userId, PresenceUser>
const roomPresenceMap = new Map<string, Map<string, PresenceUser>>();

// Maps socketId -> Map<roomId, userId>
const socketRoomsMap = new Map<string, Map<string, string>>();

/**
 * Returns current presence entries for a room.
 */
export function getRoomPresence(roomId: string): PresenceEntry[] {
  const users = roomPresenceMap.get(roomId);
  if (!users) return [];

  return Array.from(users.values()).map((u) => ({
    userId: u.userId,
    fullName: u.fullName,
    inLive: u.inLive,
    handRaised: u.handRaised,
    micOn: u.micOn ?? false,
    cameraOn: u.cameraOn ?? false,
    isSpeaking: u.isSpeaking ?? false,
    role: u.role,
  }));
}

/**
 * Register a socket as connected to a room channel.
 * Returns the updated PresenceEntry[] for that room.
 */
export function addSocketToRoom(
  roomId: string,
  socketId: string,
  user: { id: string; fullName: string }
): PresenceEntry[] {
  let roomUsers = roomPresenceMap.get(roomId);
  if (!roomUsers) {
    roomUsers = new Map<string, PresenceUser>();
    roomPresenceMap.set(roomId, roomUsers);
  }

  let presenceUser = roomUsers.get(user.id);
  if (!presenceUser) {
    presenceUser = {
      userId: user.id,
      fullName: user.fullName || 'User',
      inLive: false,
      handRaised: false,
      socketIds: new Set<string>(),
    };
    roomUsers.set(user.id, presenceUser);
  }

  presenceUser.socketIds.add(socketId);

  // Track socket -> room & user
  let socketRooms = socketRoomsMap.get(socketId);
  if (!socketRooms) {
    socketRooms = new Map<string, string>();
    socketRoomsMap.set(socketId, socketRooms);
  }
  socketRooms.set(roomId, user.id);

  return getRoomPresence(roomId);
}

/**
 * Remove a socket from a room channel (e.g. on room:leave).
 * Returns the updated PresenceEntry[] for that room.
 */
export function removeSocketFromRoom(roomId: string, socketId: string): PresenceEntry[] {
  const socketRooms = socketRoomsMap.get(socketId);
  if (socketRooms) {
    socketRooms.delete(roomId);
    if (socketRooms.size === 0) {
      socketRoomsMap.delete(socketId);
    }
  }

  const roomUsers = roomPresenceMap.get(roomId);
  if (!roomUsers) return [];

  for (const [userId, user] of roomUsers.entries()) {
    if (user.socketIds.has(socketId)) {
      user.socketIds.delete(socketId);
      if (user.socketIds.size === 0) {
        roomUsers.delete(userId);
      }
      break;
    }
  }

  if (roomUsers.size === 0) {
    roomPresenceMap.delete(roomId);
  }

  return getRoomPresence(roomId);
}

/**
 * Clean up a disconnected socket across all rooms it was subscribed to.
 * Returns an array of { roomId, presence } for each room that was affected.
 */
export function handleSocketDisconnect(
  socketId: string
): Array<{ roomId: string; presence: PresenceEntry[] }> {
  const socketRooms = socketRoomsMap.get(socketId);
  if (!socketRooms || socketRooms.size === 0) {
    socketRoomsMap.delete(socketId);
    return [];
  }

  const affectedRooms: Array<{ roomId: string; presence: PresenceEntry[] }> = [];

  for (const [roomId, userId] of socketRooms.entries()) {
    const roomUsers = roomPresenceMap.get(roomId);
    if (roomUsers) {
      const user = roomUsers.get(userId);
      if (user) {
        user.socketIds.delete(socketId);
        if (user.socketIds.size === 0) {
          roomUsers.delete(userId);
        }
      }
      if (roomUsers.size === 0) {
        roomPresenceMap.delete(roomId);
      }
      affectedRooms.push({
        roomId,
        presence: getRoomPresence(roomId),
      });
    }
  }

  socketRoomsMap.delete(socketId);
  return affectedRooms;
}

/**
 * Update a user's inLive status for a room (e.g. live:joined / live:left).
 * Returns the updated PresenceEntry[] or null if user not present.
 */
export function setUserLiveStatus(
  roomId: string,
  userId: string,
  inLive: boolean,
  initialMediaState?: { micOn?: boolean; cameraOn?: boolean }
): PresenceEntry[] | null {
  const roomUsers = roomPresenceMap.get(roomId);
  if (!roomUsers) return null;

  const user = roomUsers.get(userId);
  if (!user) return null;

  user.inLive = inLive;
  if (inLive) {
    if (typeof initialMediaState?.micOn === 'boolean') {
      user.micOn = initialMediaState.micOn;
    }
    if (typeof initialMediaState?.cameraOn === 'boolean') {
      user.cameraOn = initialMediaState.cameraOn;
    }
  } else {
    user.micOn = false;
    user.cameraOn = false;
    user.isSpeaking = false;
  }
  return getRoomPresence(roomId);
}

/**
 * Update a participant's mic/camera state for a room (live:media-state).
 */
export function setUserMediaState(
  roomId: string,
  userId: string,
  mediaState: { micOn?: boolean; cameraOn?: boolean }
): PresenceEntry[] | null {
  const roomUsers = roomPresenceMap.get(roomId);
  if (!roomUsers) return null;

  const user = roomUsers.get(userId);
  if (!user) return null;

  if (typeof mediaState.micOn === 'boolean') {
    user.micOn = mediaState.micOn;
    // If mic turned off, user cannot be speaking
    if (!mediaState.micOn) {
      user.isSpeaking = false;
    }
  }
  if (typeof mediaState.cameraOn === 'boolean') {
    user.cameraOn = mediaState.cameraOn;
  }

  return getRoomPresence(roomId);
}

/**
 * Update a participant's active speaking status for a room (live:speaking).
 */
export function setUserSpeakingStatus(
  roomId: string,
  userId: string,
  isSpeaking: boolean
): PresenceEntry[] | null {
  const roomUsers = roomPresenceMap.get(roomId);
  if (!roomUsers) return null;

  const user = roomUsers.get(userId);
  if (!user) return null;

  // Participant can only be speaking if mic is enabled
  user.isSpeaking = isSpeaking && (user.micOn ?? true);
  return getRoomPresence(roomId);
}

/**
 * Update a user's handRaised status for a room (hand:raise).
 */
export function setUserHandStatus(
  roomId: string,
  userId: string,
  handRaised: boolean
): PresenceEntry[] | null {
  const roomUsers = roomPresenceMap.get(roomId);
  if (!roomUsers) return null;

  const user = roomUsers.get(userId);
  if (!user) return null;

  user.handRaised = handRaised;
  return getRoomPresence(roomId);
}

/**
 * Inject mock presence for a room (useful for testing and demo environments).
 */
export function setMockPresence(roomId: string, presence: PresenceEntry[]): void {
  const map = new Map<string, PresenceUser>();
  for (const p of presence) {
    map.set(p.userId, {
      userId: p.userId,
      fullName: p.fullName,
      inLive: p.inLive,
      handRaised: p.handRaised,
      micOn: p.micOn ?? false,
      cameraOn: p.cameraOn ?? false,
      isSpeaking: p.isSpeaking ?? false,
      role: p.role,
      socketIds: new Set(['mock-socket-' + p.userId]),
    });
  }
  roomPresenceMap.set(roomId, map);
}

/**
 * Clear presence store (for tests).
 */
export function clearPresence(roomId?: string): void {
  if (roomId) {
    roomPresenceMap.delete(roomId);
    for (const [sId, rooms] of socketRoomsMap.entries()) {
      rooms.delete(roomId);
      if (rooms.size === 0) socketRoomsMap.delete(sId);
    }
  } else {
    roomPresenceMap.clear();
    socketRoomsMap.clear();
  }
}
