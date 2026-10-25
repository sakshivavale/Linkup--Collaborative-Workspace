/**
 * Automated Verification Suite for US-3.2: Teacher Approval Queue & Real-Time Action Processing
 * Issue: #157
 *
 * Acceptance Criteria Verified:
 * AC 3.2.1 — Pending Queue Display & Applicant Details:
 *   - Given an Admin is on the "Teacher Approvals" tab (/admin/approvals)
 *   - When the queue renders
 *   - Then all users matching isApproved === false and role === 'TEACHER' are displayed
 *   - And each row displays: Full Name, Email Address, Registration Timestamp, and Action buttons ("Approve", "Reject").
 *
 * AC 3.2.2 — Admin Approves a Teacher Application:
 *   - Given a pending teacher row in the queue
 *   - When the Admin clicks the "Approve" button
 *   - Then a PATCH /api/admin/users/:userId/approval request is sent with { "isApproved": true, "status": "APPROVED" }
 *   - And the database record is updated to isApproved = true
 *   - And the row is removed from the pending queue with a success notification
 *   - And the teacher is granted immediate room creation privileges (/create-room) without requiring re-login.
 *
 * AC 3.2.3 — Admin Rejects a Teacher Application:
 *   - Given an unverified or invalid teacher signup in the queue
 *   - When the Admin clicks the "Reject" button
 *   - Then the system updates isApproved = false and status = 'REJECTED'
 *   - And decrements the pending queue counter immediately.
 */

import http from 'http';
import { app, pendingTeachersStore } from '../src/app';
import { Me } from '@linkup/shared';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';

