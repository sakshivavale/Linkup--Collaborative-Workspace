# LinkUp — Agile User Stories: RBAC, Teacher Gating, Admin Dashboard & Platform Analytics

**Document Version:** 1.0.0  
**Target Platform:** LinkUp Collaborative Workspace  
**Sprint Scope:** Role-Based Access Control (RBAC), Teacher Approval Gating, Dedicated Admin Dashboard, Platform Analytics & End-to-End Test Suites  
**Team Size:** 4 Software Engineers  

---

## 👥 Team Workload Distribution & Claim Matrix

To streamline execution across the team of 4 engineers, stories are grouped and assigned by functional ownership:

| Team Member | Functional Domain | Assigned Stories | Focus Area |
|:---|:---|:---|:---|
| **Developer 1** | Auth, RBAC & Core Gating | `US-1.1`, `US-2.2` | Multi-role signup, JWT claims, Supabase triggers, Route Guards & Backend Middleware |
| **Developer 2** | Teacher Experience & Room Gating | `US-2.1`, `US-4.1.5` | Pending approval view, room creation gating (`/create-room`), teacher dashboard activation |
| **Developer 3** | Admin Dashboard & Approval Engine | `US-3.1`, `US-3.2` | Platform analytics cards, real-time approval/rejection queue, WebSocket/polling state updates |
| **Developer 4** | User Management & QA Automation | `US-3.3`, `US-3.4`, `US-4.1` (4.1.1–4.1.6) | Direct teacher provisioning modal, user directory with filters/status controls, E2E Cypress/Playwright suites |

---

## Module 1: User Registration & Role Selection

### Story 1.1: Multi-Role Signup Page Selection & Role Provisioning
- **Story ID:** `US-1.1`
- **Priority Level:** High (P0)
- **Story Points (Est.):** 5 SP
- **Assigned Developer:** Developer 1 (Auth & RBAC Lead)

#### User Story Description
> **As a** new user registering on LinkUp,  
> **I want to** select my intended role (`Student`, `Teacher`, or `Admin`) during the registration process,  
> **So that** my account is provisioned with appropriate access permissions and initial approval status according to platform security policies.

#### Detailed Acceptance Criteria (Given-When-Then)

##### Scenario 1: Standard Student Registration with Immediate Auto-Approval
- **Given** an unauthenticated visitor is on the LinkUp registration page (`/signup`)
- **When** the user inputs a valid full name, unique email address (`student@university.edu`), a password satisfying criteria (>= 8 characters), and selects the **"Student"** role card
- **And** clicks the "Create Account" button
- **Then** the system creates a Supabase Auth user record and an associated row in `public.profiles`
- **And** the profile is provisioned with `role = 'STUDENT'` and `isApproved = true`
- **And** the user is automatically logged in and redirected to the Student Home Dashboard (`/`) with an onboarding confirmation toast.

##### Scenario 2: Standard Teacher Registration with Pending Approval State
- **Given** an unauthenticated visitor is on the registration page (`/signup`)
- **When** the user inputs valid account credentials and selects the **"Teacher"** role radio/card
- **And** submits the form
- **Then** the account is created with `role = 'TEACHER'` and `isApproved = false` (`status = 'PENDING_TEACHER'`)
- **And** the user is redirected to a dedicated onboarding notification page or logged in with a persistent banner: *"Your teacher account has been created and is currently awaiting administrator verification."*
- **And** an administrative notification/event is dispatched to the Admin Approval Queue.

##### Scenario 3: Standard Admin Signup Subject to Admin Review
- **Given** a user signs up with a general email address (e.g. `staff@school.org`) and selects the **"Admin"** role
- **When** the signup form is submitted
- **Then** the account is created with `role = 'ADMIN'` and `isApproved = false`
- **And** the user cannot access any `/admin` sub-routes until an existing super-admin manually validates and activates their account.

##### Scenario 4: Super-Admin Hardcoded Auto-Approval Bypass
- **Given** any visitor registers with the pre-designated Super-Admin email: `sakshivavale9@gmail.com` and password `12345678`
- **When** the registration request is submitted to the backend auth endpoint
- **Then** the system matches the hardcoded super-admin identifier
- **And** sets `role = 'ADMIN'` and `isApproved = true` immediately, bypassing the pending queue
- **And** the user is authenticated and redirected directly to the Admin Dashboard (`/admin`) with full administrative privileges.

