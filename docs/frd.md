# Functional Requirements Document (FRD) — LinkUp MVP

| Field | Value |
|-------|-------|
| Product | LinkUp — Collaborative Digital Platform for Connected Learning |
| Version | 1.0 (MVP) |
| Based on | LinkUp Phase 1 Report v1.0 (Oct 2026) |
| Scope | 10-day MVP — see [scope-and-decisions.md](./scope-and-decisions.md) |
| Priority | P0 = must, P1 = should, P2 = later |

---

## 1. Purpose

Define **what** the LinkUp MVP must do, in testable terms. **How** it is built lives in [architecture.md](./architecture.md); the exact request/response shapes live in [api-contract.md](./api-contract.md).

## 2. Actors & roles

| Actor | Global role (`profiles.role`) | Room role (`room_members.member_role`) | Description |
|-------|------------------------------|----------------------------------------|-------------|
| Teacher | `teacher` | `host` (in rooms they create) | Creates rooms, runs sessions, controls permissions |
| Student | `student` | `participant` | Joins rooms via code, participates within granted permissions |
| System | — | — | Backend, LiveKit, Piston |

**Rules**
- BR-1: Only `teacher` users can create rooms.
- BR-2: The room creator is the room's only `host` in the MVP.
- BR-3: A `host` always has every permission; host permissions cannot be changed.
- BR-4: A `teacher` who joins another teacher's room via code joins as `participant`.

## 3. Permission model (core)

Five per-member permission flags, stored per user per room:

| Flag | Controls | When `false` |
|------|----------|--------------|
| `can_mic` | Publishing microphone audio | Mic button disabled; server revokes mic publish right; any live mic track is stopped |
| `can_camera` | Publishing camera video | Same as above for camera |
| `can_screen` | Publishing a screen share | Share button disabled; server revokes screen publish right; active share stops |
| `can_whiteboard` | Editing the whiteboard | Whiteboard in view-only mode; server drops edit events |
| `can_code` | Eligible to hold the code editor "pen" | Cannot receive the pen; if currently holding it, pen returns to host |

**Everyone in the room can always:** see/hear published media, read chat, send chat (P0 — chat mute is P2), view whiteboard, view code and its output.

**Defaults:** each room has `default_permissions` (set at creation, all `false` unless the teacher toggles). New members copy the defaults. Changing room defaults does not alter existing members (P1: "apply to all" button).

**Enforcement requirement (BR-5):** every permission must be enforced **on the server**. Hiding a button is UX only; a modified client must still be blocked (LiveKit rejects the publish, API returns 403, socket event is dropped with an `error` event).

## 4. Functional requirements

### 4.1 Authentication & profile (FR-1)

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-1.1 | User can sign up with full name, email, password (min 8 chars) and role (Teacher/Student). | P0 |
| FR-1.2 | User can log in with email + password and stays logged in across reloads. | P0 |
| FR-1.3 | User can log out from any page. | P0 |
| FR-1.4 | Unauthenticated users are redirected to `/login` for any protected route. | P0 |
| FR-1.5 | Every API request and socket connection is authenticated with the Supabase access token; invalid/expired → 401 / socket rejected. | P0 |
| FR-1.6 | User can edit their full name. | P1 |
| FR-1.7 | Password reset by email. | P1 (Supabase built-in) |

**Acceptance criteria**
- AC-1.a: Signing up creates a `profiles` row with the chosen role and name.
- AC-1.b: Calling any `/api/*` endpoint without a token returns `401`.
- AC-1.c: After login, refreshing the page keeps the user on the dashboard.

### 4.2 Dashboard (FR-8)

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-8.1 | Dashboard lists the rooms the user belongs to (name, host name, member count, my role). | P0 |
| FR-8.2 | A room with an active session shows a **"Live"** badge and a **Join** button. | P0 |
| FR-8.3 | Teachers see a **Create room** button; students see a **Join with code** input. Teachers see both. | P0 |
| FR-8.4 | Hosts see each room's join code with a copy button. | P0 |
| FR-8.5 | Empty state explains the next action ("Create your first room" / "Ask your teacher for a code"). | P0 |

### 4.3 Rooms (FR-2)

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-2.1 | Teacher creates a room with name (required, ≤ 80 chars), description (optional, ≤ 500) and default permissions (5 toggles). | P0 |
| FR-2.2 | System generates a unique 6-character join code (A–Z, 2–9, no ambiguous chars like O/0/I/1). | P0 |
| FR-2.3 | User joins a room by entering the code; joining twice is idempotent. Invalid code → "Room not found". | P0 |
| FR-2.4 | Room page shows members with role, online status and (for host) permission toggles. | P0 |
| FR-2.5 | Host can remove a participant; removed user is disconnected from live session and socket room immediately and loses access. | P0 |
| FR-2.6 | Host can regenerate the join code. | P1 |
| FR-2.7 | Host can edit room name/description; archive room. | P1 |
| FR-2.8 | Non-members get 403 on any room API / socket join. | P0 |

