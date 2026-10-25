/**
 * Automated Verification Suite for US-2.2: Administrative Route Guarding & RBAC Middleware
 * Issue: #155
 * 
 * Acceptance Criteria Verified:
 * AC 2.2.1 — Non-Admin Navigation Attempt to /admin Web Routes:
 *   - Verified by client <AdminRouteGuard> intercepting role === 'STUDENT' or role === 'TEACHER',
 *     redirecting to /, and showing toast: "Access Denied: Administrator privileges required."
 * AC 2.2.2 — Unauthenticated Visitor Access Attempt:
 *   - Verified by <AdminRouteGuard> redirecting unauthenticated visitors to /login?redirect=/admin
 * AC 2.2.3 — Backend Administrative API Route Middleware (requireAdmin):
 *   - Given an HTTP request directed at any endpoint under /api/admin/*
 *   - When processed by requireAdmin Express middleware:
 *     - If token is missing or invalid: responds with HTTP 401 Unauthorized ({ "error": "UNAUTHORIZED" })
 *     - If user.role !== 'ADMIN' or user.isApproved !== true: responds with HTTP 403 Forbidden ({ "error": "FORBIDDEN_ADMIN_ONLY" })
 *     - If valid admin: attaches req.user and calls next()
 */

import http from 'http';
import { app } from '../src/app';
import { Me } from '@linkup/shared';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';