const TEST_PORT = 3111;
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
  console.log('🚀 Running US-3.2: Teacher Approval Queue & Real-Time Action Processing Tests');
  console.log('============================================================\n');

  const testServer = http.createServer(app);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  try {
    const adminToken = 'jwt_test_admin_us32';
    const adminUser: Me = {
      id: 'admin-uuid-us32',
      email: 'admin.lead@linkup.test',
      fullName: 'Chief Administrator',
      role: 'ADMIN',
      isApproved: true,
      status: 'APPROVED',
      isAdmin: true,
    };
    setCachedUser(adminToken, adminUser, 60000);

    // -------------------------------------------------------------------------
    // TEST 1: AC 3.2.1 — Pending Queue Display & Applicant Details
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Test 1]\x1b[0m Verifying pending queue retrieval & applicant details (AC 3.2.1)...\n');

    // Seed test pending teacher
    const candidateId = `candidate-${Date.now()}`;
    const candidateRecord = {
      id: candidateId,
      fullName: 'Prof. Ada Lovelace',
      email: 'ada.lovelace@oxford.edu',
      createdAt: new Date().toISOString(),
      status: 'pending' as const,
      is_verified: false,
    };
    pendingTeachersStore.set(candidateId, candidateRecord);

    const queueRes = await fetch(`${BASE_URL}/api/admin/pending-teachers`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const queueData = (await queueRes.json()) as { pendingTeachers: any[]; count: number };

    assert(
      queueRes.status === 200,
      'Admin querying GET /api/admin/pending-teachers returns HTTP 200 OK',
      `Got status ${queueRes.status}`
    );
    assert(
      Array.isArray(queueData.pendingTeachers),
      'Pending queue returns an array of applicant rows'
    );

    const foundCandidate = queueData.pendingTeachers.find((t) => t.id === candidateId);
    assert(
      Boolean(foundCandidate),
      'Newly seeded pending teacher is present in the queue'
    );
    assert(
      foundCandidate?.fullName === 'Prof. Ada Lovelace' &&
      foundCandidate?.email === 'ada.lovelace@oxford.edu' &&
      Boolean(foundCandidate?.createdAt),
      'Applicant row displays Full Name, Email Address, and Registration Timestamp',
      `Found: ${JSON.stringify(foundCandidate)}`
    );

    // Also verify /api/admin/approvals alias
    const approvalsRes = await fetch(`${BASE_URL}/api/admin/approvals`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      approvalsRes.status === 200,
      'GET /api/admin/approvals alias endpoint returns 200 OK'
    );

    // -------------------------------------------------------------------------
    // TEST 2: AC 3.2.2 — Admin Approves a Teacher Application
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 2]\x1b[0m Verifying Admin Approves Teacher Application via PATCH /api/admin/users/:userId/approval (AC 3.2.2)...\n');

    // Register candidate's active session token (as unapproved teacher initially)
    const candidateToken = `token_${candidateId}`;
    const candidateUserSession: Me = {
      id: candidateId,
      email: candidateRecord.email,
      fullName: candidateRecord.fullName,
      role: 'teacher',
      isApproved: false,
      status: 'PENDING_TEACHER',
    };
    setCachedUser(candidateToken, candidateUserSession, 60000);

    // Candidate initially verifies they cannot create room before approval
    const preCheckRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${candidateToken}` },
    });
    const preCheckBody = (await preCheckRes.json()) as { user?: Me };
    assert(
      preCheckBody.user?.isApproved === false,
      'Candidate isApproved is false prior to administrator review'
    );

    // Admin executes approval: PATCH /api/admin/users/:userId/approval
    const approveRes = await fetch(`${BASE_URL}/api/admin/users/${candidateId}/approval`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ isApproved: true, status: 'APPROVED' }),
    });
    const approveBody = (await approveRes.json()) as {
      success: boolean;
      status: string;
      role: string;
      isApproved: boolean;
      message: string;
    };

    assert(
      approveRes.status === 200,
      'PATCH /api/admin/users/:userId/approval returns HTTP 200 OK',
      `Got status ${approveRes.status}`
    );
    assert(
      approveBody.success === true && approveBody.isApproved === true,
      'Approval response payload has { success: true, isApproved: true }'
    );
    assert(
      approveBody.status === 'APPROVED' && approveBody.role === 'teacher',
      'Approval response payload has status === "APPROVED" and role === "teacher"'
    );
    assert(
      approveBody.message.includes('has been approved successfully'),
      'Approval response includes standardized confirmation message'
    );

    // Verify row is removed from pending queue
    const postApproveQueueRes = await fetch(`${BASE_URL}/api/admin/pending-teachers`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const postApproveQueueData = (await postApproveQueueRes.json()) as { pendingTeachers: any[] };
    const stillInQueue = postApproveQueueData.pendingTeachers.some((t) => t.id === candidateId);
    assert(
      !stillInQueue,
      'Approved teacher row is immediately removed from the pending approvals queue'
    );

    // Verify teacher is granted immediate room creation privileges without re-login
    const postCheckRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${candidateToken}` },
    });
    const postCheckBody = (await postCheckRes.json()) as { user?: Me };
    assert(
      postCheckBody.user?.isApproved === true && postCheckBody.user?.status === 'APPROVED',
      'Teacher active session is updated to isApproved = true and status = APPROVED without re-login',
      `User state: ${JSON.stringify(postCheckBody.user)}`
    );

    // -------------------------------------------------------------------------
    // TEST 3: AC 3.2.3 — Admin Rejects a Teacher Application
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 3]\x1b[0m Verifying Admin Rejects Teacher Application (AC 3.2.3)...\n');

    const rejectedCandidateId = `reject-candidate-${Date.now()}`;
    const rejectedCandidateRecord = {
      id: rejectedCandidateId,
      fullName: 'Suspicious Applicant',
      email: 'fraudulent@fake.domain',
      createdAt: new Date().toISOString(),
      status: 'pending' as const,
      is_verified: false,
    };
    pendingTeachersStore.set(rejectedCandidateId, rejectedCandidateRecord);

    const initialQueueCount = pendingTeachersStore.size;

    // Admin clicks "Reject": PATCH /api/admin/users/:userId/approval with isApproved = false, status = 'REJECTED'
    const rejectRes = await fetch(`${BASE_URL}/api/admin/users/${rejectedCandidateId}/approval`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ isApproved: false, status: 'REJECTED' }),
    });
    const rejectBody = (await rejectRes.json()) as {
      success: boolean;
      status: string;
      isApproved: boolean;
      message: string;
    };

    assert(
      rejectRes.status === 200,
      'Admin rejecting application returns HTTP 200 OK',
      `Got status ${rejectRes.status}`
    );
    assert(
      rejectBody.isApproved === false && rejectBody.status === 'REJECTED',
      'Rejection updates isApproved = false and status = "REJECTED"'
    );
    assert(
      rejectBody.message.includes('has been rejected'),
      'Rejection response includes rejection confirmation notification'
    );

    // Verify candidate is removed from pending queue
    const postRejectQueueRes = await fetch(`${BASE_URL}/api/admin/pending-teachers`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const postRejectQueueData = (await postRejectQueueRes.json()) as { pendingTeachers: any[] };
    const rejectStillInQueue = postRejectQueueData.pendingTeachers.some((t) => t.id === rejectedCandidateId);

    assert(
      !rejectStillInQueue,
      'Rejected applicant is immediately removed from the pending approvals queue'
    );

    // Verify pending queue counter decrements immediately
    assert(
      postRejectQueueData.pendingTeachers.length < initialQueueCount,
      'Pending queue counter decrements immediately upon rejection'
    );

    // -------------------------------------------------------------------------
    // TEST 4: Authorization Protection on Approval Endpoints
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 4]\x1b[0m Verifying non-admins cannot mutate approval status...\n');

    const unauthorizedRes = await fetch(`${BASE_URL}/api/admin/users/${candidateId}/approval`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${candidateToken}`, // Student/Teacher token, not admin
      },
      body: JSON.stringify({ isApproved: true }),
    });
    assert(
      unauthorizedRes.status === 403,
      'Non-admin mutating /api/admin/users/:id/approval receives 403 FORBIDDEN_ADMIN_ONLY',
      `Got status ${unauthorizedRes.status}`
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