### 4.4 Live session (FR-3)

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-3.1 | Host can **Start session**; only one active session per room. | P0 |
| FR-3.2 | Members can **Join live** only while a session is active; otherwise they see "Waiting for host to start". | P0 |
| FR-3.3 | On joining live, the user gets a device preview, then enters the call with mic/camera **off** by default. | P0 |
| FR-3.4 | Video grid shows all participants with name labels, mute indicators and active-speaker highlight. | P0 |
| FR-3.5 | Users with `can_screen` can share a screen/window/tab; share appears as the focused tile for everyone. | P0 |
| FR-3.6 | Host can **End session**: everyone is disconnected from media, attendance records close, session `ended_at` is set. | P0 |
| FR-3.7 | If the host leaves without ending, the session stays active (host can rejoin). | P0 |
| FR-3.8 | Network drop: client auto-reconnects (LiveKit + Socket.IO); UI shows a "Reconnecting…" banner. | P0 |
| FR-3.9 | Participant can switch mic/camera devices. | P1 (prebuilt in LiveKit components) |

### 4.5 Chat (FR-3 / FR-7)

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-3.10 | Any room member can send text messages (1–2000 chars) in the room chat, during or outside a live session. | P0 |
| FR-3.11 | Messages appear for all online members in < 500 ms (same region). | P0 |
| FR-3.12 | Messages are stored; opening a room loads the last 50; scrolling up loads older (cursor pagination). | P0 |
| FR-3.13 | Each message shows sender name, role badge (Teacher) and time. | P0 |
| FR-3.14 | Message text is rendered as plain text (no HTML injection). Links auto-linked. | P0 |

### 4.6 Permission control (FR-4)

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-4.1 | Host sees a Participants panel with 5 toggles per participant. | P0 |
| FR-4.2 | Toggling a permission updates the DB, updates LiveKit publish rights (for mic/camera/screen) and notifies the room — target user's UI updates in < 1 s. | P0 |
| FR-4.3 | Revoking mic/camera/screen while it is live stops that track for everyone. | P0 |
| FR-4.4 | Target user sees a toast: "Teacher turned off your microphone" / "You can now edit the whiteboard". | P0 |
| FR-4.5 | Permissions persist: leaving and rejoining keeps the same permissions. | P0 |
| FR-4.6 | Server rejects unauthorised actions regardless of client UI (see BR-5). | P0 |
| FR-4.7 | Host can **Mute all** (sets `can_mic=false` for all participants). | P1 |
| FR-4.8 | Participant can **Raise hand**; host sees a hand icon and can grant mic in one click; hand lowers on grant or manual lower. | P1 |

**Acceptance criteria**
- AC-4.a: Student A publishing audio; host toggles `can_mic` off → A's audio stops for all within 1 s and A's mic button is disabled.
- AC-4.b: Using the browser console, A attempts to publish the mic again → LiveKit rejects it (permission denied) and nothing is heard.
- AC-4.c: A without `can_whiteboard` emits a whiteboard update via a crafted socket call → server emits `error {code: "FORBIDDEN"}` and other clients do not change.

### 4.7 Code workspace (FR-5)

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-5.1 | Room has one shared Monaco editor visible to all members, with language selector (Python, JavaScript, C++, Java). | P0 |
| FR-5.2 | Exactly one user holds the **pen** (edit rights). Default holder: host. Everyone else is read-only and sees changes live (< 300 ms after debounce). | P0 |
| FR-5.3 | Host can give the pen to any participant with `can_code`, or take it back. The editor header shows "✏️ Priya is editing". | P0 |
| FR-5.4 | Revoking `can_code` from the current holder returns the pen to the host. | P0 |
| FR-5.5 | The pen holder (or host) can click **Run**; optional stdin box. Output (stdout, stderr, exit code, time) is shown to **everyone** in the room. | P0 |
| FR-5.6 | Limits: source ≤ 64 KB, run time ≤ 3 s, 10 runs/min/user; exceeding shows a clear error. | P0 |
| FR-5.7 | Code content + language persist per room (survive reload/new session). | P0 |
| FR-5.8 | **Personal playground** page (`/playground`): private editor + Run for any logged-in user; not shared. | P1 |
| FR-5.9 | Participant can request the pen ("Request edit"); host sees request. | P1 |

### 4.8 Whiteboard (FR-5)

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-5.10 | Room has one shared whiteboard (Excalidraw). Host always edits. | P0 |
| FR-5.11 | Members with `can_whiteboard` can draw; others see it in view-only mode with live updates. | P0 |
| FR-5.12 | Changes reach other viewers in < 500 ms. | P0 |
| FR-5.13 | Board state is saved (at most every 5 s and on last-editor leave) and restored on reload. | P0 |
| FR-5.14 | Host can **Clear board** (with confirm). | P1 |