##### Scenario 5: Input Validation & Duplicate Account Prevention
- **Given** a visitor enters a password shorter than 8 characters or leaves the role unselected
- **When** they attempt to submit the form
- **Then** submission is halted with field-level inline validation messages: *"Password must contain at least 8 characters"* and *"Please choose your role to proceed"*
- **And** if the email is already registered, an error alert displays: *"An account with this email address already exists. Please sign in."*

---

## Module 2: Access Control & Teacher Gating

### Story 2.1: Teacher Feature Protection & Pending Approval Gate
- **Story ID:** `US-2.1`
- **Priority Level:** High (P0)
- **Story Points (Est.):** 5 SP
- **Assigned Developer:** Developer 2 (Teacher Experience Lead)

#### User Story Description
> **As an** unapproved Teacher (`isApproved === false`),  
> **I want to** be clearly informed of my pending verification status when attempting to access restricted teacher tools,  
> **So that** I understand why room creation is locked and when I can expect full platform access.

#### Detailed Acceptance Criteria (Given-When-Then)

##### Scenario 1: Interception of Direct Navigation to Room Creation (`/create-room`)
- **Given** an authenticated user with `role === 'TEACHER'` and `isApproved === false`
- **When** the user enters `/create-room` into the browser address bar or clicks a "Create Room" button
- **Then** the application route guard intercepts navigation
- **And** redirects the user to the dedicated `/pending-approval` route (or renders the `PendingApprovalState` full-page component).

##### Scenario 2: Visual Elements of the "Pending Admin Approval" Screen
- **Given** an unapproved teacher lands on the `/pending-approval` screen
- **Then** the screen renders:
  1. An animated status badge / illustration depicting "Account Under Review".
  2. Clear informational copy: *"Your teacher credentials are being reviewed by the LinkUp administration team. Room creation and classroom moderation tools will activate automatically once approved."*
  3. A "Check Status" / "Refresh" button that queries `GET /api/me` to refresh the session token and profile state without requiring a full re-login.
  4. A "Return to Student View" button allowing the teacher to join existing rooms as a participant in the interim.
  5. An administrator contact support link (`support@linkup.internal`).

##### Scenario 3: Backend API Enforcement for Room Creation
- **Given** an unapproved teacher bypasses client routing and issues a `POST /api/rooms` request with a valid JWT
- **When** the request reaches the server's room creation controller
- **Then** the server verifies the user's database record
- **And** aborts the transaction with `HTTP 403 Forbidden`
- **And** returns a standardized JSON payload:
  ```json
  {
    "statusCode": 403,
    "error": "TEACHER_NOT_APPROVED",
    "message": "Your teacher account is pending administrator verification. Room creation is disabled."
  }
  ```

---

### Story 2.2: Administrative Route Guarding & RBAC Middleware
- **Story ID:** `US-2.2`
- **Priority Level:** High (P0)
- **Story Points (Est.):** 5 SP
- **Assigned Developer:** Developer 1 (Auth & RBAC Lead)

#### User Story Description
> **As the** LinkUp Platform Security Lead,  
> **I want to** enforce strict client-side route guarding and server-side middleware for all `/admin` routes and administrative APIs,  
> **So that** only authenticated users with verified `role === 'ADMIN'` and `isApproved === true` can view administrative tools and mutate platform settings.

#### Detailed Acceptance Criteria (Given-When-Then)

##### Scenario 1: Non-Admin Access Attempt to `/admin` Web Routes
- **Given** an authenticated user with `role === 'STUDENT'` or `role === 'TEACHER'`
- **When** the user manually navigates to `/admin`, `/admin/users`, or `/admin/approvals`
- **Then** the `<AdminRouteGuard>` client component detects an unauthorized role
- **And** immediately redirects the user to the default home screen (`/`)
- **And** triggers a security toast alert: *"Access Denied: Administrator privileges required."*

##### Scenario 2: Unauthenticated Visitor Access Attempt to Admin Routes
- **Given** a visitor with no active session or expired JWT token
- **When** navigating to any `/admin/*` path
- **Then** the route guard redirects the user to `/login?redirect=/admin`
- **And** preserves the target path for post-login redirection if valid admin credentials are later supplied.

