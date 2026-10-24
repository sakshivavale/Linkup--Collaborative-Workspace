const https = require('https');

const REPO = 'sakshivavale/Linkup--Collaborative-Workspace';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error('Error: GH_TOKEN or GITHUB_TOKEN environment variable not set.');
  process.exit(1);
}

const issues = [
  // --- MODULE 1 ---
  {
    title: 'US-1.1: Multi-Role Signup Page Selection & Role Provisioning',
    labels: ['user-story', 'P0', 'area:auth'],
    body: `## US-1.1 — Multi-Role Signup Page Selection & Role Provisioning
**Module:** User Registration & Role Selection  
**Priority:** P0 | **Story Points:** 5 SP  
**Assigned:** Developer 1 (Auth & RBAC Lead)

### User Story Description
> **As a** new visitor registering on LinkUp,  
> **I want to** select my intended role (\`Student\`, \`Teacher\`, or \`Admin\`) during the registration process,  
> **So that** my account is provisioned with appropriate access permissions and initial approval status according to platform security policies.

### Acceptance Criteria (Given-When-Then)

- [ ] **AC 1.1.1 — Student Auto-Approval:**
  - **Given** an unauthenticated visitor is on the LinkUp registration page (\`/signup\`)
  - **When** the user inputs a valid full name, unique email address, a password (>= 8 characters), and selects the **"Student"** role card
  - **And** submits the form
  - **Then** the system creates a Supabase Auth user record and an associated row in \`public.profiles\` with \`role = 'STUDENT'\` and \`isApproved = true\`
  - **And** the user is automatically logged in and redirected to the Student Dashboard (\`/\`).

- [ ] **AC 1.1.2 — Teacher Registration with Pending Approval State:**
  - **Given** an unauthenticated visitor is on the registration page (\`/signup\`)
  - **When** the user inputs valid account credentials and selects the **"Teacher"** role
  - **And** submits the form
  - **Then** the account is created with \`role = 'TEACHER'\`, \`isApproved = false\`, and \`status = 'PENDING_TEACHER'\`
  - **And** the user is informed with a persistent notification banner: *"Your teacher account has been created and is currently awaiting administrator verification."*

- [ ] **AC 1.1.3 — Standard Admin Signup Subject to Review:**
  - **Given** a user registers with a standard email and selects the **"Admin"** role
  - **When** the form is submitted
  - **Then** the account is created with \`role = 'ADMIN'\` and \`isApproved = false\`
  - **And** administrative features remain locked until an existing super-admin validates the account.

- [ ] **AC 1.1.4 — Super-Admin Hardcoded Auto-Approval Bypass:**
  - **Given** a user registers with the pre-designated Super-Admin email: \`sakshivavale9@gmail.com\` and password \`12345678\`
  - **When** the registration request is submitted
  - **Then** the system matches the hardcoded super-admin identifier and immediately provisions \`role = 'ADMIN'\` and \`isApproved = true\`
  - **And** the user is authenticated and granted full administrative access to \`/admin\`.

- [ ] **AC 1.1.5 — Validation & Duplicate Account Prevention:**
  - **Given** a password shorter than 8 characters or an unselected role
  - **When** the user attempts to submit
  - **Then** submission is halted with inline validation errors.
  - **And** if the email already exists, an alert informs: *"An account with this email address already exists. Please sign in."*

---
*Created from [agile-user-stories-rbac-admin.md](https://github.com/${REPO}/blob/main/docs/agile-user-stories-rbac-admin.md)*`
  },

  // --- MODULE 2 ---
  {
    title: 'US-2.1: Teacher Feature Protection & Pending Approval Gate',
    labels: ['user-story', 'P0', 'area:room'],
    body: `## US-2.1 — Teacher Feature Protection & Pending Approval Gate
**Module:** Access Control & Teacher Gating  
**Priority:** P0 | **Story Points:** 5 SP  
**Assigned:** Developer 2 (Teacher Experience Lead)

### User Story Description
> **As an** unapproved Teacher (\`isApproved === false\`),  
> **I want to** be clearly informed of my pending verification status when attempting to access restricted teacher tools,  
> **So that** I understand why room creation is locked and when I can expect full platform access.

### Acceptance Criteria (Given-When-Then)

- [ ] **AC 2.1.1 — Interception of Navigation to Room Creation (\`/create-room\`):**
  - **Given** an authenticated user with \`role === 'TEACHER'\` and \`isApproved === false\`
  - **When** the user attempts to visit \`/create-room\` or clicks "Create Room"
  - **Then** the application route guard intercepts navigation and redirects to \`/pending-approval\`.

- [ ] **AC 2.1.2 — Visual Elements of "Pending Admin Approval" Screen:**
  - **Given** an unapproved teacher lands on \`/pending-approval\`
  - **Then** the screen renders:
    1. An animated status badge / illustration depicting "Account Under Review".
    2. Informational copy stating room creation will activate once verified by an admin.
    3. A "Check Status / Refresh" button that queries \`GET /api/me\` without requiring a full re-login.
    4. A "Join Room as Participant" secondary action button.
    5. An administrative contact email link (\`support@linkup.internal\`).

- [ ] **AC 2.1.3 — Server-Side API Enforcement (\`POST /api/rooms\`):**
  - **Given** an unapproved teacher issues a \`POST /api/rooms\` request with a valid JWT
  - **When** processed by the room creation controller
  - **Then** the server aborts the transaction with \`HTTP 403 Forbidden\`
  - **And** returns a standardized JSON payload:
    \`\`\`json
    {
      "statusCode": 403,
      "error": "TEACHER_NOT_APPROVED",
      "message": "Your teacher account is pending administrator verification. Room creation is disabled."
    }
    \`\`\`

---
*Created from [agile-user-stories-rbac-admin.md](https://github.com/${REPO}/blob/main/docs/agile-user-stories-rbac-admin.md)*`
  },

  {
    title: 'US-2.2: Administrative Route Guarding & RBAC Middleware',
    labels: ['user-story', 'P0', 'area:auth', 'area:sec', 'area:admin'],
    body: `## US-2.2 — Administrative Route Guarding & RBAC Middleware
**Module:** Access Control & Teacher Gating  
**Priority:** P0 | **Story Points:** 5 SP  
**Assigned:** Developer 1 (Auth & RBAC Lead)

### User Story Description
> **As the** LinkUp Platform Security Lead,  
> **I want to** enforce strict client-side route guarding and server-side middleware for all \`/admin\` routes and administrative APIs,  
> **So that** only authenticated users with verified \`role === 'ADMIN'\` and \`isApproved === true\` can view administrative tools and mutate platform settings.

### Acceptance Criteria (Given-When-Then)

- [ ] **AC 2.2.1 — Non-Admin Navigation Attempt to \`/admin\` Web Routes:**
  - **Given** an authenticated user with \`role === 'STUDENT'\` or \`role === 'TEACHER'\`
  - **When** the user manually navigates to \`/admin\`, \`/admin/users\`, or \`/admin/approvals\`
  - **Then** the \`<AdminRouteGuard>\` component intercepts the route, redirects the user to \`/\`, and shows a toast: *"Access Denied: Administrator privileges required."*

- [ ] **AC 2.2.2 — Unauthenticated Visitor Access Attempt:**
  - **Given** an unauthenticated visitor
  - **When** navigating to any \`/admin/*\` path
  - **Then** the route guard redirects them to \`/login?redirect=/admin\`.

- [ ] **AC 2.2.3 — Backend Administrative API Route Middleware (\`requireAdmin\`):**
  - **Given** an HTTP request directed at any endpoint under \`/api/admin/*\`
  - **When** processed by \`requireAdmin\` Express middleware
  - **Then** it validates the Bearer token and checks the \`profiles\` table:
    - If \`user.role !== 'ADMIN'\` or \`user.isApproved !== true\`: responds with \`HTTP 403 Forbidden\` (\`{ "error": "FORBIDDEN_ADMIN_ONLY" }\`).
    - If token is missing or invalid: responds with \`HTTP 401 Unauthorized\`.
    - If valid admin: attaches \`req.user\` and calls \`next()\`.

---
*Created from [agile-user-stories-rbac-admin.md](https://github.com/${REPO}/blob/main/docs/agile-user-stories-rbac-admin.md)*`
  },

  // --- MODULE 3 ---
  {
    title: 'US-3.1: Platform Analytics Overview',
    labels: ['user-story', 'P1', 'area:dash', 'area:admin'],
    body: `## US-3.1 — Platform Analytics Overview
**Module:** Dedicated Admin Dashboard & User Management  
**Priority:** P1 | **Story Points:** 5 SP  
**Assigned:** Developer 3 (Admin Dashboard Lead)

### User Story Description
> **As an** approved Administrator,  
> **I want to** view key real-time metric cards on the Admin Dashboard landing page,  
> **So that** I have instant visibility into overall user adoption, pending operational bottlenecks, and active room capacity.

### Acceptance Criteria (Given-When-Then)

- [ ] **AC 3.1.1 — Metrics Cards Rendering & Data Accuracy:**
  - **Given** an approved Admin logs in and opens \`/admin\`
  - **When** the dashboard statistics component loads
  - **Then** the system queries \`GET /api/admin/analytics/overview\` and populates 5 distinct KPI cards:
    1. **Total Users:** Count of all registered profiles across all roles.
    2. **Active Students:** Total count of users where \`role === 'STUDENT'\`.
    3. **Approved Teachers:** Count of teachers where \`role === 'TEACHER'\` AND \`isApproved === true\`.
    4. **Pending Approvals:** Total count of unapproved accounts (\`isApproved === false\`).
    5. **Active Rooms:** Real-time count of currently open/live collaborative workspaces.

- [ ] **AC 3.1.2 — Dynamic Highlight of Pending Queue Urgency:**
  - **Given** there are one or more accounts where \`isApproved === false\`
  - **When** viewing the **Pending Approvals** card
  - **Then** it displays an amber badge with count and direct link: *"Review Queue →"*.
  - **And** if pending count is 0, the card shows a green checkmark icon: *"All Caught Up"*.

- [ ] **AC 3.1.3 — Periodic Auto-Refresh & Loading Resilience:**
  - **Given** the Admin leaves the dashboard open
  - **When** a background poll triggers every 30 seconds (or on WebSocket push event)
  - **Then** counters update smoothly without page reloading or UI flickering.

---
*Created from [agile-user-stories-rbac-admin.md](https://github.com/${REPO}/blob/main/docs/agile-user-stories-rbac-admin.md)*`
  },

  {
    title: 'US-3.2: Teacher Approval Queue & Real-Time Action Processing',
    labels: ['user-story', 'P0', 'area:dash', 'area:admin'],
    body: `## US-3.2 — Teacher Approval Queue & Real-Time Action Processing
**Module:** Dedicated Admin Dashboard & User Management  
**Priority:** P0 | **Story Points:** 5 SP  
**Assigned:** Developer 3 (Admin Dashboard Lead)

### User Story Description
> **As an** approved Administrator,  
> **I want to** review a dedicated list of pending teacher applications with instantaneous "Approve" and "Reject" controls,  
> **So that** legitimate instructors are quickly unlocked to conduct classes while fraudulent accounts are prevented from hosting rooms.

### Acceptance Criteria (Given-When-Then)

- [ ] **AC 3.2.1 — Pending Queue Display & Applicant Details:**
  - **Given** an Admin is on the "Teacher Approvals" tab (\`/admin/approvals\`)
  - **When** the queue renders
  - **Then** all users matching \`isApproved === false\` and \`role === 'TEACHER'\` are displayed in a responsive table/card list
  - **And** each row displays: Full Name, Email Address, Registration Timestamp, and Action buttons ("Approve" in green, "Reject" in red).

- [ ] **AC 3.2.2 — Admin Approves a Teacher Application:**
  - **Given** a pending teacher row in the queue
  - **When** the Admin clicks the **"Approve"** button
  - **Then** a \`PATCH /api/admin/users/:userId/approval\` request is sent with \`{ "isApproved": true, "status": "APPROVED" }\`
  - **And** the record is updated in the database
  - **And** the row is removed from the pending queue with a success notification
  - **And** the teacher is granted immediate room creation privileges (\`/create-room\`) without requiring a re-login.

- [ ] **AC 3.2.3 — Admin Rejects a Teacher Application:**
  - **Given** an unverified or invalid teacher signup in the queue
  - **When** the Admin clicks the **"Reject"** button
  - **Then** the system updates \`isApproved = false\` and \`status = 'REJECTED'\`
  - **And** decrements the pending queue counter immediately.

---
*Created from [agile-user-stories-rbac-admin.md](https://github.com/${REPO}/blob/main/docs/agile-user-stories-rbac-admin.md)*`
  },

  {
    title: 'US-3.3: Direct "+ Add Teacher" Pre-Approved Provisioning',
    labels: ['user-story', 'P1', 'area:dash', 'area:admin'],
    body: `## US-3.3 — Direct "+ Add Teacher" Pre-Approved Provisioning
**Module:** Dedicated Admin Dashboard & User Management  
**Priority:** P1 | **Story Points:** 3 SP  
**Assigned:** Developer 4 (User Management Lead)

### User Story Description
> **As an** approved Administrator,  
> **I want to** manually provision pre-approved teacher accounts through a direct "+ Add Teacher" modal,  
> **So that** verified faculty members can be onboarded immediately without having to wait in the approval queue.

### Acceptance Criteria (Given-When-Then)

- [ ] **AC 3.3.1 — "+ Add Teacher" Modal Trigger and Form Fields:**
  - **Given** an Admin is on the Admin Dashboard or User Directory page
  - **When** they click the button labeled **"+ Add Teacher"**
  - **Then** a modal opens with fields: Full Name (required), Institutional Email (required), Temporary Password (with generate/copy helper), Department (optional), and Checkbox: "Pre-approve immediately" (checked by default).

- [ ] **AC 3.3.2 — Successful Pre-Approved Teacher Creation:**
  - **Given** valid details are entered and "Pre-approve immediately" is checked
  - **When** submitted
  - **Then** the backend endpoint \`POST /api/admin/teachers/provision\` creates the account in Supabase Auth and inserts into \`profiles\` with: \`role: 'TEACHER'\`, \`isApproved: true\`, \`status: 'APPROVED'\`
  - **And** closes the modal, refreshes the directory, and presents the temporary credentials.

- [ ] **AC 3.3.3 — Duplicate Email Handling:**
  - **Given** an email that is already registered
  - **When** submitted
  - **Then** an inline error displays: *"A user with this email address already exists in the system."*

---
*Created from [agile-user-stories-rbac-admin.md](https://github.com/${REPO}/blob/main/docs/agile-user-stories-rbac-admin.md)*`
  },

  {
    title: 'US-3.4: Platform User Directory, Search, Filter & Role/Status Control',
    labels: ['user-story', 'P1', 'area:dash', 'area:admin'],
    body: `## US-3.4 — Platform User Directory, Search, Filter & Role/Status Control
**Module:** Dedicated Admin Dashboard & User Management  
**Priority:** P1 | **Story Points:** 5 SP  
**Assigned:** Developer 4 (User Management Lead)

### User Story Description
> **As an** approved Administrator,  
> **I want to** search, filter, inspect, and modify the roles and account statuses of all users in the system,  
> **So that** I can easily maintain institutional governance, handle role transitions, and suspend abusive users.

### Acceptance Criteria (Given-When-Then)

- [ ] **AC 3.4.1 — Search and Multi-Criteria Filtering:**
  - **Given** an Admin is on the User Directory (\`/admin/users\`)
  - **When** typing into the search box (debounced at 300ms) or selecting Role (Student/Teacher/Admin) and Status (Approved/Pending/Suspended) filters
  - **Then** the directory updates to show only records matching all active criteria.

- [ ] **AC 3.4.2 — Dynamic Role Modification:**
  - **Given** an existing user currently assigned as \`role: 'STUDENT'\`
  - **When** the Admin clicks the user's action menu and selects **"Change Role" -> "Teacher"**
  - **Then** a confirmation dialog opens and updating sends \`PATCH /api/admin/users/:userId/role\` setting \`role = 'TEACHER'\` and \`isApproved = true\`
  - **And** the updated role badge is immediately reflected in the directory.

- [ ] **AC 3.4.3 — Account Suspension and Privilege Revocation:**
  - **Given** an active user exhibiting disruptive behavior
  - **When** the Admin selects **"Suspend Account"**
  - **Then** the profile is set to \`isSuspended = true\`, active sessions are revoked, and subsequent requests return \`HTTP 403 Forbidden\` (\`{ "error": "ACCOUNT_SUSPENDED" }\`).

---
*Created from [agile-user-stories-rbac-admin.md](https://github.com/${REPO}/blob/main/docs/agile-user-stories-rbac-admin.md)*`
  },

  // --- MODULE 4 ---
  {
    title: 'US-4.1: Automated End-to-End Validation Suite',
    labels: ['user-story', 'P0'],
    body: `## US-4.1 — Automated End-to-End Validation Suite
**Module:** Team Collaboration & End-to-End Test Scenarios  
**Priority:** P0 | **Story Points:** 8 SP  
**Assigned:** Developer 4 (Lead QA) & Collaborative Team Effort

### User Story Description
> **As the** LinkUp Engineering Team,  
> **We want** an automated End-to-End (E2E) integration test suite validating all core authentication, approval gating, and administrative access paths,  
> **So that** regressions are caught before code is merged into main and deployed to staging or production.

### Detailed Test Scenarios Covered

- [ ] **4.1.1 E2E Test: Student Registration & Immediate Platform Access** (\`E2E-STUDENT-REG\`)
  - Signs up as student -> verifies \`role = 'STUDENT'\`, \`isApproved = true\` in DB -> redirected to \`/\` -> room join field is active.
- [ ] **4.1.2 E2E Test: Teacher Registration & Pending Gating Screen** (\`E2E-TEACHER-GATING\`)
  - Signs up as teacher -> verifies \`isApproved = false\` -> visits \`/create-room\` -> redirected to \`/pending-approval\` -> create-room form absent from DOM.
- [ ] **4.1.3 E2E Test: Super-Admin Hardcoded Auto-Approval Bypass** (\`E2E-ADMIN-SUPER\`)
  - Signs up with \`sakshivavale9@gmail.com\` & password \`12345678\` -> verifies immediate \`role: ADMIN\` and \`isApproved: true\` -> visits \`/admin\` successfully.
- [ ] **4.1.4 E2E Test: Admin Approval Execution** (\`E2E-ADMIN-APPROVAL-FLOW\`)
  - Admin logs in -> reviews pending teacher in \`/admin/approvals\` -> clicks "Approve" -> DB updates to \`isApproved: true\` and row vanishes from queue.
- [ ] **4.1.5 E2E Test: Post-Approval Teacher Room Creation** (\`E2E-TEACHER-POST-APPROVAL\`)
  - Approved teacher navigates to \`/create-room\` -> creates room -> receives 6-character code -> redirected to \`/room/:id\` with host privileges.
- [ ] **4.1.6 E2E Test: Non-Admin Route & API Blocking (403 Enforcement)** (\`E2E-SECURITY-ROUTE-GUARDS\`)
  - Validates that Student, Unapproved Teacher, and Unapproved Admin visiting \`/admin\` are redirected to \`/\` with access denied toast, and API requests to \`/api/admin/*\` return \`HTTP 403\`.

---
*Created from [agile-user-stories-rbac-admin.md](https://github.com/${REPO}/blob/main/docs/agile-user-stories-rbac-admin.md)*`
  },

  // --- RENDER DEPLOYMENT TASKS ---
  {
    title: 'DEPLOY-01: Configure & Deploy Backend Web Service (linkup-api) on Render',
    labels: ['deployment', 'enhancement'],
    body: `## DEPLOY-01 — Configure & Deploy Backend Web Service (\`linkup-api\`) on Render
**Module:** Cloud Infrastructure & Deployment  
**Traces to:** \`docs/render_deployment_guide.md\` (Step 1)

### Task Description
Deploy the Node.js Express backend web service (\`linkup-api\`) to Render under project \`prj-dbblpeg473hc73cpk70g\`.

### Configuration Checklist
- [ ] **Service Name:** \`linkup-api\`
- [ ] **Root Directory:** Empty (repository root)
- [ ] **Environment:** Node
- [ ] **Build Command:** \`npm install && npm run build --workspace=server\`
- [ ] **Start Command:** \`node server/dist/index.js\`
- [ ] **Plan:** Free
- [ ] **Environment Variables Configured:**
  - \`NODE_ENV\`: \`production\`
  - \`PORT\`: \`10000\`
  - \`SUPABASE_URL\`: \`https://ppqcrvxwlldjsfpfffth.supabase.co\`
  - \`SUPABASE_SERVICE_ROLE_KEY\`: *(from server/.env)*
  - \`CORS_ORIGIN\`: *(to be set after frontend URL generated)*
  - \`PISTON_URL\`: \`http://localhost:2000\`
- [ ] Backend URL copied (e.g. \`https://linkup-api-XXXX.onrender.com\`)
- [ ] Health check verified at \`/health\`

---
*Created from [render_deployment_guide.md](https://github.com/${REPO}/blob/main/docs/render_deployment_guide.md)*`
  },

  {
    title: 'DEPLOY-02: Configure & Deploy Frontend Static Site (linkup-client) on Render',
    labels: ['deployment', 'enhancement'],
    body: `## DEPLOY-02 — Configure & Deploy Frontend Static Site (\`linkup-client\`) on Render
**Module:** Cloud Infrastructure & Deployment  
**Traces to:** \`docs/render_deployment_guide.md\` (Step 2)

### Task Description
Deploy the Vite React frontend static site (\`linkup-client\`) to Render.

### Configuration Checklist
- [ ] **Service Name:** \`linkup-client\`
- [ ] **Root Directory:** Empty (repository root)
- [ ] **Build Command:** \`npm install && npm run build --workspace=client\`
- [ ] **Publish Directory:** \`client/dist\`
- [ ] **Environment Variables Configured:**
  - \`VITE_SUPABASE_URL\`: \`https://ppqcrvxwlldjsfpfffth.supabase.co\`
  - \`VITE_SUPABASE_ANON_KEY\`: *(from client/.env)*
  - \`VITE_API_BASE_URL\`: *(backend Render URL from DEPLOY-01)*
- [ ] **Rewrite Rule for SPA Routing Configured:**
  - Source: \`/*\`
  - Destination: \`/index.html\`
  - Type: Rewrite
- [ ] Frontend URL copied (e.g. \`https://linkup-client-XXXX.onrender.com\`)
- [ ] Landing page verified live

---
*Created from [render_deployment_guide.md](https://github.com/${REPO}/blob/main/docs/render_deployment_guide.md)*`
  },

  {
    title: 'DEPLOY-03: Cross-link Service URLs & Supabase Auth Redirects',
    labels: ['deployment', 'area:auth'],
    body: `## DEPLOY-03 — Cross-link Service URLs & Supabase Auth Redirects
**Module:** Cloud Infrastructure & Deployment  
**Traces to:** \`docs/render_deployment_guide.md\` (Steps 3, 4, 5)

### Task Description
Configure cross-service environment variables, CORS policies, and Supabase Auth redirect URLs to ensure seamless client-backend communication and authentication callbacks.

### Implementation Checklist
- [ ] **Backend CORS Configuration:**
  - Update \`linkup-api\` Environment Variable \`CORS_ORIGIN\` to frontend Render URL (no trailing slash).
  - Trigger backend redeploy.
- [ ] **Frontend API Base URL Verification:**
  - Confirm \`linkup-client\` \`VITE_API_BASE_URL\` points to backend Render URL (no trailing slash).
- [ ] **Supabase Auth Redirect URL Configuration:**
  - Open Supabase Dashboard -> Authentication -> URL Configuration.
  - Add \`https://linkup-client-XXXX.onrender.com/**\` to **Redirect URLs**.
  - Save configuration.
- [ ] **End-to-End Verification:**
  - Test registration, login, session persistence, and API roundtrip on live URL.

---
*Created from [render_deployment_guide.md](https://github.com/${REPO}/blob/main/docs/render_deployment_guide.md)*`
  },

  {
    title: 'DEPLOY-04: Standalone Piston Code Execution Instance Configuration',
    labels: ['deployment', 'area:code'],
    body: `## DEPLOY-04 — Standalone Piston Code Execution Instance Configuration
**Module:** Cloud Infrastructure & Deployment  
**Traces to:** \`docs/render_deployment_guide.md\` (Important Notes, L116)

### Task Description
Configure remote sandboxed code execution for production.
On local development, code runs via \`PISTON_URL=http://localhost:2000\`. On cloud Render, code execution requires a remote or separately deployed Piston instance.

### Implementation Checklist
- [ ] Set up a dedicated container/instance running Piston engine (or connect to hosted Piston endpoint).
- [ ] Ensure execution packages for Python, JavaScript, C++, and Java are installed and accessible.
- [ ] Update \`PISTON_URL\` environment variable on \`linkup-api\` in Render Dashboard.
- [ ] Test code execution from classroom code workspace in live environment.
- [ ] Validate timeout and rate limiting safeguards against sandbox abuse.

---
*Created from [render_deployment_guide.md](https://github.com/${REPO}/blob/main/docs/render_deployment_guide.md)*`
  }
];

function createIssue(issue) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      title: issue.title,
      body: issue.body,
      labels: issue.labels
    });

    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPO}/issues`,
      method: 'POST',
      headers: {
        'User-Agent': 'LinkUp-Sprint-Setup',
        'Authorization': `token ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 201) {
          const json = JSON.parse(data);
          resolve(json);
        } else {
          reject(new Error(`Failed to create issue "${issue.title}": HTTP ${res.statusCode} — ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log(`Creating ${issues.length} GitHub issues on ${REPO}...\\n`);
  const results = [];

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    try {
      const res = await createIssue(issue);
      console.log(`[${i + 1}/${issues.length}] Created #${res.number}: ${res.title}`);
      console.log(`   URL: ${res.html_url}`);
      results.push({ number: res.number, title: res.title, url: res.html_url });
    } catch (err) {
      console.error(`[${i + 1}/${issues.length}] Error creating "${issue.title}":`, err.message);
    }
    // Rate limit safety
    await sleep(1000);
  }

  console.log(`\\nFinished! Successfully created ${results.length} of ${issues.length} issues.`);
}

main();
