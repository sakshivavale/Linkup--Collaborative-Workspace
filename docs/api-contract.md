# API & Real-time Contract — LinkUp MVP

This is the contract between `client/` and `server/`. Every type here lives in `shared/src` and is imported by both sides. Change this doc and the shared types together in the same PR.

---

## 1. Conventions

- Base URL: `${VITE_API_URL}/api`
- Auth header: `Authorization: Bearer <supabase access_token>` on every route except `/health`
- JSON in and out. Field names use `camelCase` in the API. The DB uses `snake_case`, and the server maps between them.
- Error shape (all non-2xx):

```json
{ "error": { "code": "HOST_ONLY", "message": "Only the room host can do this." } }
```

| HTTP | `code` values |
|------|---------------|
| 400 | `VALIDATION` (with `details` from zod) |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN`, `NOT_A_MEMBER`, `HOST_ONLY`, `TEACHER_ONLY`, `NOT_PEN_HOLDER` |
| 404 | `NOT_FOUND`, `ROOM_NOT_FOUND` |
| 409 | `SESSION_ACTIVE`, `NO_ACTIVE_SESSION` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 429 | `RATE_LIMITED` |
| 502 | `EXECUTION_UNAVAILABLE` (Piston down) |

Guard legend: 🔓 auth only · 👤 room member · 👑 room host · 🎓 teacher role

## 2. Shared types (`shared/src/dto.ts`)

```ts
export type UserRole = 'teacher' | 'student';
export type MemberRole = 'host' | 'participant';
export const PERMISSION_KEYS = ['canMic', 'canCamera', 'canScreen', 'canWhiteboard', 'canCode'] as const;
export type PermissionKey = typeof PERMISSION_KEYS[number];
export type Permissions = Record<PermissionKey, boolean>;
export type Language = 'python' | 'javascript' | 'cpp' | 'java';

export interface Me { id: string; fullName: string; role: UserRole; email: string }

export interface RoomSummary {
  id: string; name: string; description: string | null;
  joinCode: string | null;            // only for host
  hostName: string; memberCount: number; myRole: MemberRole;
  activeSessionId: string | null; createdAt: string;
}
export interface Room extends RoomSummary { defaultPermissions: Permissions; ownerId: string }