##### Scenario 3: Backend Administrative API Route Middleware (`requireAdmin`)
- **Given** an HTTP request directed at any endpoint under `/api/admin/*`
- **When** processed by the `requireAdmin` Express middleware
- **Then** the middleware validates the Bearer token, extracts the user ID, and checks `profiles` table:
  - If `user.role !== 'ADMIN'` or `user.isApproved !== true`: responds with `HTTP 403 Forbidden` (`{ "error": "FORBIDDEN_ADMIN_ONLY" }`).
  - If no token or invalid token: responds with `HTTP 401 Unauthorized` (`{ "error": "UNAUTHORIZED" }`).
  - If `user.role === 'ADMIN'` and `user.isApproved === true`: attaches `req.user` and calls `next()`.

---

## Module 3: Dedicated Admin Dashboard & User Management

### Story 3.1: Platform Analytics Overview
- **Story ID:** `US-3.1`
- **Priority Level:** Medium (P1)
- **Story Points (Est.):** 5 SP
- **Assigned Developer:** Developer 3 (Admin Dashboard Lead)

#### User Story Description
> **As an** approved Administrator,  
> **I want to** view key real-time metric cards on the Admin Dashboard landing page,  
> **So that** I have instant visibility into overall user adoption, pending operational bottlenecks, and active room capacity.

#### Detailed Acceptance Criteria (Given-When-Then)

##### Scenario 1: Metrics Cards Rendering & Data Accuracy
- **Given** an approved Admin logs in and opens `/admin`
- **When** the dashboard statistics component loads
- **Then** the system queries `GET /api/admin/analytics/overview` and populates 5 distinct KPI cards:
  1. **Total Users:** Count of all registered profiles across all roles.
  2. **Active Students:** Total count of users where `role === 'STUDENT'`.
  3. **Approved Teachers:** Count of teachers where `role === 'TEACHER'` AND `isApproved === true`.
  4. **Pending Approvals:** Total count of unapproved accounts (`isApproved === false`) requiring review.
  5. **Active Rooms:** Real-time count of currently open/live collaborative workspaces.

##### Scenario 2: Dynamic Highlight of Pending Queue Urgency
- **Given** there are one or more accounts where `isApproved === false`
- **When** the Admin views the **Pending Approvals** card
- **Then** the card displays an alert badge (e.g. amber badge with the count `X Pending Review`) and includes a direct link button: *"Review Queue →"*.
- **And** if pending count is 0, the card shows a green checkmark icon: *"All Caught Up"*.

##### Scenario 3: Periodic Auto-Refresh & Loading Resilience
- **Given** the Admin leaves the dashboard open during active platform operations
- **When** a background poll triggers every 30 seconds (or on WebSocket push event)
- **Then** the counters update smoothly without page reloading or UI flickering
- **And** if the analytics API fails, a retry banner displays with cached values clearly marked.

---

### Story 3.2: Teacher Approval Queue & Real-Time Action Processing
- **Story ID:** `US-3.2`
- **Priority Level:** High (P0)
- **Story Points (Est.):** 5 SP
- **Assigned Developer:** Developer 3 (Admin Dashboard Lead)

#### User Story Description
> **As an** approved Administrator,  
> **I want to** review a dedicated list of pending teacher applications with instantaneous "Approve" and "Reject" controls,  
> **So that** legitimate instructors are quickly unlocked to conduct classes while fraudulent or unverified accounts are prevented from hosting rooms.

#### Detailed Acceptance Criteria (Given-When-Then)

##### Scenario 1: Pending Queue Display & Applicant Details
- **Given** an Admin is on the "Teacher Approvals" tab (`/admin/approvals`)
- **When** the queue renders
- **Then** all users matching `isApproved === false` and `role === 'TEACHER'` are displayed in a responsive table/card list
- **And** each row displays: Full Name, Email Address, Registration Timestamp, Requested Subject/Notes (if provided), and Action buttons ("Approve" in green, "Reject" in red).

##### Scenario 2: Admin Approves a Teacher Application
- **Given** a pending teacher row in the queue (e.g. `teacher.jane@school.edu`)
- **When** the Admin clicks the **"Approve"** button
- **Then** an optimistic loading spinner appears on the action button
- **And** a `PATCH /api/admin/users/:userId/approval` request is sent with payload `{ "isApproved": true, "status": "APPROVED" }`
- **And** the database record is updated to `isApproved = true`
- **And** the row is removed from the pending queue with a success notification: *"Teacher Jane has been approved successfully."*
- **And** the teacher's active session is updated so that room creation (`/create-room`) is immediately accessible without logging out.

