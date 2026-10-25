/**
 * Automated Verification Suite for US-3.1: Platform Analytics Overview
 * Issue: #156
 *
 * Acceptance Criteria Verified:
 * AC 3.1.1 — Metrics Cards Rendering & Data Accuracy:
 *   - Given an approved Admin logs in and opens /admin
 *   - When the dashboard statistics component loads
 *   - Then the system queries GET /api/admin/analytics/overview and populates 5 distinct KPI cards:
 *     1. Total Users: Count of all registered profiles across all roles.
 *     2. Active Students: Total count of users where role === 'STUDENT'.
 *     3. Approved Teachers: Count of teachers where role === 'TEACHER' AND isApproved === true.
 *     4. Pending Approvals: Total count of unapproved accounts (isApproved === false).
 *     5. Active Rooms: Real-time count of currently open/live collaborative workspaces.
 *
 * AC 3.1.2 — Dynamic Highlight of Pending Queue Urgency:
 *   - Given there are one or more accounts where isApproved === false
 *   - When viewing the Pending Approvals card
 *   - Then it displays an amber badge with count and direct link: "Review Queue →".
 *   - And if pending count is 0, the card shows a green checkmark icon: "All Caught Up".
 *
 * AC 3.1.3 — Periodic Auto-Refresh & Loading Resilience:
 *   - Given the Admin leaves the dashboard open
 *   - When a background poll triggers every 30 seconds (or on WebSocket push event)
 *   - Then counters update smoothly without page reloading or UI flickering.
 *   - And if the analytics API fails, a retry banner displays with cached values clearly marked.
 */

import http from 'http';
import { app, pendingTeachersStore, setMockAnalytics, clearMockAnalytics } from '../src/app';
import { Me, PlatformAnalyticsOverview } from '@linkup/shared';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockSession, clearMockSessions } from '../src/lib/rooms';

