export type UserRole = 'teacher' | 'student';
export type MemberRole = 'host' | 'participant';

export const PERMISSION_KEYS = [
  'canMic',
  'canCamera',
  'canScreen',
  'canWhiteboard',
  'canCode',
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];
export type Permissions = Record<PermissionKey, boolean>;
export type Language = 'python' | 'javascript' | 'cpp' | 'java';

export interface Me {
  id: string;
  fullName: string;
  role: UserRole;
  email: string;
}

export interface UpdateProfileDto {
  fullName: string;
}

export interface JoinRoomDto {
  code: string;
}

export interface JoinRoomResponse {
  roomId: string;
}

/** US-ROOM-04: response after regenerating room join code */
export interface RegenerateJoinCodeResponse {
  joinCode: string;
}

/** US-DASH-03: payload sent by teacher to create a new room */
export interface CreateRoomDto {
  name: string;
  description?: string | null;
  defaultPermissions?: Partial<Permissions>;
}

/** US-ROOM-05: payload sent by host to edit room name/description or archive */
export interface UpdateRoomDto {
  name?: string;
  description?: string | null;
  archived?: boolean;
}

/** US-DASH-03: response after room creation — RoomSummary with join code always present */
export interface CreateRoomResponseDto extends RoomSummary {
  joinCode: string; // always non-null for creator
}

export interface RoomSummary {
  id: string;
  name: string;
  description: string | null;
  joinCode: string | null;
  hostName: string;
  memberCount: number;
  myRole: MemberRole;
  activeSessionId: string | null;
  createdAt: string;
  members?: Member[];
  presence?: PresenceEntry[];
  activeScreenShare?: ActiveScreenShare | null;
}

export interface Room extends RoomSummary {
  defaultPermissions: Permissions;
  ownerId: string;
}

export interface Member {
  userId: string;
  fullName: string;
  userRole: UserRole;
  memberRole: MemberRole;
  permissions: Permissions;
  joinedAt: string;
}

/** US-ROOM-02: Real-time room presence tracking */
export interface PresenceEntry {
  userId: string;
  fullName: string;
  inLive: boolean;
  handRaised: boolean;
}

export interface GridParticipant {
  id: string;
  name: string;
  isMuted: boolean;
  cameraOff: boolean;
  isSpeaking: boolean;
  handRaised?: boolean;
  stream?: unknown | null;
}

export function buildParticipantTiles(
  presence: PresenceEntry[] | undefined,
  activeSpeakerUserId: string | null = null
): GridParticipant[] {
  return (presence ?? [])
    .filter((entry) => entry.inLive)
    .map((entry) => ({
      id: entry.userId,
      name: entry.fullName,
      isMuted: true,
      cameraOff: true,
      isSpeaking: activeSpeakerUserId !== null && entry.userId === activeSpeakerUserId,
      handRaised: Boolean(entry.handRaised),
      stream: null,
    }));
}

export interface PresenceUpdatePayload {
  roomId: string;
  presence: PresenceEntry[];
}

export interface Session {
  id: string;
  roomId: string;
  startedAt: string;
  endedAt: string | null;
  startedBy: string;
  livekit_room?: string;
  livekitRoom?: string;
}

export interface SessionStartedPayload {
  roomId: string;
  session: Session;
}

export interface SessionEndedPayload {
  roomId: string;
  sessionId: string;
}

export interface ChatMessage {
  id: number;
  roomId: string;
  senderId: string;
  senderName: string;
  senderRole: UserRole;
  body: string;
  createdAt: string;
  clientId?: string;
  status?: 'sending' | 'confirmed' | 'failed';
}

export interface ChatHistoryResponse {
  messages: ChatMessage[];
  hasMore: boolean;
}

export interface ActiveScreenShare {
  roomId: string;
  userId: string;
  userName: string;
  startedAt: string;
}

export interface ScreenStartedPayload {
  roomId: string;
  userId: string;
  userName: string;
}

export interface ScreenStoppedPayload {
  roomId: string;
  userId?: string;
  reason?: 'USER_STOPPED' | 'PERMISSION_REVOKED' | 'DISCONNECTED';
}

export interface UpdatePermissionsDto {
  canMic?: boolean;
  canCamera?: boolean;
  canScreen?: boolean;
  canWhiteboard?: boolean;
  canCode?: boolean;
}

export interface PermChangedPayload {
  roomId: string;
  userId: string;
  permissions: Permissions;
  by: string;
  reason?: 'MUTE_ALL' | string;
  isBulk?: boolean;
}

export interface CodeState {
  content: string;
  language: Language;
  rev: number;
  holderId: string | null;
}

export const MAX_CODE_BYTES = 64 * 1024; // 64 KB = 65,536 bytes (US-CODE-03, FR-5.2)
export const CODE_DEBOUNCE_MS = 150; // 150 ms debounce for keystroke emissions (US-CODE-03, FR-5.2)
export const WB_THROTTLE_MS = 100; // 100 ms throttle for whiteboard emissions (US-WB-02, FR-5.11)
export const WB_PERSIST_DEBOUNCE_MS = 5000; // 5 s debounced persistence to Postgres (US-WB-03, FR-5.13)