##### Scenario 3: Admin Rejects a Teacher Application
- **Given** an unverified or invalid teacher signup in the queue
- **When** the Admin clicks the **"Reject"** button
- **Then** a confirmation dialog opens prompting for optional rejection feedback (e.g., *"Invalid educational domain"* or *"Incomplete profile"*)
- **When** confirmed, the system sets `isApproved = false` and `status = 'REJECTED'`
- **And** updates the user record accordingly, preventing room creation
- **And** decrements the pending queue counter immediately.

---

### Story 3.3: Direct "+ Add Teacher" Pre-Approved Provisioning
- **Story ID:** `US-3.3`
- **Priority Level:** Medium (P1)
- **Story Points (Est.):** 3 SP
- **Assigned Developer:** Developer 4 (User Management Lead)

#### User Story Description
> **As an** approved Administrator,  
> **I want to** manually provision pre-approved teacher accounts through a direct "+ Add Teacher" modal,  
> **So that** verified faculty members can be onboarded immediately without having to wait in the approval queue.

#### Detailed Acceptance Criteria (Given-When-Then)

##### Scenario 1: "+ Add Teacher" Modal Trigger and Form Fields
- **Given** an Admin is on the Admin Dashboard or User Directory page
- **When** they click the primary action button labeled **"+ Add Teacher"**
- **Then** a modal opens with fields:
  - Full Name (required)
  - Institutional Email (required)
  - Temporary Password (required, auto-generated secure password suggested with copy button)
  - Department / Subject (optional)
  - Checkbox: "Pre-approve immediately" (checked by default).

##### Scenario 2: Successful Pre-Approved Teacher Creation
- **Given** the Admin completes the form with valid data and leaves "Pre-approve immediately" checked
- **When** they click "Create Teacher Account"
- **Then** the backend endpoint `POST /api/admin/teachers/provision` is called
- **And** creates the account in Supabase Auth and inserts into `profiles` with:
  `role: 'TEACHER'`, `isApproved: true`, `status: 'APPROVED'`
- **And** closes the modal, refreshes the user directory, and displays a success alert with the temporary credentials: *"Teacher account created and pre-approved. Credentials ready to share."*

##### Scenario 3: Handling Duplicate Email in Provisioning
- **Given** the Admin enters an email that is already registered in LinkUp
- **When** the form is submitted
- **Then** the modal stays open and an inline error highlights the email field: *"A user with this email address already exists in the system."*

---

### Story 3.4: Platform User Directory, Search, Filter & Role/Status Control
- **Story ID:** `US-3.4`
- **Priority Level:** Medium (P1)
- **Story Points (Est.):** 5 SP
- **Assigned Developer:** Developer 4 (User Management Lead)

#### User Story Description
> **As an** approved Administrator,  
> **I want to** search, filter, inspect, and modify the roles and account statuses of all users in the system,  
> **So that** I can easily maintain institutional governance, handle role transitions, and suspend abusive users.

#### Detailed Acceptance Criteria (Given-When-Then)

##### Scenario 1: Search and Multi-Criteria Filtering
- **Given** an Admin is viewing the User Directory (`/admin/users`)
- **When** the Admin types a query into the search box (e.g. `"sakshi"` or `"@stanford.edu"`)
- **Then** the list filters in real time (debounced at 300ms) matching name or email
- **And** when selecting filter pills:
  - **Role Filter:** All / Student / Teacher / Admin
  - **Status Filter:** All / Approved / Pending Approval / Suspended
- **Then** the grid updates to show only records matching all active criteria.

##### Scenario 2: Dynamic Role Modification
- **Given** an existing user currently assigned as `role: 'STUDENT'`
- **When** the Admin clicks the user's action menu and selects **"Change Role" -> "Teacher"**
- **Then** a confirmation dialog opens: *"Are you sure you want to promote [User Name] to Teacher? This will grant room creation privileges."*
- **When** confirmed, a `PATCH /api/admin/users/:userId/role` request updates the user's role to `'TEACHER'` and sets `isApproved = true`
- **And** the updated role badge is immediately reflected in the directory.