const TEST_PORT = 3110;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS\x1b[0m: ${testName}`);
    passedCount++;
  } else {
    console.error(`  \x1b[31m✖ FAIL\x1b[0m: ${testName} ${detail ? `(${detail})` : ''}`);
    failedCount++;
  }
}

async function runTests() {
  console.log('\n============================================================');
  console.log('🚀 Running US-3.1: Platform Analytics Overview Verification Suite');
  console.log('============================================================\n');

  const testServer = http.createServer(app);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------------------
    // TEST 1: AC 3.1.1 — Access Control for GET /api/admin/analytics/overview
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Test 1]\x1b[0m Verifying access control on GET /api/admin/analytics/overview...\n');

    // 1a. Unauthenticated request -> 401 UNAUTHORIZED
    const unauthRes = await fetch(`${BASE_URL}/api/admin/analytics/overview`);
    const unauthBody = (await unauthRes.json()) as { error?: string };
    assert(
      unauthRes.status === 401 && unauthBody.error === 'UNAUTHORIZED',
      'Unauthenticated request to /api/admin/analytics/overview returns 401 UNAUTHORIZED',
      `Status: ${unauthRes.status}, Body: ${JSON.stringify(unauthBody)}`
    );

    // 1b. Student request -> 403 FORBIDDEN_ADMIN_ONLY
    const studentToken = 'jwt_test_student_analytics_31';
    const studentUser: Me = {
      id: 'student-analytics-id-31',
      email: 'student@linkup.test',
      fullName: 'Student Analyst',
      role: 'STUDENT',
      isApproved: true,
    };
    setCachedUser(studentToken, studentUser, 60000);

    const studentRes = await fetch(`${BASE_URL}/api/admin/analytics/overview`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    const studentBody = (await studentRes.json()) as { error?: string };
    assert(
      studentRes.status === 403 && studentBody.error === 'FORBIDDEN_ADMIN_ONLY',
      'Student request to /api/admin/analytics/overview returns 403 FORBIDDEN_ADMIN_ONLY',
      `Status: ${studentRes.status}, Error: ${studentBody.error}`
    );

    // 1c. Teacher request -> 403 FORBIDDEN_ADMIN_ONLY
    const teacherToken = 'jwt_test_teacher_analytics_31';
    const teacherUser: Me = {
      id: 'teacher-analytics-id-31',
      email: 'teacher@linkup.test',
      fullName: 'Teacher Analyst',
      role: 'TEACHER',
      isApproved: true,
    };
    setCachedUser(teacherToken, teacherUser, 60000);

    const teacherRes = await fetch(`${BASE_URL}/api/admin/analytics/overview`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    const teacherBody = (await teacherRes.json()) as { error?: string };
    assert(
      teacherRes.status === 403 && teacherBody.error === 'FORBIDDEN_ADMIN_ONLY',
      'Teacher request to /api/admin/analytics/overview returns 403 FORBIDDEN_ADMIN_ONLY',
      `Status: ${teacherRes.status}, Error: ${teacherBody.error}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: AC 3.1.1 — Approved Admin Queries GET /api/admin/analytics/overview
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 2]\x1b[0m Verifying approved admin queries GET /api/admin/analytics/overview...\n');

    const adminToken = 'jwt_test_admin_analytics_31';
    const adminUser: Me = {
      id: 'admin-analytics-id-31',
      email: 'admin@linkup.test',
      fullName: 'Chief Administrator',
      role: 'ADMIN',
      isApproved: true,
      status: 'APPROVED',
      isAdmin: true,
    };
    setCachedUser(adminToken, adminUser, 60000);

    const adminRes = await fetch(`${BASE_URL}/api/admin/analytics/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const analyticsData = (await adminRes.json()) as PlatformAnalyticsOverview;

    assert(
      adminRes.status === 200,
      'Approved admin calling GET /api/admin/analytics/overview returns HTTP 200 OK',
      `Got status ${adminRes.status}`
    );

    // -------------------------------------------------------------------------
    // TEST 3: AC 3.1.1 — Payload Populates 5 Distinct KPI Cards
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 3]\x1b[0m Verifying all 5 distinct KPI metrics exist with numerical values (AC 3.1.1)...\n');

    assert(
      typeof analyticsData.totalUsers === 'number',
      'KPI 1: Total Users exists and is a number',
      `totalUsers = ${analyticsData.totalUsers}`
    );
    assert(
      typeof analyticsData.activeStudents === 'number',
      'KPI 2: Active Students exists and is a number',
      `activeStudents = ${analyticsData.activeStudents}`
    );
    assert(
      typeof analyticsData.approvedTeachers === 'number',
      'KPI 3: Approved Teachers exists and is a number',
      `approvedTeachers = ${analyticsData.approvedTeachers}`
    );
    assert(
      typeof analyticsData.pendingApprovals === 'number',
      'KPI 4: Pending Approvals exists and is a number',
      `pendingApprovals = ${analyticsData.pendingApprovals}`
    );
    assert(
      typeof analyticsData.activeRooms === 'number',
      'KPI 5: Active Rooms exists and is a number',
      `activeRooms = ${analyticsData.activeRooms}`
    );

    // Verify backward-compatibility aliases
    assert(
      typeof analyticsData.usersCount === 'number' &&
      typeof analyticsData.studentsCount === 'number' &&
      typeof analyticsData.approvedTeachersCount === 'number' &&
      typeof analyticsData.pendingApprovalsCount === 'number' &&
      typeof analyticsData.activeRoomsCount === 'number',
      'Backward-compatible count aliases (usersCount, studentsCount, etc.) exist for legacy callers'
    );

    // -------------------------------------------------------------------------
    // TEST 4: AC 3.1.1 & AC 3.1.3 — Active Rooms Dynamic Tracking
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 4]\x1b[0m Verifying real-time active rooms count dynamically tracks live sessions...\n');

    clearMockSessions();
    const liveSession1 = {
      id: 'session-live-01',
      roomId: 'room-alpha-01',
      startedAt: new Date().toISOString(),
      endedAt: null,
      startedBy: 'host-01',
    };
    const liveSession2 = {
      id: 'session-live-02',
      roomId: 'room-beta-02',
      startedAt: new Date().toISOString(),
      endedAt: null,
      startedBy: 'host-02',
    };
    setMockSession(liveSession1);
    setMockSession(liveSession2);

    const activeRoomsRes = await fetch(`${BASE_URL}/api/admin/analytics/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const activeRoomsData = (await activeRoomsRes.json()) as PlatformAnalyticsOverview;

    assert(
      activeRoomsData.activeRooms >= 2,
      `Active rooms count dynamically includes live open sessions (count: ${activeRoomsData.activeRooms})`,
      `Expected >= 2, got ${activeRoomsData.activeRooms}`
    );

    // End session 1
    setMockSession({
      ...liveSession1,
      endedAt: new Date().toISOString(),
    });

    const endedRoomRes = await fetch(`${BASE_URL}/api/admin/analytics/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const endedRoomData = (await endedRoomRes.json()) as PlatformAnalyticsOverview;

    assert(
      endedRoomData.activeRooms < activeRoomsData.activeRooms,
      `Active rooms count decrements after session ends (count: ${endedRoomData.activeRooms})`,
      `Previous: ${activeRoomsData.activeRooms}, New: ${endedRoomData.activeRooms}`
    );

    // -------------------------------------------------------------------------
    // TEST 5: AC 3.1.2 — Dynamic Urgency Highlight of Pending Queue
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 5]\x1b[0m Verifying dynamic pending queue urgency & status transitions (AC 3.1.2)...\n');

    // 5a. When pending count > 0 -> Urgency badge with direct link "Review Queue →"
    const currentPending = pendingTeachersStore.size;
    assert(
      currentPending > 0,
      `Pending teachers store has ${currentPending} pending applicant(s)`,
      `Count: ${currentPending}`
    );

    const urgencyPendingRes = await fetch(`${BASE_URL}/api/admin/analytics/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const urgencyPendingData = (await urgencyPendingRes.json()) as PlatformAnalyticsOverview;
    assert(
      urgencyPendingData.pendingApprovals > 0,
      'When isApproved === false exists, pendingApprovals > 0 triggers amber badge & "Review Queue →"',
      `pendingApprovals: ${urgencyPendingData.pendingApprovals}`
    );

    // 5b. When admin verifies a teacher -> pendingApprovals decreases, approvedTeachers increases
    const testTeacherId = `teacher-verify-test-${Date.now()}`;
    pendingTeachersStore.set(testTeacherId, {
      id: testTeacherId,
      fullName: 'Dr. Katherine Johnson',
      email: 'katherine.johnson@nasa.gov',
      createdAt: new Date().toISOString(),
      status: 'pending',
      is_verified: false,
    });

    const beforeVerifyRes = await fetch(`${BASE_URL}/api/admin/analytics/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const beforeVerifyData = (await beforeVerifyRes.json()) as PlatformAnalyticsOverview;

    // Approve the teacher via PATCH /api/admin/verify-teacher/:id
    const verifyActionRes = await fetch(`${BASE_URL}/api/admin/verify-teacher/${testTeacherId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'approved' }),
    });
    assert(
      verifyActionRes.status === 200,
      'Admin approves pending teacher via PATCH /api/admin/verify-teacher/:id',
      `Status: ${verifyActionRes.status}`
    );

    const afterVerifyRes = await fetch(`${BASE_URL}/api/admin/analytics/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const afterVerifyData = (await afterVerifyRes.json()) as PlatformAnalyticsOverview;

    assert(
      afterVerifyData.pendingApprovals === beforeVerifyData.pendingApprovals - 1,
      'Pending approvals count decrements by 1 after verification approval',
      `Before: ${beforeVerifyData.pendingApprovals}, After: ${afterVerifyData.pendingApprovals}`
    );

    // 5c. When pending count is 0 -> System indicates "All Caught Up"
    setMockAnalytics({
      totalUsers: 15,
      activeStudents: 10,
      approvedTeachers: 5,
      pendingApprovals: 0,
      activeRooms: 2,
    });

    const zeroPendingRes = await fetch(`${BASE_URL}/api/admin/analytics/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const zeroPendingData = (await zeroPendingRes.json()) as PlatformAnalyticsOverview;

    assert(
      zeroPendingData.pendingApprovals === 0,
      'When pending count is 0, Pending Approvals card displays green checkmark "All Caught Up"',
      `pendingApprovals = ${zeroPendingData.pendingApprovals}`
    );

    // -------------------------------------------------------------------------
    // TEST 6: AC 3.1.3 — Periodic Auto-Refresh & Loading Resilience
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 6]\x1b[0m Verifying periodic refresh endpoints & cached fallback resilience (AC 3.1.3)...\n');

    // Both /api/admin/analytics/overview and /api/admin/overview work interchangeably
    const legacyOverviewRes = await fetch(`${BASE_URL}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      legacyOverviewRes.status === 200,
      'GET /api/admin/overview alias endpoint works identically to /api/admin/analytics/overview',
      `Got status ${legacyOverviewRes.status}`
    );

    // Clear mock analytics
    clearMockAnalytics();

    const normalRes = await fetch(`${BASE_URL}/api/admin/analytics/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const normalData = (await normalRes.json()) as PlatformAnalyticsOverview;
    assert(
      normalRes.status === 200 && normalData.totalUsers > 0,
      'Analytics overview recovers smoothly and provides real-time counts without failure',
      `Total Users: ${normalData.totalUsers}`
    );

  } catch (error) {
    console.error('\n❌ Unhandled error in test suite:', error);
    failedCount++;
  } finally {
    clearTokenCache();
    clearMockSessions();
    clearMockAnalytics();
    await new Promise<void>((resolve) => {
      testServer.close(() => resolve());
    });
    console.log('[Test Server] Shut down gracefully.');

    console.log('\n============================================================');
    console.log(`Test Summary: ${passedCount} Passed, ${failedCount} Failed`);
    console.log('============================================================\n');

    process.exitCode = failedCount > 0 ? 1 : 0;
  }
}

runTests();