export interface WhiteboardState {
  elements: unknown[];
}

/** US-CODE-05: Code execution result */
export interface RunResult {
  by: string;
  language: Language;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timeMs: number;
  timedOut: boolean;
  truncated: boolean;
}

/** US-CODE-05: Payload for POST /execute */
export interface ExecuteCodeDto {
  language: Language;
  code: string;
  stdin?: string;
  roomId?: string;
}

/** US-CODE-05: Payload for code:run-started event */
export interface CodeRunStartedPayload {
  roomId: string;
  by: string;
  language: Language;
}

/** US-CODE-05: Payload for code:run-result event */
export interface CodeRunResultPayload {
  roomId: string;
  result: RunResult;
}

/** US-CODE-08: Payload for code:request-pen event (FR-5.9) */
export interface CodeRequestPenPayload {
  roomId: string;
}

/** US-CODE-08: Payload for code:pen-requested event sent to host sockets (FR-5.9) */
export interface CodePenRequestedPayload {
  roomId: string;
  userId: string;
  userName?: string;
}

export interface ApiError {
  code:
    | 'VALIDATION'
    | 'UNAUTHENTICATED'
    | 'FORBIDDEN'
    | 'NOT_A_MEMBER'
    | 'HOST_ONLY'
    | 'ALREADY_PEN_HOLDER'
    | 'TEACHER_ONLY'
    | 'NOT_PEN_HOLDER'
    | 'NOT_FOUND'
    | 'ROOM_NOT_FOUND'
    | 'SESSION_ACTIVE'
    | 'NO_ACTIVE_SESSION'
    | 'SCREEN_SHARE_ACTIVE'
    | 'PAYLOAD_TOO_LARGE'
    | 'RATE_LIMITED'
    | 'EXECUTION_UNAVAILABLE'
    | string;
  message?: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  error: ApiError;
}

/** US-LIVE-07 & FR-3.8: Full room state snapshot returned on room:join */
export interface RoomSnapshot {
  roomId: string;
  room?: RoomSummary | null;
  me?: Member | null;
  members?: Member[];
  presence?: PresenceEntry[];
  session?: Session | null;
  screenShare?: ActiveScreenShare | null;
  code?: CodeState;
  board?: { elements: unknown[] };
}

/**
 * US-PERM-03 & US-PERM-06: Descriptive user notification toast message for permission change (FR-4.4, FR-4.7)
 * When reason is MUTE_ALL and canMic revoked, returns "Teacher muted everyone."
 */
export function getPermissionChangeMessage(key: PermissionKey, granted: boolean, reason?: string): string {
  if (granted) {
    switch (key) {
      case 'canMic':
        return 'You can now use your microphone.';
      case 'canCamera':
        return 'You can now use your camera.';
      case 'canScreen':
        return 'You can now share your screen.';
      case 'canWhiteboard':
        return 'You can now edit the whiteboard.';
      case 'canCode':
        return 'You can now edit code.';
    }
  } else {
    if ((reason === 'MUTE_ALL' || reason === 'mute_all') && key === 'canMic') {
      return 'Teacher muted everyone.';
    }
    switch (key) {
      case 'canMic':
        return 'Teacher turned off your microphone.';
      case 'canCamera':
        return 'Teacher turned off your camera.';
      case 'canScreen':
        return 'Teacher turned off your screen sharing.';
      case 'canWhiteboard':
        return 'Teacher turned off your whiteboard access.';
      case 'canCode':
        return 'Teacher turned off your code editor access.';
    }
  }
}

export interface PermissionDiff {
  key: PermissionKey;
  granted: boolean;
  message: string;
}

/**
 * US-PERM-03 & US-PERM-06: Computes diff between previous permissions and new permissions
 */
export function diffPermissions(
  prev: Partial<Permissions> | null | undefined,
  next: Permissions,
  reason?: string
): PermissionDiff[] {
  if (!prev) return [];
  const diffs: PermissionDiff[] = [];
  for (const key of PERMISSION_KEYS) {
    const prevVal = Boolean(prev[key]);
    const nextVal = Boolean(next[key]);
    if (prevVal !== nextVal) {
      diffs.push({
        key,
        granted: nextVal,
        message: getPermissionChangeMessage(key, nextVal, reason),
      });
    }
  }
  return diffs;
}

/**
 * US-PERM-07: Hand raise payload emitted by participant (FR-4.8)
 */
export interface HandRaisePayload {
  roomId?: string;
  raised: boolean;
  userId?: string;
  asHost?: boolean;
}

/**
 * US-PERM-07: Hand changed payload broadcast to all room members (FR-4.8)
 */
export interface HandChangedPayload {
  roomId: string;
  userId: string;
  raised: boolean;
}
