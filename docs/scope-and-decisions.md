# Scope & Decisions — LinkUp MVP

**Goal:** a working, demo-able MVP in **10 working days** with a team of 4, which proves the core claim of the report:

> *Users collaborate in one workspace while the person responsible for the session controls what each participant may access or do.* (Report §3)

---

## 1. Priority legend

| Tag | Meaning |
|-----|---------|
| **P0** | Must ship for the demo. If a P0 slips, cut a P1 instead. |
| **P1** | Should ship if Day 8 checkpoint is green. |
| **P2** | Post-MVP. Do not start in the 10 days. |

## 2. Scope matrix (mapped to report FR IDs)

| Report FR | Feature | Priority | Notes |
|-----------|---------|----------|-------|
| FR-1 | Signup / login (email + password) | P0 | Supabase Auth |
| FR-1 | Role at signup: Teacher / Student | P0 | Self-selected for MVP (see risk R6) |
| FR-1 | Profile (full name) | P0 | Avatar = initials |
| FR-2 | Create room (teacher) | P0 | Name, description, default permissions |
| FR-2 | Join room via 6-char code (student) | P0 | |
| FR-2 | Members list, remove member | P0 | |
| FR-2 | Edit / archive room | P1 | |
| FR-3 | Start / end live session (host) | P0 | One active session per room |
| FR-3 | Audio + video grid | P0 | LiveKit |
| FR-3 | Screen sharing | P0 | LiveKit |
| FR-3 | Room chat (persisted) | P0 | Socket.IO + Postgres |
| FR-3 | Presence (who's online in room) | P0 | |
| FR-4 | Per-student permissions: mic, camera, screen, whiteboard, code | P0 | **Core differentiator** |
| FR-4 | Server-side enforcement (LiveKit grants + API/socket guards) | P0 | Not just UI hiding |
| FR-4 | "Mute all" / bulk permission | P1 | |
| FR-4 | Raise hand → host grants mic | P1 | Great demo moment, ~0.5 day |
| FR-4 | Files permission | P2 | Files module is P2 |
| FR-5 | Shared code editor (Monaco), single editor holder | P0 | Report's own "one at a time" design |
| FR-5 | Run code (Python, JavaScript, C++, Java) | P0 | Piston self-hosted |
| FR-5 | Personal compiler / playground page | P1 | Same `/execute` endpoint, private editor |
| FR-5 | Shared whiteboard, view-only unless permitted | P0 | Excalidraw |
| FR-6 | Attendance (auto join/leave per session) | P0 | Host view per session |
| FR-6 | Attendance CSV export | P1 | |
| FR-6 | Assignments, exams, polls | P2 | |
| FR-7 | Files, recordings, announcements, notifications | P2 | |
| FR-8 | Dashboard: my rooms, live-now badge, join code | P0 | |
| FR-8 | Dashboard: activities, files, notifications widgets | P2 | |

## 3. Explicitly out of the MVP (and why)

| Feature | Reason |
|---------|--------|
| Recording (LiveKit Egress) | Needs S3-compatible output config, storage quotas, retention jobs. Report itself lists it in Future Scope §10.7. |
| Assignments / exams / polls | Pure CRUD — valuable, but doesn't demonstrate the unique idea. Ideal Phase 2 work. |
| File sharing | Same reasoning; also needs storage policies and virus/size limits. |
| Notifications / announcements | Need a notification model + delivery; low demo value. |
| Real-time multi-cursor code editing (Yjs/CRDT) | 2–3 days alone. Single-editor-holder model is what the report specifies anyway. |
| Mobile apps, multi-org | Web only, single tenant. |
| AI assistant | Future scope §10.6. |

## 4. Decisions taken (resolving report inconsistencies)

| # | Report says | Decision | Rationale |
|---|-------------|----------|-----------|
| D1 | Stack table: **Node + Express**. Flows (permission, screen share): **NestJS** guards | **Express + TypeScript** | One framework; Express is faster to onboard. NestJS-style "guards" become Express middleware. |
| D2 | A/V via **raw WebRTC + Socket.IO signaling** (flow) vs **LiveKit** (architecture, recording) | **LiveKit Cloud** (SFU) | Mesh WebRTC degrades beyond ~4–5 users and needs TURN servers. LiveKit gives SFU, TURN, React components, and **server-side permission revocation** (`updateParticipant`) — which is exactly FR-4 enforcement. |
| D3 | Whiteboard: **tldraw** (report flags licence check) | **Excalidraw** (MIT) | tldraw SDK requires a licence key in production (without one the editor stops rendering after ~5 s); the hobby licence is non-commercial, discretionary and keeps a watermark ([tldraw licence key docs](https://tldraw.dev/sdk-features/license-key)). Excalidraw is MIT, has `viewModeEnabled` for read-only, and a simple element-version sync model. |
| D4 | Code execution: **Piston** public API or self-host | **Self-hosted Piston (Docker)** | Per the [Piston README](https://github.com/engineer-man/piston), the public emkc.org API is no longer freely available (since Feb 15, 2026), and keys are not issued for school assignments or individual projects. Fallback: Judge0 CE via RapidAPI free tier. |
| D5 | Shared code: "only permitted users edit, one at a time under teacher control" | **Editor-holder model**: exactly one user holds the pen; host assigns it | Avoids CRDT conflicts; matches report. Requires `can_code` permission to receive the pen. |
| D6 | Data access: "Frontend → Backend → Supabase" | **Backend-only DB access.** RLS **enabled with no policies**; backend uses service-role key | One place for permission logic. Frontend uses Supabase **only for Auth**. |
| D7 | Recording in Flows §7 vs Future Scope §10.7 | **Future scope** | See §3. |
| D8 | Room vs session | **Room = persistent class**; **Session = one live meeting** inside a room | Lets attendance be per-session, chat/code/whiteboard persist per room. |
| D9 | Permissions "per user per room" | Stored on `room_members` row; persist across sessions; new members get room's `default_permissions` | Matches report §9. |
| D10 | Language | **TypeScript** for client + server with a `shared/` package for event/DTO types | Socket event typos are the #1 integration bug; shared types kill them. |

## 5. Assumptions

- A1. Single institution; no multi-tenancy in MVP.
- A2. Max **15 participants per room** for the demo, within the LiveKit Cloud free tier of 100 concurrent connections (see §8 for the minutes budget).
- A3. Teacher is always the room **host** with all permissions; hosts cannot have permissions revoked.
- A4. Desktop Chrome/Edge is the target browser. Firefox best-effort; mobile browsers not tested.
- A5. Code runs are limited to 3 s run time, 64 KB source, 10 runs/min/user.

## 6. Risks & mitigations

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|-----------|
| R1 | Piston needs `--privileged` Docker; may not run on Windows dev laptops | Medium | High | Run Piston once on a shared Linux VPS from Day 1; everyone points `PISTON_URL` there. Fallback Judge0 (RapidAPI). |
| R2 | `getUserMedia` / screen share blocked on non-HTTPS origins | High (for 2-laptop demo) | High | Deploy by Day 9 (HTTPS). Localhost works for single-machine dev (two browser profiles). |
| R3 | LiveKit free tier (5,000 participant-min/mo) runs out during testing | Medium | High | Test with 2–3 profiles, always end test sessions, check usage daily (§8). LiveKit server is open source and can be self-hosted later. |
| R9 | Supabase free project pauses after 7 days of inactivity | Medium | Medium | Wake the project the day before any demo (§8). |
| R4 | Excalidraw sync conflicts / flicker | Medium | Medium | Only permitted users edit; reconcile by element `version`; throttle 100 ms. |
| R5 | Team unfamiliar with WebRTC concepts | Medium | Medium | Use `@livekit/components-react` prebuilt components; Day 1 spike. |
| R6 | Students can self-select "Teacher" at signup | — | Low (MVP) | Accept for demo; P2: invite-only teacher accounts / admin approval. |
| R7 | Scope creep (assignments etc. "just quickly") | High | High | P2 list is frozen until demo is done. |
| R8 | Attendance wrong on refresh/reconnect | Medium | Medium | Reuse open record; 15 s grace timer before closing (see architecture §6.4). |

## 7. Open questions (answer before Day 1 ends)

1. Who is the demo audience (internal mentor, institute, client)? Affects whether deploy is mandatory.
2. Which 4 languages for code execution? Default: **Python, JavaScript, C++, Java**.
3. Is self-selected Teacher role acceptable for the demo? (R6)
4. Where is Piston hosted — a team VPS, or a member's Linux machine?
5. Do we need Hindi/Marathi UI? (Default: English only.)

## 8. Accounts, API keys & cost

**The MVP can be built and demoed for ₹0.** Two accounts need API keys, and both are free with no card required. Prices were checked on 12 Oct 2026 and may change, so re-check them on Day 1.

| Service | Purpose | Key / account needed | Free tier | First paid tier |
|---------|---------|----------------------|-----------|-----------------|
| **Supabase** | Auth + Postgres | Yes: project URL, anon key, service-role key | 500 MB DB, 50k MAU, 1 GB storage, 5 GB egress, 2 projects. **Pauses after 1 week of inactivity** | Pro from $25/mo |
| **LiveKit Cloud** | Audio, video, screen share | Yes: API key + secret (no credit card) | **5,000 participant-min/mo**, 100 concurrent connections, 50 GB downstream | Ship $50/mo (150k min, then $0.0005/min, $0.12/GB) |
| **Piston** | Code execution | No (self-hosted) | Free, open source | — |
| Monaco, Excalidraw, Socket.IO, React, Express, Tailwind | Libraries | No | Free, open source (MIT) | — |
| **Vercel / Netlify** | Frontend hosting | Login only | Hobby plan free | — |
| **VPS** | Backend + Piston (needs Linux Docker, `--privileged`) | Existing VPS | Use the team's existing VPS if available | ~₹400–800/mo otherwise |
| **Domain** | HTTPS for camera/mic on a 2-device demo | Optional | DuckDNS / sslip.io subdomain + Caddy auto-TLS | ~₹800/yr for a `.in` domain |
| GitHub | Repo + Actions CI | Login only | Free (private repos included) | — |

**Budget for LiveKit minutes.** Minutes are counted **per participant**: a 1-hour class with 10 people uses 10 × 60 = 600 min, so the free tier covers about 8 such classes a month. Rules for the 10 days:
- Test with 2–3 browser profiles, not 10
- Always leave test calls; ending a session deletes the LiveKit room
- Track usage on the LiveKit dashboard at each daily stand-up

**Keep Supabase from pausing.** Free projects pause after 7 days without activity. Open the project before the demo, or wake it the day before.

Sources: [LiveKit pricing](https://livekit.com/pricing) · [Supabase pricing](https://supabase.com/pricing) · [Piston README](https://github.com/engineer-man/piston)