##### Scenario 3: Account Suspension and Privilege Revocation
- **Given** an active user exhibiting disruptive behavior
- **When** the Admin selects **"Suspend Account"** from the user action menu
- **Then** the system updates the profile's `isSuspended = true`
- **And** revokes all active session tokens on the backend
- **And** if the user attempts any subsequent authenticated API request, the server responds with `HTTP 403 Forbidden` (`{ "error": "ACCOUNT_SUSPENDED" }`)
- **And** redirects them to an account suspension notice upon their next action.

---

## Module 4: Team Collaboration & End-to-End Test Scenarios

### Story 4.1: Automated End-to-End Validation Suite
- **Story ID:** `US-4.1`
- **Priority Level:** High (P0)
- **Story Points (Est.):** 8 SP
- **Assigned Developer:** Developer 4 (Lead QA & Integration Specialist) + All Devs

#### User Story Description
> **As the** LinkUp Engineering Team,  
> **We want** an automated End-to-End (E2E) integration test suite validating all core authentication, approval gating, and administrative access paths,  
> **So that** regressions are caught before code is merged into main and deployed to staging or production.

---

### Sub-Story 4.1.1: E2E Test — Student Registration & Immediate Platform Access
- **Test ID:** `E2E-STUDENT-REG`
- **Test Suite:** `cypress/e2e/auth-student.cy.ts` or `playwright/auth-student.spec.ts`

```gherkin
Feature: Student Registration Lifecycle
  Scenario: Student signs up and verifies instant room joining access
    Given the browser navigates to "/signup"
    When the user fills the registration form:
      | Field     | Value                        |
      | fullName  | Alex Student                 |
      | email     | alex.student.test@linkup.io  |
      | password  | StrongPass123!               |
      | role      | Student                      |
    And clicks "Create Account"
    Then the user should be redirected to "/"
    And a welcome banner "Welcome, Alex Student" should be visible
    And the database record for "alex.student.test@linkup.io" should have:
      | column     | expected_value |
      | role       | STUDENT        |
      | isApproved | true           |
    And the user should see the "Join Room" input field active and functional.
```

---

### Sub-Story 4.1.2: E2E Test — Teacher Registration & Pending Gating Screen
- **Test ID:** `E2E-TEACHER-GATING`
- **Test Suite:** `cypress/e2e/teacher-gating.cy.ts`

```gherkin
Feature: Teacher Registration & Feature Gating
  Scenario: New teacher is blocked from room creation until approved
    Given the browser navigates to "/signup"
    When the user registers with:
      | Field     | Value                         |
      | fullName  | Prof. Marcus Test            |
      | email     | prof.marcus.test@linkup.io   |
      | password  | StrongPass123!               |
      | role      | Teacher                      |
    And clicks "Create Account"
    Then the database record should have:
      | column     | expected_value   |
      | role       | TEACHER          |
      | isApproved | false            |
      | status     | PENDING_TEACHER  |
    When the user directly navigates to "/create-room"
    Then the browser URL should change to "/pending-approval"
    And the page must display "Your teacher credentials are being reviewed"
    And the "Create Room" submission form must not be present in the DOM.
```

---

### Sub-Story 4.1.3: E2E Test — Super-Admin Pre-Seeded Hardcoded Access
- **Test ID:** `E2E-ADMIN-SUPER`
- **Test Suite:** `cypress/e2e/admin-super-seed.cy.ts`

```gherkin
Feature: Hardcoded Super-Admin Auto-Provisioning
  Scenario: System auto-approves designated super-admin email
    Given the browser navigates to "/signup"
    When the user registers with:
      | Field     | Value                   |
      | fullName  | Sakshi Vavale           |
      | email     | sakshivavale9@gmail.com |
      | password  | 12345678                |
      | role      | Admin                   |
    And submits the registration
    Then the database profile should immediately have:
      | column     | expected_value |
      | role       | ADMIN          |
      | isApproved | true           |
    When the user accesses "/admin"
    Then the Admin Dashboard renders without redirection
    And the platform analytics cards should be visible.
```

---

### Sub-Story 4.1.4: E2E Test — Admin Approval Execution
- **Test ID:** `E2E-ADMIN-APPROVAL-FLOW`
- **Test Suite:** `cypress/e2e/admin-approval-flow.cy.ts`

