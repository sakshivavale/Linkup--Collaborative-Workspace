# LinkUp — MVP Documentation

> A collaborative classroom workspace: live video, chat, screen share, whiteboard and a shared code editor with code execution, under **one teacher-controlled permission model**.

Source: `LinkUp_Report.pdf` (Phase 1 report, v1.0, Oct 2026 — team: Sejal Naik, Sakshi, Siddhi, Harsh).
These documents turn that report into a buildable **10-day MVP**.

---

## The idea in 30 seconds

Teachers and students currently juggle Meet/Teams (video), WhatsApp (chat), Replit/OnlineGDB (code), Miro/Jamboard (whiteboard) and Classroom (assignments). Each tool has its own permissions, and the teacher has no single place to control what students can do.

**LinkUp = one room, many tools, one permission panel.**

```
Teacher clicks "Allow code" for Priya
   → Priya's editor unlocks in < 1 s
   → everyone else stays read-only
   → server rejects edits from anyone else
```

The **unique demo moment** is the permission model working across media + whiteboard + code, enforced server-side.

---

## Documents

| # | File | What it answers |
|---|------|-----------------|
| 0 | [PROJECT_DOCUMENTATION.md](./PROJECT_DOCUMENTATION.md) | **Master Project Document**: High-level idea, implementation details, APIs & sources, feature breakdown, architecture, and future scope |
| 1 | [scope-and-decisions.md](./scope-and-decisions.md) | What's in/out of the MVP, decisions taken, report inconsistencies, risks, open questions |
| 2 | [frd.md](./frd.md) | Functional requirements, user stories, acceptance criteria, screens |
| 3 | [architecture.md](./architecture.md) | Components, flows, permission enforcement, folder structure, env, deployment |
| 4 | [database.md](./database.md) | Tables, SQL migration, indexes, RLS approach |
| 5 | [api-contract.md](./api-contract.md) | REST endpoints + Socket.IO events (the contract between frontend & backend) |
| 6 | [implementation-plan.md](./implementation-plan.md) | Day-by-day phases, per-dev tracks, checklists, DoD, demo script |

Recommended reading order for the team: **PROJECT_DOCUMENTATION → README → scope → frd → architecture → api-contract → database → plan**.

---

## MVP at a glance

| Area | MVP (10 days) | Later |
|------|---------------|-------|
| Users | Email/password signup, Teacher/Student role, profile name | Orgs, departments, SSO |
| Rooms | Create (teacher), join via code, members list, remove member | Archive, multiple hosts, co-teachers |
| Live session | Audio, video, screen share (LiveKit), start/end session | Recording, breakout rooms |
| Chat | Room chat, persisted, history | Reactions, files in chat, DMs |
| Permissions | Per-student mic / camera / screen / whiteboard / code, live, server-enforced | Files permission, role templates |
| Code | Shared Monaco editor (single editor holder), Run via Piston, 4 languages | CRDT co-editing, personal workspaces per student |
| Whiteboard | Shared Excalidraw, view-only unless permitted, snapshot saved | Templates, pages, export |
| Attendance | Auto join/leave per session, host view | Reports, analytics |
| Academic | — | Assignments, exams, polls |
| Resources | — | File sharing, recordings, announcements, notifications |

## Cost

The MVP can be built for **₹0**. Supabase and LiveKit Cloud need free API keys; everything else is open source or self-hosted. The main limit is LiveKit's 5,000 participant-minutes a month. See [scope-and-decisions.md §8](./scope-and-decisions.md#8-accounts-api-keys--cost).

## Tech stack (MVP)

React 18 + Vite + TypeScript + Tailwind · Express + Socket.IO (TypeScript) · Supabase (Auth + Postgres) · LiveKit Cloud (media) · Excalidraw (whiteboard) · Monaco (editor) · Piston self-hosted (code execution)
