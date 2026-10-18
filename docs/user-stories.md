# User Stories — LinkUp MVP

| Field | Value |
|-------|-------|
| Product | LinkUp — Collaborative Digital Platform for Connected Learning |
| Version | 1.0 (MVP) |
| Based on | FRD v1.0, Architecture, API Contract, Database Schema (Oct 2026) |
| Priority | P0 = must — P1 = should — P2 = post-MVP |
| Format | `US-<area>-<number>` |

> **How to read these stories:**
> *"As a **[actor]**, I want to **[action]** so that **[outcome]**."*
> Each story includes **acceptance criteria (AC)**, **priority**, the **FR/screen** it traces to, and any **edge cases / error conditions** the implementation must handle.

---

## Table of Contents

1. [Authentication & Profile](#1-authentication--profile)
2. [Dashboard](#2-dashboard)
3. [Room Management](#3-room-management)
4. [Live Session & Media](#4-live-session--media)
5. [Chat](#5-chat)
6. [Permission Control](#6-permission-control)
7. [Code Workspace](#7-code-workspace)
8. [Whiteboard](#8-whiteboard)
9. [Attendance](#9-attendance)
10. [Error States & System Resilience](#10-error-states--system-resilience)
11. [Security & Non-functional](#11-security--non-functional)

---

## 1. Authentication & Profile

### US-AUTH-01 — Sign Up
**Priority:** P0 | **Traces to:** FR-1.1, S2

> As a **new user (teacher or student)**, I want to sign up with my full name, email, password, and role so that I can access the platform with the correct capabilities.

**Acceptance Criteria:**
- [ ] A form is shown at `/signup` with fields: Full Name, Email, Password, Role (Teacher / Student radio buttons).
- [ ] Password must be at least 8 characters; shorter passwords show an inline validation error.
- [ ] On successful signup, a `profiles` row is created in the database with the chosen role and full name.
- [ ] The user is redirected to the Dashboard (`/`) after signup.
- [ ] Attempting to sign up with an already-registered email shows: *"An account with this email already exists."*
- [ ] The role field cannot be submitted blank.

**Edge Cases:**
- Whitespace-only full name is rejected.
- Email is validated for format before submission.

---

### US-AUTH-02 — Log In
**Priority:** P0 | **Traces to:** FR-1.2, S1

> As a **returning user**, I want to log in with my email and password so that I can resume my work.

**Acceptance Criteria:**
- [ ] A form is shown at `/login` with Email and Password fields and a link to the Signup page.
- [ ] On successful login, the user is redirected to the Dashboard.
- [ ] The session persists across browser reloads (user stays logged in).
- [ ] Incorrect credentials show: *"Incorrect email or password."*
- [ ] After logout, refreshing the page redirects back to `/login`.

---

### US-AUTH-03 — Log Out
**Priority:** P0 | **Traces to:** FR-1.3

> As a **logged-in user**, I want to log out from any page so that my session is closed securely.

**Acceptance Criteria:**
- [ ] A logout button or option is accessible from every page (e.g., header/avatar menu).
- [ ] Clicking logout clears the session and redirects to `/login`.
- [ ] After logout, any protected route visited redirects to `/login`.

---

### US-AUTH-04 — Protected Route Redirect
**Priority:** P0 | **Traces to:** FR-1.4

> As an **unauthenticated visitor**, I want to be redirected to `/login` when I try to access any protected page so that unauthorised access is prevented.

**Acceptance Criteria:**
- [x] Visiting `/`, `/rooms/:id`, `/playground`, or `/rooms/:id/attendance` without a session redirects to `/login`.
- [x] After login, the user is taken to the originally requested page (or the Dashboard if no specific page was targeted).

---

### US-AUTH-05 — API Token Enforcement
**Priority:** P0 | **Traces to:** FR-1.5

> As the **system**, every API request and socket connection must be authenticated with a valid Supabase access token so that the backend is never accessed without identity.

**Acceptance Criteria:**
- [x] Any `GET/POST/PATCH/DELETE` to `/api/*` without an `Authorization: Bearer <token>` header returns `401 UNAUTHENTICATED`.
- [x] A Socket.IO connection attempt without a valid token in the `auth` object is rejected with `connect_error: UNAUTHENTICATED`.
- [x] An expired token returns `401`; the client silently refreshes the token and retries.

---

### US-AUTH-06 — Edit Profile Name (P1)
**Priority:** P1 | **Traces to:** FR-1.6

> As a **logged-in user**, I want to edit my full name so that my display name is up to date.

**Acceptance Criteria:**
- [x] A profile settings option is accessible from the header.
- [x] `PATCH /api/me` with `{ fullName }` updates the name in the database.
- [x] The updated name is reflected in the dashboard, room members list, and chat messages going forward.
- [x] Whitespace-only or empty names are rejected with an inline error.

---

### US-AUTH-07 — Password Reset (P1)
**Priority:** P1 | **Traces to:** FR-1.7

> As a **user who has forgotten their password**, I want to receive a password-reset email so that I can regain access to my account.

**Acceptance Criteria:**
- [x] A "Forgot password?" link on `/login` triggers the Supabase built-in password-reset flow.
- [x] The user receives an email with a reset link.
- [x] After setting a new password, the user is redirected to `/login`.

---

## 2. Dashboard

### US-DASH-01 — View My Rooms
**Priority:** P0 | **Traces to:** FR-8.1, S3

> As a **logged-in user**, I want to see all the rooms I belong to on my dashboard so that I can navigate to any room quickly.

**Acceptance Criteria:**
- [ ] The dashboard (`/`) lists all rooms the user is a member of.
- [ ] Each room card shows: room name, host name, member count, and my role (Teacher / Student).
- [ ] Rooms are ordered newest first.
- [ ] Dashboard loads within 2 seconds on broadband.

---

### US-DASH-02 — Live Badge on Active Room
**Priority:** P0 | **Traces to:** FR-8.2

> As a **logged-in user**, I want to see a "Live" badge and a Join button on a room card when that room has an active session so that I can join ongoing classes instantly.

**Acceptance Criteria:**
- [x] A room card shows a **"Live"** badge when `activeSessionId` is not null.
- [x] A **"Join"** button appears alongside the badge, which navigates to the room page.
- [x] Rooms without an active session do not show a badge or Join button.

---

### US-DASH-03 — Create a Room (Teacher)
**Priority:** P0 | **Traces to:** FR-8.3, FR-2.1, S3

> As a **teacher**, I want to create a new room with a name, optional description, and default permissions so that I can set up a class workspace before inviting students.

**Acceptance Criteria:**
- [x] A **"Create Room"** button is visible on the dashboard only for users with the `teacher` role.
- [x] Clicking it opens a modal with: Room Name (required, max 80 chars), Description (optional, max 500 chars), and 5 default-permission toggles (Mic, Camera, Screen, Whiteboard, Code).
- [x] Submitting creates the room and adds the teacher as host.
- [x] The system generates a unique 6-character join code (characters: A-Z, 2-9; no O, 0, I, 1).
- [x] The new room card appears on the dashboard immediately.
- [x] Students do not see the Create Room button; a direct API call with a student token returns `403 TEACHER_ONLY`.

---

### US-DASH-04 — Join a Room with Code (Student)
**Priority:** P0 | **Traces to:** FR-8.3, FR-2.3, S3

> As a **student**, I want to join a room by entering a 6-character code so that I can access the class workspace my teacher set up.

**Acceptance Criteria:**
- [ ] A **"Join with Code"** input and button is always visible for students (and also for teachers who want to join another teacher's room).
- [ ] The code is case-insensitive; the server normalises to uppercase before lookup.
- [ ] On success, the user is added to the room and the room card appears on the dashboard.
- [ ] Joining a room you are already a member of is idempotent (no error, no duplicate membership).
- [ ] An unknown code shows: *"No room found with that code."*

---

### US-DASH-05 — View and Copy Join Code (Host)
**Priority:** P0 | **Traces to:** FR-8.4

> As a **host (teacher)**, I want to see the join code for each room I own, with a copy button, so that I can share it with students easily.

**Acceptance Criteria:**
- [ ] The join code is displayed on the room card for the host.
- [ ] A copy-to-clipboard button copies the code.
- [ ] Students cannot see the join code on their dashboard cards.

---

### US-DASH-06 — Empty State Guidance
**Priority:** P0 | **Traces to:** FR-8.5

> As a **first-time user with no rooms**, I want to see a helpful empty state so that I know what to do next.

**Acceptance Criteria:**
- [ ] Teachers see: *"Create your first room"* with a prominent Create Room button.
- [ ] Students see: *"Ask your teacher for a room code and join below"* with a Join form.

---
## 3. Room Management

### US-ROOM-01 — View Room Page
**Priority:** P0 | **Traces to:** FR-2.4, S4

> As a **room member**, I want to see the room workspace with a tab bar (Live, Whiteboard, Code) and a sidebar (Chat, People) so that I can access every tool in one place.

**Acceptance Criteria:**
- [ ] Navigating to `/rooms/:roomId` shows the room header (room name, session status), three main tabs, and two sidebar tabs.
- [ ] Non-members requesting `/rooms/:roomId` via REST or Socket.IO receive `403 NOT_A_MEMBER` and are redirected to the dashboard.
- [ ] Switching tabs does not disconnect the user from the live call (audio continues).

---

### US-ROOM-02 — View Members and Presence
**Priority:** P0 | **Traces to:** FR-2.4

> As a **room member**, I want to see who is in the room with their role and online status so that I know who is active.

**Acceptance Criteria:**
- [ ] The People sidebar shows all room members with a name, role badge (Teacher / Student), and an online/offline dot.
- [ ] The online dot updates within 1 second when a member connects or disconnects.
- [ ] Users currently in the live call have an additional "In call" indicator.

---

### US-ROOM-03 — Remove a Member (Host)
**Priority:** P0 | **Traces to:** FR-2.5

> As a **host**, I want to remove a participant from the room so that I can manage classroom access.

**Acceptance Criteria:**
- [ ] A "Remove" button is visible per participant in the host's Participants panel, with a confirmation prompt.
- [ ] Removing a member: deletes their `room_members` row, disconnects them from the live session, closes their open attendance record, and removes their socket from the room.
- [ ] The removed user is immediately redirected to the dashboard with a toast: *"You were removed from this room."*
- [ ] All remaining members see the member disappear from the list within 1 second.

---

### US-ROOM-04 — Regenerate Join Code (P1)
**Priority:** P1 | **Traces to:** FR-2.6

> As a **host**, I want to regenerate the room's join code so that previous recipients cannot use the old code to join.

**Acceptance Criteria:**
- [ ] A "Regenerate Code" option is available to the host.
- [ ] The old code immediately becomes invalid.
- [ ] The new code is displayed with a copy button.

---

### US-ROOM-05 — Edit Room Name/Description and Archive (P1)
**Priority:** P1 | **Traces to:** FR-2.7

> As a **host**, I want to edit the room name and description, or archive a room, so that I can keep the workspace organised.

**Acceptance Criteria:**
- [x] `PATCH /api/rooms/:roomId` accepts `{ name?, description? }` and updates the room.
- [x] Archived rooms do not appear on any user's dashboard.
- [x] Only the host can edit or archive a room; other users get `403 HOST_ONLY`.

---

## 4. Live Session & Media

### US-LIVE-01 — Start a Session (Host)
**Priority:** P0 | **Traces to:** FR-3.1

> As a **host**, I want to start a live session so that students can join a real-time class.

**Acceptance Criteria:**
- [ ] A **"Start Session"** button is shown in the room header for hosts when no session is active.
- [ ] Clicking starts a session; all room members receive a `session:started` socket event and see the room update to "Live" status.
- [ ] Only one session can be active per room at a time; a second start attempt returns `409 SESSION_ACTIVE`.
- [ ] The session timer starts counting from 00:00 in the header.

---

### US-LIVE-02 — Join a Live Session (Member)
**Priority:** P0 | **Traces to:** FR-3.2, FR-3.3

> As a **room member**, I want to join a live session so that I can participate in the class with audio and video.

**Acceptance Criteria:**
- [ ] While a session is active, members see a **"Join Live"** button.
- [ ] Before entering, a device preview (camera + mic test) is shown.
- [ ] The user enters the call with mic and camera **off** by default.
- [ ] If no session is active, the area shows: *"Waiting for the teacher to start the session."*
- [ ] The server mints a LiveKit token with grants derived from the member's current permission flags.

---

### US-LIVE-03 — Video Grid with Participant Tiles
**Priority:** P0 | **Traces to:** FR-3.4

> As a **session participant**, I want to see all participants in a video grid with name labels and mute indicators so that I can see who is in the call.

**Acceptance Criteria:**
- [ ] Each participant tile shows their name, a mute icon when their mic is off, and a camera-off icon when their camera is off.
- [ ] The currently speaking participant's tile is visually highlighted (active speaker highlight).
- [ ] Tiles update dynamically as participants join/leave.

---

### US-LIVE-04 — Screen Sharing
**Priority:** P0 | **Traces to:** FR-3.5

> As a **user with screen-share permission**, I want to share my screen/window/tab so that others can follow along.

**Acceptance Criteria:**
- [x] The screen-share button is enabled only if `can_screen = true` (or the user is the host).
- [x] A screen share appears as the focused tile for all participants; other tiles move to a strip below.
- [x] Only one screen share is active at a time.
- [x] If `can_screen` is revoked while sharing, the share stops immediately for all viewers.
- [x] Hovering over a disabled screen-share button shows a tooltip explaining why.

---

### US-LIVE-05 — End a Session (Host)
**Priority:** P0 | **Traces to:** FR-3.6

> As a **host**, I want to end the session so that all participants are cleanly disconnected and attendance is finalised.

**Acceptance Criteria:**
- [ ] An **"End Session"** button is visible in the room header for the host during an active session.
- [ ] Ending sets `ended_at` on the session, deletes the LiveKit room, closes all open attendance records, and emits `session:ended` to the room.
- [ ] All participants see a "Session has ended" message and are returned to the room's non-live view.
- [ ] The session timer in the header stops and is replaced with "Session ended".

---

### US-LIVE-06 — Host Leaves Without Ending
**Priority:** P0 | **Traces to:** FR-3.7

> As a **host**, if I leave the call without ending the session, I want the session to remain active so that I can rejoin.

**Acceptance Criteria:**
- [ ] The session remains active (LiveKit room not deleted) when the host disconnects from the call.
- [ ] Other participants remain connected.
- [ ] The host can re-join the call using the Join Live button.

---

### US-LIVE-07 — Auto-Reconnect on Network Drop
**Priority:** P0 | **Traces to:** FR-3.8

> As a **session participant**, if I temporarily lose my network connection, I want the app to automatically reconnect so that I do not have to manually rejoin.

**Acceptance Criteria:**
- [x] A top-of-screen **"Reconnecting..."** banner appears when the Socket.IO or LiveKit connection drops.
- [x] Chat input, media controls, and other interactive elements are disabled while reconnecting.
- [x] Within 15 seconds of reconnection, the banner disappears and the full state is synced from the `room:join` snapshot.
- [x] A reconnect within 15 seconds reuses the open attendance record.

---

### US-LIVE-08 — Switch Media Devices (P1)
**Priority:** P1 | **Traces to:** FR-3.9

> As a **session participant**, I want to switch between available microphones and cameras so that I can use the correct device.

**Acceptance Criteria:**
- [x] A device-picker control is accessible from the control bar.
- [x] Switching does not disconnect the user from the call.

---

## 5. Chat

### US-CHAT-01 — Send a Message
**Priority:** P0 | **Traces to:** FR-3.10, FR-3.11

> As a **room member**, I want to send a text message in the room chat so that I can communicate with everyone in the room.

**Acceptance Criteria:**
- [x] A message input and Send button are always available in the Chat sidebar tab, inside or outside a live session.
- [x] Messages are 1-2000 characters; an empty message cannot be sent.
- [x] Messages appear for all online members within 500 ms (same region).
- [x] The sender sees an optimistic message that is confirmed or replaced once the server acknowledges it.

---

### US-CHAT-02 — View Chat History
**Priority:** P0 | **Traces to:** FR-3.12

> As a **room member**, I want to see the last 50 messages when I open the chat and be able to load older messages by scrolling up so that I can follow the conversation history.

**Acceptance Criteria:**
- [x] Opening the room loads the last 50 messages (newest at the bottom).
- [x] Scrolling to the top loads the next 50 older messages (cursor pagination via `before` query param).
- [x] A "Loading..." indicator is shown during fetch.
- [x] A "No more messages" indicator is shown when `hasMore = false`.

---

### US-CHAT-03 — Message Display: Sender Info
**Priority:** P0 | **Traces to:** FR-3.13

> As a **room member**, I want to see the sender's name, a Teacher badge (if applicable), and the message timestamp so that I know who said what and when.

**Acceptance Criteria:**
- [x] Each message shows: sender full name, timestamp, and a **"Teacher"** role badge if the sender has the `teacher` role.
- [x] Timestamps are displayed in the user's local time.

---

### US-CHAT-04 — Plain Text Rendering and Link Auto-linking
**Priority:** P0 | **Traces to:** FR-3.14

> As a **room member**, I want URLs in messages to be clickable links, while all other text is rendered as plain text, so that the chat is both useful and secure.

**Acceptance Criteria:**
- [x] URLs (http/https) in messages are automatically converted to clickable links with `rel="noopener noreferrer"` and `target="_blank"`.
- [x] No HTML tags in message bodies are rendered as markup (React escaping is used; no dangerouslySetInnerHTML).

---
## 6. Permission Control

### US-PERM-01 — View Participant Permissions (Host)
**Priority:** P0 | **Traces to:** FR-4.1, S5

> As a **host**, I want to see all participants in a panel with 5 permission toggles per person so that I can manage access for each student.

**Acceptance Criteria:**
- [x] The Participants tab in the host view shows a row per participant: name, online dot, and 5 toggles (Mic, Camera, Screen, Whiteboard, Code).
- [x] The host's own row shows all toggles permanently enabled and locked (cannot be changed).
- [x] Students see the People tab but do not see the toggles.

---

### US-PERM-02 — Toggle a Permission (Host)
**Priority:** P0 | **Traces to:** FR-4.2, FR-4.3

> As a **host**, I want to toggle any of the 5 permissions for any participant so that I can control what each student can do in real time.

**Acceptance Criteria:**
- [ ] Toggling a permission updates `room_members` in the database, updates LiveKit publish rights (for Mic/Camera/Screen), and emits `perm:changed` to all room members.
- [ ] The target student's UI reflects the change within 1 second.
- [ ] If the student has an active mic/camera/screen track that is revoked, that track stops for all viewers within 1 second.
- [ ] The host sees an optimistic toggle update that rolls back if the server returns an error.

---

### US-PERM-03 — Permission Change Toast (Student)
**Priority:** P0 | **Traces to:** FR-4.4

> As a **student**, I want to receive a clear toast notification when the teacher changes one of my permissions so that I know why a control has been enabled or disabled.

**Acceptance Criteria:**
- [x] When a permission is revoked, the student sees a toast like: *"Teacher turned off your microphone."*
- [x] When a permission is granted, the student sees: *"You can now edit the whiteboard."*
- [x] Toasts are non-blocking and auto-dismiss after 4 seconds.

---

### US-PERM-04 — Permissions Persist Across Sessions
**Priority:** P0 | **Traces to:** FR-4.5

> As a **host**, I want a student's permissions to be saved so that I do not need to re-grant them each time the student rejoins.

**Acceptance Criteria:**
- [ ] A student who leaves and rejoins the room retains the same permission flags.
- [ ] Permissions are stored on `room_members` and survive server restarts.
- [ ] A new member gets the room's `default_permissions` when they join.

---

### US-PERM-05 — Server-side Permission Enforcement
**Priority:** P0 | **Traces to:** FR-4.6, BR-5

> As the **system**, I want every permission to be enforced on the server so that a modified client cannot bypass restrictions.

**Acceptance Criteria:**
- [ ] A student without `can_mic` whose client attempts to publish audio: LiveKit rejects the publish (permission denied error).
- [ ] A socket `wb:update` event from a student without `can_whiteboard`: the server drops the event and emits `error { code: "FORBIDDEN" }` back to the sender; no other clients receive the update.
- [ ] A socket `code:update` event from a user who is not the current pen holder: server drops it with `error { code: "NOT_PEN_HOLDER" }`.
- [ ] `PATCH /rooms/:roomId/members/:userId/permissions` from a non-host returns `403 HOST_ONLY`.

---

### US-PERM-06 — Mute All (Host) (P1)
**Priority:** P1 | **Traces to:** FR-4.7

> As a **host**, I want to mute all participants at once so that I can quickly silence the class.

**Acceptance Criteria:**
- [ ] A **"Mute All"** button is available in the host's Participants panel.
- [ ] Clicking it sets `can_mic = false` for every participant (not the host) in a single bulk request.
- [ ] Each affected participant receives a toast: *"Teacher muted everyone."*
- [ ] Participants who were actively publishing audio are muted within 1 second.

---

### US-PERM-07 — Raise Hand (P1)
**Priority:** P1 | **Traces to:** FR-4.8

> As a **student**, I want to raise my hand so that the teacher knows I want to speak; and as the **host**, I want to see raised hands and grant the mic in one click.

**Acceptance Criteria:**
- [x] A hand-raise button is available in the call control bar for all participants.
- [x] Raising a hand emits `hand:raise { raised: true }` and all room members receive `hand:changed`; a hand icon appears on the student's participant row.
- [x] The host can click a **"Grant Mic"** button next to the hand icon; this grants `can_mic = true` and lowers the hand.
- [x] The student can lower their own hand at any time.

---

## 7. Code Workspace

### US-CODE-01 — View the Shared Editor
**Priority:** P0 | **Traces to:** FR-5.1, FR-5.2

> As a **room member**, I want to see the shared Monaco code editor in the Code tab with a language selector so that I can follow what the teacher or a permitted student is coding.

**Acceptance Criteria:**
- [x] The Code tab shows a Monaco editor with a language selector (Python, JavaScript, C++, Java).
- [x] All members who do not hold the pen see the editor in read-only mode with live updates (under 300 ms after debounce).
- [x] The editor header shows who is currently editing (e.g., "Priya is editing").
- [x] Joining the room late shows the current code content from the `room:join` snapshot.

---

### US-CODE-02 — Give the Pen to a Student (Host)
**Priority:** P0 | **Traces to:** FR-5.3

> As a **host**, I want to give the edit pen to a student who has `can_code` permission so that they can type code in the shared editor.

**Acceptance Criteria:**
- [x] A **"Give Pen"** dropdown lists all participants with `can_code = true`; a **"Take Back"** button is shown when a student holds the pen.
- [x] Clicking assigns the pen: the server emits `code:pen { holderId }` to all room members; the student's editor becomes writable; the host's editor becomes read-only.
- [x] A student without `can_code` is not listed in the dropdown.
- [x] Only the host can assign the pen; a participant cannot self-assign.

---

### US-CODE-03 — Type and Sync Code (Pen Holder)
**Priority:** P0 | **Traces to:** FR-5.2

> As the **pen holder**, I want my edits to be broadcast to everyone in the room so that all members see the code in near real time.

**Acceptance Criteria:**
- [x] Changes are emitted to the server with a 150 ms debounce.
- [x] The server increments `rev` and broadcasts `code:state` to all other room members.
- [x] Viewers see the update within 300 ms of the debounce firing.
- [x] The full code content is sent (no diffing in the MVP); source size must be max 64 KB.

---

### US-CODE-04 — Revoke Code Permission from Pen Holder
**Priority:** P0 | **Traces to:** FR-5.4

> As a **host**, if I revoke `can_code` from the student who currently holds the pen, I want the pen to automatically return to me so that the student cannot continue editing.

**Acceptance Criteria:**
- [x] When `can_code` is revoked from the current pen holder, the server automatically calls `codeService.setPen(roomId, hostId)`.
- [x] A `code:pen { holderId: hostId }` event is emitted to all room members.
- [x] The former holder's editor immediately switches to read-only.
- [x] The host's editor becomes writable.

---

### US-CODE-05 — Run Code
**Priority:** P0 | **Traces to:** FR-5.5, FR-5.6

> As the **pen holder or host**, I want to run the code in the editor so that everyone in the room can see the output.

**Acceptance Criteria:**
- [x] A **"Run"** button is visible in the Code tab for the pen holder and the host.
- [x] An optional stdin text box is available before running.
- [x] Clicking Run emits `code:run-started` to the room and calls `POST /execute` via Piston.
- [x] The output panel shows stdout, stderr (highlighted), exit code, execution time, and a spinner while running.
- [x] All room members see the same output (via `code:run-result`).
- [x] Code over 64 KB returns `413 PAYLOAD_TOO_LARGE`: *"Source code exceeds the 64 KB limit."*
- [x] A run exceeding 3 seconds shows: *"Time limit exceeded (3 s)."*
- [x] After 10 runs per minute from the same user, the 11th returns `429 RATE_LIMITED`: *"Too many runs — try again in a few seconds."*

---

### US-CODE-06 — Code and Language Persist
**Priority:** P0 | **Traces to:** FR-5.7

> As a **room member**, I want the code content and selected language to be restored when I return to the room so that work is never lost.

**Acceptance Criteria:**
- [ ] `code_state` is persisted to Postgres (debounced 3 s and on last member leave).
- [ ] Reopening the Code tab or rejoining the room shows the last saved code and language.
- [ ] Code state survives a server restart.

---

### US-CODE-07 — Personal Playground (P1)
**Priority:** P1 | **Traces to:** FR-5.8

> As any **logged-in user**, I want a private code editor page where I can run code just for myself so that I can experiment without affecting the shared room editor.

**Acceptance Criteria:**
- [x] A `/playground` route shows a Monaco editor, language selector, stdin box, Run button, and output panel.
- [x] Code runs via `POST /execute` without a `roomId`; output is shown only to the user.
- [x] No code or output is shared to any room.
- [x] Same rate limits apply (10 runs/minute).

---

### US-CODE-08 — Request the Pen (P1)
**Priority:** P1 | **Traces to:** FR-5.9

> As a **student with `can_code`**, I want to request the edit pen so that I can signal to the teacher that I want to type.

**Acceptance Criteria:**
- [x] A **"Request Edit"** button is shown in the Code tab for participants with `can_code` who do not hold the pen.
- [x] Clicking emits `code:request-pen`; the server sends `code:pen-requested` to the host's sockets.
- [x] The host sees a badge indicating the student's request.

---
## 8. Whiteboard

### US-WB-01 — View the Shared Whiteboard
**Priority:** P0 | **Traces to:** FR-5.10, FR-5.11

> As a **room member without whiteboard permission**, I want to see the shared Excalidraw whiteboard in view-only mode so that I can follow what is being drawn.

**Acceptance Criteria:**
- [ ] The Whiteboard tab renders Excalidraw in view-only mode for members where `can_whiteboard = false` and who are not the host.
- [ ] Drawings appear in view-only mode with no drawing tools visible.
- [ ] Attempting a whiteboard draw via a crafted socket event returns `error { code: "FORBIDDEN" }` and does not affect the board for others.

---

### US-WB-02 — Draw on the Whiteboard (Permitted User)
**Priority:** P0 | **Traces to:** FR-5.11, FR-5.12

> As a **user with whiteboard permission (or the host)**, I want to draw on the shared Excalidraw whiteboard so that other members can see my drawings in near real time.

**Acceptance Criteria:**
- [x] The editor is writable for members with `can_whiteboard = true` and the host.
- [x] Changed elements are throttled at 100 ms and broadcast via `wb:update`.
- [x] All other members see changes within 500 ms.
- [x] Deletions (Excalidraw `isDeleted: true`) sync correctly.
- [x] The image tool is disabled (images need file storage, which is out of scope).

---

### US-WB-03 — Whiteboard State Persists
**Priority:** P0 | **Traces to:** FR-5.13

> As a **room member**, I want the whiteboard to be restored when I reload or rejoin so that drawn content is not lost.

**Acceptance Criteria:**
- [x] `whiteboard_state` is persisted to Postgres (debounced 5 s and on last editor leave).
- [x] Joining or rejoining the room loads the current board state from the `room:join` snapshot.
- [x] Board state survives a server restart.

---

### US-WB-04 — Grant/Revoke Whiteboard Access Live
**Priority:** P0 | **Traces to:** FR-5.11

> As a **host**, I want to grant or revoke a student's whiteboard permission while the whiteboard is open so that I can invite students to draw at any moment.

**Acceptance Criteria:**
- [x] Toggling `can_whiteboard` via the Participants panel sends `perm:changed` to the room.
- [x] The target student's view mode updates within 1 second without a page reload.
- [x] After being revoked, a subsequent `wb:update` from that student is rejected server-side.

---

### US-WB-05 — Clear Board (Host) (P1)
**Priority:** P1 | **Traces to:** FR-5.14

> As a **host**, I want to clear the entire whiteboard with a confirmation so that I can start a fresh diagram.

**Acceptance Criteria:**
- [x] A **"Clear Board"** button is visible to the host only.
- [x] Clicking shows a confirmation dialog.
- [x] On confirm, the server emits `wb:cleared` to the room; all clients reset the canvas to empty.
- [x] The cleared state is persisted.

---

## 9. Attendance

### US-ATT-01 — Auto Record Join and Leave
**Priority:** P0 | **Traces to:** FR-6.1

> As the **system**, I want to automatically create an attendance record when a member joins the live call and close it when they leave so that the host has an accurate view of participation.

**Acceptance Criteria:**
- [x] Emitting `live:joined` creates or reuses an open attendance record with `joined_at = now()`.
- [x] Emitting `live:left` or disconnecting starts a 15-second grace timer; if the user does not reconnect, `left_at = now()` is set.
- [x] Reconnecting within 15 seconds cancels the timer and reuses the same record.

---

### US-ATT-02 — Reconnect Grace Period
**Priority:** P0 | **Traces to:** FR-6.2

> As a **student with a brief network drop**, I want a short reconnect not to be counted as a separate attendance entry so that my total time is reported accurately.

**Acceptance Criteria:**
- [x] A disconnect and reconnect within 15 seconds reuses the single open attendance record.
- [x] A disconnect longer than 15 seconds closes the record and creates a new one on reconnect.

---

### US-ATT-03 — Multi-Tab Handling
**Priority:** P0 | **Traces to:** FR-6.3

> As a **user with the room open in multiple tabs**, I want my attendance to be counted as a single presence so that the record is not inflated.

**Acceptance Criteria:**
- [ ] Each user is tracked by `userId`; multiple socket connections (tabs) are counted together in a `liveSockets` set.
- [ ] An attendance record closes only when all tabs for that user have left.

---

### US-ATT-04 — View Attendance (Host)
**Priority:** P0 | **Traces to:** FR-6.4, S6

> As a **host**, I want to view the attendance for each session, including each student's first join time, last leave time, total minutes, and number of joins so that I can assess participation.

**Acceptance Criteria:**
- [x] The Attendance page (`/rooms/:roomId/attendance`) shows a session picker dropdown.
- [x] Selecting a session shows a table: Name, First Join, Last Leave, Total Minutes, Number of Joins.
- [x] Total minutes are rounded to the nearest minute.
- [x] The page is accessible only to the host; other users get `403`.

---

### US-ATT-05 — End Session Closes All Records
**Priority:** P0 | **Traces to:** FR-6.5

> As the **system**, when the host ends a session, I want all open attendance records to be closed with `left_at = ended_at` so that no records are left open.

**Acceptance Criteria:**
- [x] `POST /rooms/:roomId/sessions/:sessionId/end` calls `close_session_attendance(sessionId, ended_at)`.
- [x] All records with `left_at IS NULL` for that session are updated.
- [x] On server boot, open records for already-ended sessions are also closed (crash recovery).

---

### US-ATT-06 — Export Attendance CSV (P1)
**Priority:** P1 | **Traces to:** FR-6.6

> As a **host**, I want to export the attendance table as a CSV file so that I can analyse it in a spreadsheet.

**Acceptance Criteria:**
- [x] A **"Download CSV"** button is available on the Attendance page.
- [x] `GET /rooms/:roomId/sessions/:sessionId/attendance.csv` returns a `text/csv` response.
- [x] The CSV includes columns: Name, First Join, Last Leave, Total Minutes, Number of Joins.

---

## 10. Error States & System Resilience

### US-ERR-01 — Invalid Join Code
**Priority:** P0 | **Traces to:** FRD Section 7

> As a **user**, if I enter a wrong join code, I want a clear error message so that I know the code is incorrect.

**Acceptance Criteria:**
- [x] The UI shows: *"No room found with that code."*
- [x] The input remains editable for a retry.

---

### US-ERR-02 — Join Live When No Session Active
**Priority:** P0 | **Traces to:** FRD Section 7

> As a **student**, if I try to join a live session that has not started, I want a meaningful message so that I know what to do.

**Acceptance Criteria:**
- [x] The UI shows: *"Waiting for the teacher to start the session."*
- [x] When the teacher starts, the status updates automatically via `session:started` event without requiring a page reload.

---

### US-ERR-03 — Camera and Mic Browser Permission Denied
**Priority:** P0 | **Traces to:** FRD Section 7

> As a **user** whose browser blocks camera or mic access, I want a helpful error message so that I know how to fix it.

**Acceptance Criteria:**
- [x] If `getUserMedia` is denied by the browser, the UI shows: *"Allow camera/mic access in your browser settings"* with a help link.
- [x] The app does not crash; the user can still use chat, code, and whiteboard.

---

### US-ERR-04 — Permission Revoked While in Use
**Priority:** P0 | **Traces to:** FRD Section 7

> As a **student** whose mic/camera/screen is revoked while active, I want a clear notification and graceful control disablement so that I am not confused.

**Acceptance Criteria:**
- [ ] The student receives a toast and the relevant control is immediately disabled.
- [ ] The media track stops within 1 second.
- [ ] No crash or error screen is shown.

---

### US-ERR-05 — Removed From Room
**Priority:** P0 | **Traces to:** FRD Section 7

> As a **removed student**, I want to be redirected to the dashboard with a clear message so that I understand what happened.

**Acceptance Criteria:**
- [ ] Upon receiving `room:kicked`, the UI redirects to `/` with a toast: *"You were removed from this room."*
- [ ] The student cannot navigate back to the room directly (they are no longer a member).

---

### US-ERR-06 — Code Run Timeout
**Priority:** P0 | **Traces to:** FRD Section 7

> As a **room member**, if a code run exceeds the time limit, I want to see a clear timeout message in the output panel so that I know the run was cut short.

**Acceptance Criteria:**
- [x] The output panel shows: *"Time limit exceeded (3 s)"* when `timedOut: true`.
- [x] Any partial stdout/stderr is still shown above the timeout message.

---

### US-ERR-07 — Rate Limit on Code Execution
**Priority:** P0 | **Traces to:** FRD Section 7

> As a **user** who runs code more than 10 times per minute, I want a friendly rate-limit message so that I understand the restriction.

**Acceptance Criteria:**
- [ ] The 11th run within 60 seconds returns `429 RATE_LIMITED`.
- [ ] The UI shows: *"Too many runs — try again in a few seconds."*

---

### US-ERR-08 — Socket Disconnected Banner
**Priority:** P0 | **Traces to:** FRD Section 7, FR-3.8

> As a **user**, if my socket connection drops, I want a persistent banner at the top of the page so that I know my real-time features are temporarily unavailable.

**Acceptance Criteria:**
- [ ] A **"Reconnecting..."** banner appears at the top of the screen on socket disconnect.
- [ ] Chat send, code updates, and whiteboard edits are disabled while disconnected.
- [ ] The banner disappears and controls re-enable within 1 second of reconnection.

---

## 11. Security & Non-functional

### US-SEC-01 — All API Routes Authenticated
**Priority:** P0 | **Traces to:** NFR-1.1

> As the **system**, every API route and socket event must require authentication and verify room membership and permissions server-side so that no action can be performed without authorisation.

**Acceptance Criteria:**
- [ ] `requireAuth` middleware is applied to every route except `GET /health`.
- [ ] `requireMember` is applied to every `/rooms/:id/*` route.
- [ ] `requireHost` is applied to host-only routes (start/end session, permission changes, remove member).
- [ ] Socket handlers re-check membership and flags from DB/cache on every event, not just on `room:join`.

---

### US-SEC-02 — Secrets Never Exposed to Client
**Priority:** P0 | **Traces to:** NFR-1.2

> As the **system**, Supabase service-role key and LiveKit API secret must never be included in the client bundle so that they cannot be extracted by users.

**Acceptance Criteria:**
- [ ] `SUPABASE_SERVICE_ROLE_KEY` and `LIVEKIT_API_SECRET` are only in server environment variables.
- [ ] No server-only secret appears in any `VITE_*` variable.

---

### US-SEC-03 — Sandboxed Code Execution
**Priority:** P0 | **Traces to:** NFR-1.3

> As the **system**, code must run in the Piston sandbox with enforced time, memory, and output limits so that malicious code cannot harm the server.

**Acceptance Criteria:**
- [ ] Piston is called with `run_timeout: 3000 ms`, `compile_timeout: 10000 ms`, `run_memory_limit: 256 MB`.
- [ ] Stdout and stderr are each truncated to 64 KB; `truncated: true` is set in the response.
- [ ] Piston is not reachable from the public internet (internal Docker network only).

---

### US-SEC-04 — Performance Targets
**Priority:** P0 | **Traces to:** NFR-2.1, NFR-2.2

> As a **user**, I want the platform to be fast and responsive so that it feels professional.

**Acceptance Criteria:**
- [ ] Permission change is reflected on the target client in under 1 second.
- [ ] Chat messages appear for all online members in under 500 ms.
- [ ] Code syncs to viewers in under 300 ms after the debounce fires.
- [ ] The dashboard loads in under 2 seconds on broadband.

---

### US-SEC-05 — Scalability Target for MVP
**Priority:** P0 | **Traces to:** NFR-4.1

> As the **system**, the MVP must support up to 15 participants per room and 3 concurrent rooms on a single backend instance so that the demo can run without performance issues.

**Acceptance Criteria:**
- [ ] A 15-participant room with all features active (video, chat, code, whiteboard) runs without errors.
- [ ] 3 concurrent rooms do not degrade each other's performance.

---

## Traceability Matrix

| User Story Group | FRD Requirement | Screen(s) |
|-----------------|----------------|-----------|
| US-AUTH-01 to 07 | FR-1.1 to FR-1.7 | S1, S2 |
| US-DASH-01 to 06 | FR-8.1 to FR-8.5 | S3 |
| US-ROOM-01 to 05 | FR-2.1 to FR-2.8 | S4, S5 |
| US-LIVE-01 to 08 | FR-3.1 to FR-3.9 | S4 |
| US-CHAT-01 to 04 | FR-3.10 to FR-3.14 | S4 |
| US-PERM-01 to 07 | FR-4.1 to FR-4.8 | S5 |
| US-CODE-01 to 08 | FR-5.1 to FR-5.9 | S4, S7 |
| US-WB-01 to 05 | FR-5.10 to FR-5.14 | S4 |
| US-ATT-01 to 06 | FR-6.1 to FR-6.6 | S6 |
| US-ERR-01 to 08 | FRD Section 7 | All screens |
| US-SEC-01 to 05 | NFR-1 to NFR-5 | — |

---

*Last updated: October 2026 | Team: Sejal Naik, Sakshi, Siddhi, Harsh*