### 4.9 Attendance (FR-6)

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-6.1 | When a member joins a live session, an attendance record opens (`joined_at`). On leave/disconnect it closes (`left_at`). | P0 |
| FR-6.2 | Refresh / short drop (≤ 15 s) does **not** create a new record — the open record is reused. | P0 |
| FR-6.3 | Multiple tabs by the same user count as one presence. | P0 |
| FR-6.4 | Host can view attendance per session: name, first join, last leave, total minutes, number of joins. | P0 |
| FR-6.5 | Ending a session closes all open records with `left_at = ended_at`. | P0 |
| FR-6.6 | Export attendance as CSV. | P1 |

## 5. Screens (MVP)

| # | Route | Screen | Key elements |
|---|-------|--------|--------------|
| S1 | `/login` | Login | Email, password, link to signup |
| S2 | `/signup` | Signup | Name, email, password, role radio |
| S3 | `/` | Dashboard | Room cards, Live badges, Create room modal, Join-with-code input |
| S4 | `/rooms/:roomId` | Room workspace | Header (room name, session status, Start/End/Join), tab bar: **Live · Whiteboard · Code**, right sidebar: **Chat · Participants** |
| S5 | `/rooms/:roomId` → Participants (host) | Permission panel | Per-member row: online dot, 5 toggles, give-pen, remove; Mute all (P1) |
| S6 | `/rooms/:roomId/attendance` | Attendance | Session picker, table, CSV (P1) |
| S7 | `/playground` (P1) | Personal compiler | Editor, language, stdin, Run, output |

Room workspace layout:

```
┌───────────────────────────────────────────────────────────────┐
│ ◀ DSA Batch A   ● Live 00:42:10        [Share code] [End]     │
├──────────────────────────────────────────┬────────────────────┤
│ [ Live ] [ Whiteboard ] [ Code ]         │ [ Chat ][ People ] │
│                                          │                    │
│   video grid / whiteboard / editor       │  messages…         │
│                                          │                    │
│                                          │                    │
│ ── control bar: 🎤 📷 🖥️ ✋ Leave ──────── │ [type a message ]  │
└──────────────────────────────────────────┴────────────────────┘
```

Tabs switch the main panel **without leaving the call** — audio keeps playing while a student views the Code tab.

## 6. Non-functional requirements (MVP targets)

| ID | Category | Target |
|----|----------|--------|
| NFR-1.1 | Security | All API routes and socket connections authenticated; every room action checks membership + permission server-side. |
| NFR-1.2 | Security | Secrets (Supabase service key, LiveKit secret) only on server; never in client bundle. |
| NFR-1.3 | Security | Code runs isolated in Piston sandbox with time/memory/output limits. |
| NFR-1.4 | Security | Chat/user text rendered as text (React escaping); no `dangerouslySetInnerHTML`. |
| NFR-2.1 | Performance | Permission change reflected on target client < 1 s; chat < 500 ms; code sync < 300 ms after debounce. |
| NFR-2.2 | Performance | Dashboard first load < 2 s on broadband. |
| NFR-3.1 | Usability | Core flow (teacher creates room → student joins → session live) achievable without instructions in < 2 min. |
| NFR-3.2 | Usability | Every disabled control has a tooltip explaining why ("Teacher hasn't allowed screen sharing"). |
| NFR-4.1 | Scalability | 15 participants/room, 3 concurrent rooms on a single backend instance. |
| NFR-5.1 | Reliability | Socket + LiveKit auto-reconnect; attendance survives 15 s drops; server restart doesn't lose persisted data. |

## 7. Error handling (user-facing)

| Situation | Message / behaviour |
|-----------|---------------------|
| Invalid join code | "No room found with that code." |
| Join live when no session | "Waiting for the teacher to start the session." |
| Camera/mic denied by browser | "Allow camera/mic access in your browser settings" + help link |
| Permission revoked while using | Toast + control disabled; no crash |
| Removed from room | Redirect to dashboard with "You were removed from this room." |
| Code run timeout | Output panel: "⏱ Time limit exceeded (3 s)" |
| Rate limit | "Too many runs — try again in a few seconds." |
| Socket disconnected | Top banner "Reconnecting…"; inputs disabled until back |

## 8. Out of scope for this FRD

Assignments, exams, polls, files, recordings, announcements, notifications, analytics, multi-org — see [scope-and-decisions.md](./scope-and-decisions.md) §3.

## 9. Traceability (report → FRD)

| Report | FRD sections |
|--------|--------------|
| FR-1 User management | 4.1 |
| FR-2 Rooms/Classes | 4.3 |
| FR-3 Live collaboration | 4.4, 4.5 |
| FR-4 Permissions | 3, 4.6 |
| FR-5 Collaboration tools | 4.7, 4.8 |
| FR-6 Academic tools | 4.9 (attendance only) |
| FR-7 Resources | 4.5 (chat only) |
| FR-8 Dashboard | 4.2 |
| NFR-1…5 | 6 |
