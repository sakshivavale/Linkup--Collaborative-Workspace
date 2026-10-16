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
}

export interface CodeState {
  content: string;
  language: Language;
  rev: number;
  holderId: string | null;
}

export interface ApiError {
  code:
    | 'VALIDATION'
    | 'UNAUTHENTICATED'
    | 'FORBIDDEN'
    | 'NOT_A_MEMBER'
    | 'HOST_ONLY'
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