export interface Member {
  userId: string; fullName: string; userRole: UserRole;
  memberRole: MemberRole; permissions: Permissions; joinedAt: string;
}
export interface Session { id: string; roomId: string; startedAt: string; endedAt: string | null; startedBy: string }
export interface ChatMessage {
  id: number; roomId: string; senderId: string; senderName: string;
  senderRole: UserRole; body: string; createdAt: string;
}
export interface CodeState { content: string; language: Language; rev: number; holderId: string | null }
export interface RunResult {
  by: string; language: Language; stdout: string; stderr: string;
  exitCode: number | null; timeMs: number; timedOut: boolean; truncated: boolean;
}
export interface PresenceEntry { userId: string; fullName: string; inLive: boolean; handRaised: boolean }
export interface AttendanceRow {
  userId: string; fullName: string; firstJoin: string; lastLeave: string; minutes: number; joins: number;
}
```

## 3. REST endpoints

### 3.1 Health & profile

| Method | Path | Guard | Body | 200 Response | Pri |
|--------|------|-------|------|--------------|-----|
| GET | `/health` | — | — | `{ ok: true }` | P0 |
| GET | `/me` | 🔓 | — | `Me` | P0 |
| PATCH | `/me` | 🔓 | `{ fullName }` | `Me` | P1 |

### 3.2 Rooms

| Method | Path | Guard | Body | 200 Response | Pri |
|--------|------|-------|------|--------------|-----|
| GET | `/rooms` | 🔓 | — | `RoomSummary[]` | P0 |
| POST | `/rooms` | 🎓 | `{ name, description?, defaultPermissions }` | `Room` (201) | P0 |
| POST | `/rooms/join` | 🔓 | `{ code }` (6 chars, case-insensitive) | `{ roomId }` | P0 |
| GET | `/rooms/:roomId` | 👤 | — | `Room` | P0 |
| PATCH | `/rooms/:roomId` | 👑 | `{ name?, description?, defaultPermissions? }` | `Room` | P1 |
| POST | `/rooms/:roomId/join-code` | 👑 | — | `{ joinCode }` (regenerated) | P1 |

**Side effects:** `POST /rooms/join` emits `member:joined` to `room:<id>`, but only when the user is new to the room.

### 3.3 Members & permissions

| Method | Path | Guard | Body | 200 Response | Pri |
|--------|------|-------|------|--------------|-----|
| GET | `/rooms/:roomId/members` | 👤 | — | `Member[]` | P0 |
| PATCH | `/rooms/:roomId/members/:userId/permissions` | 👑 | `Partial<Permissions>` (≥1 key) | `Member` | P0 |
| POST | `/rooms/:roomId/permissions/bulk` | 👑 | `Partial<Permissions>` | `Member[]` (all participants) | P1 |
| DELETE | `/rooms/:roomId/members/:userId` | 👑 | — | `{ ok: true }` | P0 |

**Rules**
- Targeting the host returns `403 FORBIDDEN`, because host permissions are fixed.
- PATCH and bulk both go through `permissionService.update()`. That one function updates the DB, calls LiveKit `updateParticipant` if the user is live, reassigns the pen if `canCode` was revoked from the holder, and then emits `perm:changed`.
- DELETE removes the member row, calls LiveKit `removeParticipant` if they are live, closes their attendance, emits `room:kicked` to the user's sockets, makes those sockets leave the room, and emits `member:removed` to the room.

### 3.4 Sessions & media

| Method | Path | Guard | Body | 200 Response | Pri |
|--------|------|-------|------|--------------|-----|
| GET | `/rooms/:roomId/sessions` | 👑 | — | `Session[]` (newest first) | P0 |
| POST | `/rooms/:roomId/sessions` | 👑 | — | `Session` (201); `409 SESSION_ACTIVE` if one is open | P0 |
| POST | `/rooms/:roomId/sessions/:sessionId/end` | 👑 | — | `Session` | P0 |
| POST | `/rooms/:roomId/livekit-token` | 👤 | — | `{ token, url, sessionId }`; `409 NO_ACTIVE_SESSION` | P0 |

**Side effects:**
- Start emits `session:started`.
- End sets `ended_at`, calls `close_session_attendance`, calls LiveKit `deleteRoom` and emits `session:ended`. Chat messages sent while a session is active get that `session_id` attached.

### 3.5 Chat history

| Method | Path | Guard | Query | 200 Response | Pri |
|--------|------|-------|-------|--------------|-----|
| GET | `/rooms/:roomId/messages` | 👤 | `before?` (ISO), `limit?` (≤100, default 50) | `{ messages: ChatMessage[] /* oldest→newest */, hasMore }` | P0 |

### 3.6 Attendance

| Method | Path | Guard | 200 Response | Pri |
|--------|------|-------|--------------|-----|
| GET | `/rooms/:roomId/sessions/:sessionId/attendance` | 👑 | `AttendanceRow[]` | P0 |
| GET | `/rooms/:roomId/sessions/:sessionId/attendance.csv` | 👑 | `text/csv` | P1 |

### 3.7 Code execution

| Method | Path | Guard | Body | 200 Response | Pri |
|--------|------|-------|------|--------------|-----|
| GET | `/runtimes` | 🔓 | — | `{ language: Language, version: string }[]` | P0 |
| POST | `/execute` | 🔓 (+ pen holder or host if `roomId`) | `{ language, code, stdin?, roomId? }` | `RunResult` | P0 |

- `code` must be ≤ 64 KB (`413` otherwise) and `stdin` ≤ 8 KB.
- Rate limit is 10 requests/min/user (`429`).
- When `roomId` is set, the server also emits `code:run-started` and `code:run-result` to the room.
- `stdout` and `stderr` are each truncated to 64 KB, with `truncated: true` set when that happens.

## 4. Socket.IO

### 4.1 Connection

```ts
// client/src/lib/socket.ts
export const socket = io(import.meta.env.VITE_API_URL, {
  autoConnect: false,
  auth: async (cb) => cb({ token: (await supabase.auth.getSession()).data.session?.access_token }),
});
```

The server middleware verifies the token and sets `socket.data.user = { id, fullName, role }`. If the token is invalid, it rejects with `connect_error` and message `UNAUTHENTICATED`.

**Every** handler re-validates the payload with zod and re-checks membership and permission from the cache or DB. Failures emit `error` to the sender only.

### 4.2 Client → Server

| Event | Payload | Ack | Who | Pri |
|-------|---------|-----|-----|-----|
| `room:join` | `{ roomId }` | `{ ok, snapshot?: RoomSnapshot, error? }` | 👤 | P0 |
| `room:leave` | `{ roomId }` | — | 👤 | P0 |
| `live:joined` | `{ roomId }` | `{ ok }` | 👤, with an active session | P0 |
| `live:left` | `{ roomId }` | — | 👤 | P0 |
| `chat:send` | `{ roomId, body, clientId }` | `{ ok, message?: ChatMessage, error? }` | 👤 | P0 |
| `code:update` | `{ roomId, content, language }` | `{ ok, rev?, error? }` | pen holder | P0 |
| `code:pen` | `{ roomId, holderId }` | `{ ok, error? }` | 👑 (target must have `canCode` or be host) | P0 |
| `code:request-pen` | `{ roomId }` | — | 👤 with `canCode` | P1 |
| `wb:update` | `{ roomId, elements: ExcalidrawElement[] }` | — | 👑 or `canWhiteboard` | P0 |
| `wb:clear` | `{ roomId }` | — | 👑 | P1 |
| `hand:raise` | `{ roomId, raised: boolean }` | — | 👤 | P1 |

```ts
export interface RoomSnapshot {
  room: Room;
  me: Member;
  members: Member[];
  presence: PresenceEntry[];
  session: Session | null;
  code: CodeState;
  board: { elements: unknown[] };
}
```

### 4.3 Server → Client

| Event | Payload | Sent to | Pri |
|-------|---------|---------|-----|
| `presence:update` | `{ roomId, presence: PresenceEntry[] }` | room | P0 |
| `member:joined` | `{ roomId, member: Member }` | room | P0 |
| `member:removed` | `{ roomId, userId }` | room | P0 |
| `room:kicked` | `{ roomId }` | the removed user's sockets | P0 |
| `perm:changed` | `{ roomId, userId, permissions: Permissions, by: string }` | room | P0 |
| `session:started` | `{ roomId, session: Session }` | room | P0 |
| `session:ended` | `{ roomId, sessionId }` | room | P0 |
| `chat:new` | `{ roomId, message: ChatMessage, clientId }` | room (the sender also receives it and deduplicates its optimistic copy by `clientId`) | P0 |
| `code:state` | `{ roomId, ...CodeState }` | room except sender | P0 |
| `code:pen` | `{ roomId, holderId, by }` | room | P0 |
| `code:pen-requested` | `{ roomId, userId }` | host sockets | P1 |
| `code:run-started` | `{ roomId, by, language }` | room | P0 |
| `code:run-result` | `{ roomId, result: RunResult }` | room | P0 |
| `wb:update` | `{ roomId, elements }` | room except sender | P0 |
| `wb:cleared` | `{ roomId }` | room | P1 |
| `hand:changed` | `{ roomId, userId, raised }` | room | P1 |
| `error` | `{ event, code, message }` | sender | P0 |

### 4.4 Typed events (`shared/src/events.ts`)

```ts
export interface ClientToServerEvents {
  'room:join': (p: { roomId: string }, ack: (r: Ack<RoomSnapshot>) => void) => void;
  'room:leave': (p: { roomId: string }) => void;
  'live:joined': (p: { roomId: string }, ack: (r: Ack) => void) => void;
  'live:left': (p: { roomId: string }) => void;
  'chat:send': (p: { roomId: string; body: string; clientId: string }, ack: (r: Ack<ChatMessage>) => void) => void;
  'code:update': (p: { roomId: string; content: string; language: Language }, ack: (r: Ack<{ rev: number }>) => void) => void;
  'code:pen': (p: { roomId: string; holderId: string }, ack: (r: Ack) => void) => void;
  'code:request-pen': (p: { roomId: string }) => void;
  'wb:update': (p: { roomId: string; elements: unknown[] }) => void;
  'wb:clear': (p: { roomId: string }) => void;
  'hand:raise': (p: { roomId: string; raised: boolean }) => void;
}
export interface ServerToClientEvents { /* mirror §4.3 */ }
export type Ack<T = undefined> = { ok: true; data?: T } | { ok: false; error: { code: string; message: string } };
```

## 5. Client reaction to `perm:changed` (reference)

```ts
socket.on('perm:changed', async ({ userId, permissions, by }) => {
  roomStore.getState().setPermissions(userId, permissions);
  if (userId !== me.id) return;
  const lp = livekitRoom?.localParticipant;
  if (lp) {
    if (!permissions.canMic && lp.isMicrophoneEnabled) await lp.setMicrophoneEnabled(false);
    if (!permissions.canCamera && lp.isCameraEnabled) await lp.setCameraEnabled(false);
    if (!permissions.canScreen && lp.isScreenShareEnabled) await lp.setScreenShareEnabled(false);
  }
  toast(describeChange(prevPermissions, permissions));   // "Teacher turned off your microphone"
});
```

This is UX only. The server-side LiveKit `updateParticipant` call is the real enforcement.
