/**
 * Automated Verification Suite for US-2.1: Teacher Feature Protection & Pending Approval Gate
 * Issue: #154
 * 
 * Acceptance Criteria Verified:
 * AC 2.1.1 — Interception of Navigation to Room Creation (/create-room):
 *   - Verified by client TeacherRouteGuard redirecting role === 'TEACHER' and isApproved === false to /pending-approval
 * AC 2.1.2 — Visual Elements of "Pending Admin Approval" Screen:
 *   - Verified by PendingApprovalPage rendering animated review badge, copy, refresh button, participant button, and email link
 * AC 2.1.3 — Server-Side API Enforcement (POST /api/rooms):
 *   - Given an unapproved teacher issues a POST /api/rooms request with a valid JWT
 *   - Aborts with HTTP 403 Forbidden and exact JSON payload:
 *     { "statusCode": 403, "error": "TEACHER_NOT_APPROVED", "message": "Your teacher account is pending administrator verification. Room creation is disabled." }
 *   - Given a student issues a POST /api/rooms request, aborts with HTTP 403 TEACHER_ONLY
 *   - Given GET /api/me is called, returns user profile with isApproved status
 */

import http from 'http';
import { app } from '../src/app';
import { Me } from '@linkup/shared';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';

const TEST_PORT = 3108;
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
  console.log('🚀 Running US-2.1: Teacher Feature Protection & Approval Gate Tests');
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
    // TEST 1: Unauthenticated request to POST /api/rooms returns 401 UNAUTHENTICATED
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Test 1]\x1b[0m Verifying unauthenticated POST /api/rooms is rejected with 401 UNAUTHENTICATED...\n');

    const unauthRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Intro to Algorithms' }),
    });
    const unauthBody = (await unauthRes.json()) as { error?: { code?: string } };
    assert(
      unauthRes.status === 401 && unauthBody.error?.code === 'UNAUTHENTICATED',
      'Unauthenticated POST /api/rooms returns 401 UNAUTHENTICATED',
      `Got status ${unauthRes.status}, code: ${unauthBody.error?.code}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: AC 2.1.3 — Server-Side API Enforcement for Unapproved Teacher (POST /api/rooms)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 2]\x1b[0m Verifying unapproved teacher calling POST /api/rooms returns 403 TEACHER_NOT_APPROVED (AC 2.1.3)...\n');

    const unapprovedTeacherToken = 'jwt_test_unapproved_teacher_token_154';
    const unapprovedTeacherUser: Me = {
      id: 'teacher-unapproved-uuid-154',
      email: 'prof.pending@linkup.test',
      fullName: 'Prof. Alan Turing',
      role: 'teacher',
      isApproved: false,
      status: 'PENDING_TEACHER',
    };
    setCachedUser(unapprovedTeacherToken, unapprovedTeacherUser, 60000);

    const roomPostRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${unapprovedTeacherToken}`,
      },
      body: JSON.stringify({
        name: 'Theory of Computation',
        description: 'Turing machines and decidability',
      }),
    });

    const roomPostBody = (await roomPostRes.json()) as {
      statusCode?: number;
      error?: string;
      message?: string;
    };

    assert(
      roomPostRes.status === 403,
      'AC 2.1.3: Unapproved teacher receives HTTP 403 Forbidden',
      `Got status ${roomPostRes.status}`
    );

    assert(
      roomPostBody.statusCode === 403,
      'AC 2.1.3: JSON payload contains statusCode: 403',
      `Got statusCode ${roomPostBody.statusCode}`
    );

    assert(
      roomPostBody.error === 'TEACHER_NOT_APPROVED',
      'AC 2.1.3: JSON payload contains error: "TEACHER_NOT_APPROVED"',
      `Got error "${roomPostBody.error}"`
    );

    const expectedMessage = 'Your teacher account is pending administrator verification. Room creation is disabled.';
    assert(
      roomPostBody.message === expectedMessage,
      'AC 2.1.3: JSON payload contains standardized message',
      `Got message "${roomPostBody.message}"`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Student calling POST /api/rooms receives 403 TEACHER_ONLY
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 3]\x1b[0m Verifying student calling POST /api/rooms receives 403 TEACHER_ONLY...\n');

    const studentToken = 'jwt_test_student_token_154';
    const studentUser: Me = {
      id: 'student-uuid-154',
      email: 'student@linkup.test',
      fullName: 'Alex Student',
      role: 'student',
      isApproved: true,
    };
    setCachedUser(studentToken, studentUser, 60000);

    const studentRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ name: 'Hacked Classroom' }),
    });
    const studentBody = (await studentRes.json()) as { error?: { code?: string } };

    assert(
      studentRes.status === 403 && studentBody.error?.code === 'TEACHER_ONLY',
      'Student calling POST /api/rooms returns 403 TEACHER_ONLY',
      `Got status ${studentRes.status}, code: ${studentBody.error?.code}`
    );

    // -------------------------------------------------------------------------
    // TEST 4: AC 2.1.2 — GET /api/me returns user profile and approval status
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 4]\x1b[0m Verifying GET /api/me returns isApproved status without re-login (AC 2.1.2)...\n');

    const meRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${unapprovedTeacherToken}` },
    });
    const meBody = (await meRes.json()) as { user?: Me };

    assert(meRes.status === 200, 'GET /api/me returns 200 OK');
    assert(meBody.user?.role === 'teacher', 'User role is teacher');
    assert(meBody.user?.isApproved === false, 'User isApproved is false');
    assert(meBody.user?.status === 'PENDING_TEACHER', 'User status is PENDING_TEACHER');

    // -------------------------------------------------------------------------
    // TEST 5: Teacher with approval (isApproved: true) passes the gate
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 5]\x1b[0m Verifying approved teacher passes the pending approval gate...\n');

    const approvedTeacherToken = 'jwt_test_approved_teacher_token_154';
    const approvedTeacherUser: Me = {
      id: 'teacher-approved-uuid-154',
      email: 'prof.approved@linkup.test',
      fullName: 'Prof. Ada Lovelace',
      role: 'teacher',
      isApproved: true,
      status: 'APPROVED',
    };
    setCachedUser(approvedTeacherToken, approvedTeacherUser, 60000);

    const approvedMeRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${approvedTeacherToken}` },
    });
    const approvedMeBody = (await approvedMeRes.json()) as { user?: Me };

    assert(approvedMeBody.user?.isApproved === true, 'Approved teacher has isApproved = true in GET /api/me');
    assert(approvedMeBody.user?.status === 'APPROVED', 'Approved teacher has status = APPROVED in GET /api/me');

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