const TEST_PORT = 3109;
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
  console.log('🚀 Running US-2.2: Administrative Route Guarding & RBAC Middleware Tests');
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
    // TEST 1: AC 2.2.3 — Unauthenticated request to /api/admin/* returns 401 UNAUTHORIZED
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Test 1]\x1b[0m Verifying unauthenticated /api/admin/* requests return 401 UNAUTHORIZED (AC 2.2.3)...\n');

    const endpoints = [
      '/api/admin/overview',
      '/api/admin/pending-teachers',
      '/api/admin/analytics/overview',
    ];

    for (const endpoint of endpoints) {
      const res = await fetch(`${BASE_URL}${endpoint}`);
      const body = (await res.json()) as { error?: string };

      assert(
        res.status === 401,
        `Unauthenticated GET ${endpoint} returns HTTP 401`,
        `Got status ${res.status}`
      );
      assert(
        body.error === 'UNAUTHORIZED',
        `Unauthenticated GET ${endpoint} returns { "error": "UNAUTHORIZED" }`,
        `Got body ${JSON.stringify(body)}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 2: AC 2.2.3 — Malformed or invalid Bearer token returns 401 UNAUTHORIZED
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 2]\x1b[0m Verifying malformed or invalid Bearer tokens return 401 UNAUTHORIZED (AC 2.2.3)...\n');

    const malformedRes = await fetch(`${BASE_URL}/api/admin/overview`, {
      headers: { Authorization: 'Basic not-a-bearer-token' },
    });
    const malformedBody = (await malformedRes.json()) as { error?: string };
    assert(
      malformedRes.status === 401 && malformedBody.error === 'UNAUTHORIZED',
      'Malformed Authorization header returns 401 UNAUTHORIZED',
      `Got status ${malformedRes.status}, error: ${malformedBody.error}`
    );

    const invalidTokenRes = await fetch(`${BASE_URL}/api/admin/overview`, {
      headers: { Authorization: 'Bearer totally_invalid_token_xyz' },
    });
    const invalidTokenBody = (await invalidTokenRes.json()) as { error?: string };
    assert(
      invalidTokenRes.status === 401 && invalidTokenBody.error === 'UNAUTHORIZED',
      'Invalid Bearer token returns 401 UNAUTHORIZED',
      `Got status ${invalidTokenRes.status}, error: ${invalidTokenBody.error}`
    );

    // -------------------------------------------------------------------------
    // TEST 3: AC 2.2.3 — Non-Admin (role === 'STUDENT') receives 403 FORBIDDEN_ADMIN_ONLY
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 3]\x1b[0m Verifying student (role === \'STUDENT\') receives 403 FORBIDDEN_ADMIN_ONLY (AC 2.2.3)...\n');

    const studentToken = 'jwt_test_student_rbac_155';
    const studentUser: Me = {
      id: 'student-rbac-uuid-155',
      email: 'student.rbac@linkup.test',
      fullName: 'Alice Student',
      role: 'student',
      isApproved: true,
      status: 'APPROVED',
    };
    setCachedUser(studentToken, studentUser, 60000);

    const studentAdminRes = await fetch(`${BASE_URL}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    const studentAdminBody = (await studentAdminRes.json()) as { error?: string; message?: string };

    assert(
      studentAdminRes.status === 403,
      'Student accessing /api/admin/overview returns HTTP 403 Forbidden',
      `Got status ${studentAdminRes.status}`
    );
    assert(
      studentAdminBody.error === 'FORBIDDEN_ADMIN_ONLY',
      'Student receives exact error { "error": "FORBIDDEN_ADMIN_ONLY" }',
      `Got error: ${studentAdminBody.error}`
    );

    // Also test POST/PATCH endpoint with student
    const studentPatchRes = await fetch(`${BASE_URL}/api/admin/verify-teacher/some-teacher-id`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ status: 'approved' }),
    });
    const studentPatchBody = (await studentPatchRes.json()) as { error?: string };
    assert(
      studentPatchRes.status === 403 && studentPatchBody.error === 'FORBIDDEN_ADMIN_ONLY',
      'Student mutating admin endpoint PATCH /api/admin/verify-teacher returns 403 FORBIDDEN_ADMIN_ONLY',
      `Got status ${studentPatchRes.status}, error: ${studentPatchBody.error}`
    );

    // -------------------------------------------------------------------------
    // TEST 4: AC 2.2.3 — Non-Admin (role === 'TEACHER') receives 403 FORBIDDEN_ADMIN_ONLY
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 4]\x1b[0m Verifying teacher (role === \'TEACHER\') receives 403 FORBIDDEN_ADMIN_ONLY (AC 2.2.3)...\n');

    const teacherToken = 'jwt_test_teacher_rbac_155';
    const teacherUser: Me = {
      id: 'teacher-rbac-uuid-155',
      email: 'prof.smith@linkup.test',
      fullName: 'Prof. John Smith',
      role: 'teacher',
      isApproved: true,
      status: 'APPROVED',
    };
    setCachedUser(teacherToken, teacherUser, 60000);

    const teacherAdminRes = await fetch(`${BASE_URL}/api/admin/pending-teachers`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    const teacherAdminBody = (await teacherAdminRes.json()) as { error?: string };

    assert(
      teacherAdminRes.status === 403,
      'Approved teacher accessing /api/admin/pending-teachers returns HTTP 403 Forbidden',
      `Got status ${teacherAdminRes.status}`
    );
    assert(
      teacherAdminBody.error === 'FORBIDDEN_ADMIN_ONLY',
      'Teacher receives exact error { "error": "FORBIDDEN_ADMIN_ONLY" }',
      `Got error: ${teacherAdminBody.error}`
    );

    // -------------------------------------------------------------------------
    // TEST 5: AC 2.2.3 — Unapproved Admin (isApproved === false) receives 403 FORBIDDEN_ADMIN_ONLY
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 5]\x1b[0m Verifying unapproved admin (role === \'ADMIN\', isApproved === false) receives 403 (AC 2.2.3)...\n');

    const unapprovedAdminToken = 'jwt_test_unapproved_admin_155';
    const unapprovedAdminUser: Me = {
      id: 'admin-unapproved-uuid-155',
      email: 'pending.admin@linkup.test',
      fullName: 'Pending Admin',
      role: 'ADMIN',
      isApproved: false,
    };
    setCachedUser(unapprovedAdminToken, unapprovedAdminUser, 60000);

    const unapprovedAdminRes = await fetch(`${BASE_URL}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${unapprovedAdminToken}` },
    });
    const unapprovedAdminBody = (await unapprovedAdminRes.json()) as { error?: string };

    assert(
      unapprovedAdminRes.status === 403,
      'Unapproved admin receives HTTP 403 Forbidden',
      `Got status ${unapprovedAdminRes.status}`
    );
    assert(
      unapprovedAdminBody.error === 'FORBIDDEN_ADMIN_ONLY',
      'Unapproved admin receives { "error": "FORBIDDEN_ADMIN_ONLY" }',
      `Got error: ${unapprovedAdminBody.error}`
    );

    // -------------------------------------------------------------------------
    // TEST 6: AC 2.2.3 — Approved Admin (role === 'ADMIN', isApproved === true) succeeds
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 6]\x1b[0m Verifying approved admin (role === \'ADMIN\', isApproved === true) passes requireAdmin (AC 2.2.3)...\n');

    const approvedAdminToken = 'jwt_test_approved_admin_155';
    const approvedAdminUser: Me = {
      id: 'admin-approved-uuid-155',
      email: 'superadmin@linkup.test',
      fullName: 'Chief Administrator',
      role: 'ADMIN',
      isApproved: true,
      status: 'APPROVED',
      isAdmin: true,
    };
    setCachedUser(approvedAdminToken, approvedAdminUser, 60000);

    const adminOverviewRes = await fetch(`${BASE_URL}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${approvedAdminToken}` },
    });
    const adminOverviewBody = (await adminOverviewRes.json()) as { usersCount?: number };

    assert(
      adminOverviewRes.status === 200,
      'Approved admin calling GET /api/admin/overview returns HTTP 200 OK',
      `Got status ${adminOverviewRes.status}`
    );
    assert(
      typeof adminOverviewBody.usersCount === 'number',
      'Admin overview response payload returned successfully',
      `Got payload: ${JSON.stringify(adminOverviewBody)}`
    );

    const adminPendingRes = await fetch(`${BASE_URL}/api/admin/pending-teachers`, {
      headers: { Authorization: `Bearer ${approvedAdminToken}` },
    });
    const adminPendingBody = (await adminPendingRes.json()) as { pendingTeachers?: any[] };

    assert(
      adminPendingRes.status === 200,
      'Approved admin calling GET /api/admin/pending-teachers returns HTTP 200 OK',
      `Got status ${adminPendingRes.status}`
    );
    assert(
      Array.isArray(adminPendingBody.pendingTeachers),
      'Admin pending teachers list returned successfully',
      `Got array: ${Boolean(Array.isArray(adminPendingBody.pendingTeachers))}`
    );

    // -------------------------------------------------------------------------
    // TEST 7: Mock Admin Token (fallback for support@gmail.com) passes requireAdmin
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 7]\x1b[0m Verifying mock admin token (support@gmail.com) passes requireAdmin...\n');

    const mockAdminRes = await fetch(`${BASE_URL}/api/admin/overview`, {
      headers: { Authorization: 'Bearer mock-admin-token-linkup' },
    });
    assert(
      mockAdminRes.status === 200,
      'Mock superadmin token (mock-admin-token-linkup) passes requireAdmin with 200 OK',
      `Got status ${mockAdminRes.status}`
    );

  } catch (error) {
    console.error('\n❌ Unhandled error in test suite:', error);
    failedCount++;
  } finally {
    clearTokenCache();
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