```gherkin
Feature: Administrative Approval Flow
  Scenario: Admin approves pending teacher and updates their live capability
    Given an existing user "prof.marcus.test@linkup.io" with "isApproved = false"
    And the Super-Admin "sakshivavale9@gmail.com" is logged in on session A
    When the Admin navigates to "/admin/approvals"
    Then the queue should contain "Prof. Marcus Test"
    When the Admin clicks the "Approve" button on Marcus's record
    Then the record should disappear from the pending list
    And a notification "Teacher Marcus approved" should appear
    And in the database, Marcus's profile should have:
      | column     | expected_value |
      | isApproved | true           |
      | status     | APPROVED       |
```

---

### Sub-Story 4.1.5: E2E Test — Post-Approval Teacher Room Creation
- **Test ID:** `E2E-TEACHER-POST-APPROVAL`
- **Test Suite:** `cypress/e2e/teacher-room-creation.cy.ts`

```gherkin
Feature: Post-Approval Classroom Hosting
  Scenario: Approved teacher successfully creates a live collaborative room
    Given teacher "prof.marcus.test@linkup.io" has been approved ("isApproved = true")
    And logs in to LinkUp
    When navigating to "/create-room"
    Then the room creation form should load successfully
    When the teacher fills:
      | Field            | Value                         |
      | roomName         | Advanced Algorithms 101       |
      | description      | Live collaborative session    |
    And clicks "Launch Room"
    Then a new room is created with a unique 6-character join code
    And the browser redirects to "/room/:roomId"
    And the teacher is granted "host" member privileges in WebRTC/Socket session.
```

---

### Sub-Story 4.1.6: E2E Test — Non-Admin Blocking & Security Route Guards
- **Test ID:** `E2E-SECURITY-ROUTE-GUARDS`
- **Test Suite:** `cypress/e2e/security-guards.cy.ts`

```gherkin
Feature: RBAC Route Guarding & Intrusions Prevention
  Scenario Outline: Unauthorized roles cannot access administrative endpoints
    Given an authenticated user logged in with "<Role>" and approval "<IsApproved>"
    When the user attempts to browse to "<TargetRoute>"
    Then the user should be redirected to "/"
    And a toast error "Access Denied: Administrator privileges required" should display
    When an automated HTTP GET is sent to "<AdminApi>" with the user's JWT
    Then the response status code should be 403

    Examples:
      | Role    | IsApproved | TargetRoute       | AdminApi                    |
      | STUDENT | true       | /admin            | /api/admin/analytics/overview|
      | STUDENT | true       | /admin/users      | /api/admin/users            |
      | TEACHER | true       | /admin            | /api/admin/analytics/overview|
      | TEACHER | false      | /admin/approvals  | /api/admin/approvals        |
      | ADMIN   | false      | /admin            | /api/admin/analytics/overview|
```

---

## 🛠️ Technical Implementation Checklist for Sprint Execution

### Database Schema Updates (`supabase/migrations/`)
- [ ] Add `isApproved` (boolean, default false for teacher/admin, true for student).
- [ ] Add `status` enum (`PENDING_TEACHER`, `APPROVED`, `REJECTED`, `NONE`).
- [ ] Add `isSuspended` (boolean, default false).
- [ ] Create Supabase Auth trigger / function for auto-approving `sakshivavale9@gmail.com` with `ADMIN` role.

### Backend Services (`server/src/`)
- [ ] Update `auth.middleware.ts` to export `requireAdmin` and `requireApprovedTeacher`.
- [ ] Implement `GET /api/admin/analytics/overview` returning counts for Users, Students, Approved Teachers, Pending Approvals, Active Rooms.
- [ ] Implement `GET /api/admin/approvals/pending` and `PATCH /api/admin/users/:id/approval`.
- [ ] Implement `POST /api/admin/teachers/provision` for direct pre-approved teacher invites.
- [ ] Implement `GET /api/admin/users` with query filters (`search`, `role`, `status`) and `PATCH /api/admin/users/:id/role`.

### Frontend Applications (`client/src/`)
- [ ] Update `SignUp.tsx` with role selection cards (Student, Teacher, Admin).
- [ ] Create `AdminRoute.tsx` and `TeacherRoute.tsx` guarding components.
- [ ] Build `/pending-approval` notification screen with status polling.
- [ ] Build `/admin` dashboard overview with the 5 real-time KPI cards.
- [ ] Build `/admin/approvals` queue with Approve/Reject actions.
- [ ] Build `/admin/users` table with search, role filter, status toggle, and "+ Add Teacher" modal.
- [ ] Configure CI/CD pipeline to execute Cypress/Playwright E2E validation suites on Pull Requests.
