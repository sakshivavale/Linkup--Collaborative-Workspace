import http from 'http';
import { app } from '../src/app';
import { Me, Room } from '@linkup/shared';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';

const TEST_PORT = 3105;
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
  console.log('🚀 Running Teacher Approval Workflow & Admin Dashboard Tests');
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
    // STEP 1: User Signs Up (Selects 'Teacher') -> Status: PENDING_TEACHER, Role: STUDENT
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Step 1]\x1b[0m Verifying user signup with role=student and status=PENDING_TEACHER...\n');

    const pendingTeacherToken = 'test_token_pending_teacher_01';
    const pendingTeacherUser: Me = {
      id: '11111111-1111-4111-a111-111111111111',
      email: 'applicant.teacher@linkup.test',
      fullName: 'Prof. Marie Curie',
      role: 'student',
      status: 'PENDING_TEACHER',
      requestedRole: 'teacher',
    };
    setCachedUser(pendingTeacherToken, pendingTeacherUser, 60000);

    const meRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${pendingTeacherToken}` },
    });
    const meBody = (await meRes.json()) as { user?: Me };

    assert(meRes.status === 200, 'GET /api/me returns 200 for authenticated user');
    assert(meBody.user?.status === 'PENDING_TEACHER', 'User status is PENDING_TEACHER');
    assert(meBody.user?.role === 'student', 'User effective role is student pending approval');

    // -------------------------------------------------------------------------
    // STEP 2: Pending Teacher attempts room creation -> 403 TEACHER_ONLY
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Step 2]\x1b[0m Verifying pending teacher cannot create rooms before approval (403 TEACHER_ONLY)...\n');

    const roomAttemptRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pendingTeacherToken}`,
      },
      body: JSON.stringify({ name: 'Radioactivity 101' }),
    });
    const roomAttemptBody = (await roomAttemptRes.json()) as { error?: { code?: string; message?: string } };

    assert(
      roomAttemptRes.status === 403 && roomAttemptBody.error?.code === 'TEACHER_ONLY',
      'POST /api/rooms returns 403 TEACHER_ONLY while status is PENDING_TEACHER',
      `Got status ${roomAttemptRes.status}, code ${roomAttemptBody.error?.code}`
    );

    // -------------------------------------------------------------------------
    // STEP 3: Admin reviews requests in Admin Dashboard
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Step 3]\x1b[0m Verifying Admin Dashboard endpoints require admin permissions...\n');

    // Unauthenticated admin check
    const unauthAdminRes = await fetch(`${BASE_URL}/api/admin/overview`);
    assert(unauthAdminRes.status === 401, 'Unauthenticated GET /api/admin/overview returns 401');

    // Non-admin user attempt
    const nonAdminRes = await fetch(`${BASE_URL}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${pendingTeacherToken}` },
    });
    assert(nonAdminRes.status === 403, 'Non-admin user calling GET /api/admin/overview returns 403 ADMIN_ONLY');

    // Admin user authorization
    const adminToken = 'test_token_admin_01';
    const adminUser: Me = {
      id: '22222222-2222-4222-a222-222222222222',
      email: 'admin@linkup.test',
      fullName: 'Platform Admin',
      role: 'admin',
      isAdmin: true,
    };
    setCachedUser(adminToken, adminUser, 60000);

    const adminOverviewRes = await fetch(`${BASE_URL}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminOverviewRes.status === 200, 'Admin can view platform overview metrics');

    // -------------------------------------------------------------------------
    // STEP 4: Admin reviews teacher requests and approves applicant
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Step 4]\x1b[0m Admin approves teacher request via POST /api/admin/teacher-requests/:id/approve...\n');

    // Also support x-admin-key header
    const approveRes = await fetch(`${BASE_URL}/api/admin/teacher-requests/${pendingTeacherUser.id}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    });

    assert(approveRes.status === 200, 'Admin approval request returns 200 OK');
    const approveBody = (await approveRes.json()) as { success?: boolean; role?: string; status?: string };
    assert(approveBody.success === true, 'Approval response indicates success = true');
    assert(approveBody.role === 'teacher', 'User role updated to teacher');
    assert(approveBody.status === 'APPROVED', 'User status updated to APPROVED');

    // -------------------------------------------------------------------------
    // STEP 5: Role updated to TEACHER -> User Unlocks Room Creation & Host Controls!
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Step 5]\x1b[0m Verifying approved teacher now unlocks room creation and host controls...\n');

    // Update user session with approved role
    const approvedTeacherToken = 'test_token_approved_teacher_01';
    const approvedTeacherUser: Me = {
      id: pendingTeacherUser.id,
      email: pendingTeacherUser.email,
      fullName: pendingTeacherUser.fullName,
      role: 'teacher',
      status: 'APPROVED',
      requestedRole: 'teacher',
    };
    setCachedUser(approvedTeacherToken, approvedTeacherUser, 60000);

    const createRoomRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${approvedTeacherToken}`,
      },
      body: JSON.stringify({
        name: 'Nuclear Physics Lab',
        description: 'Advanced graduate physics workspace',
        defaultPermissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
      }),
    });

    const createRoomBody = (await createRoomRes.json()) as Room & { joinCode?: string };
    assert(createRoomRes.status === 201, 'Approved teacher successfully creates room (201 CREATED)');
    assert(typeof createRoomBody.joinCode === 'string' && createRoomBody.joinCode.length === 6, 'Room join code generated for teacher');
    assert(createRoomBody.name === 'Nuclear Physics Lab', 'Room name matches created payload');

    // -------------------------------------------------------------------------
    // STEP 6: Admin Elevate Endpoint
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Step 6]\x1b[0m Verifying POST /api/admin/elevate endpoint...\n');

    const elevateUserToken = 'test_token_elevate_user';
    const regularUser: Me = {
      id: '33333333-3333-4333-a333-333333333333',
      email: 'regular@test.com',
      fullName: 'Regular User',
      role: 'student',
    };
    setCachedUser(elevateUserToken, regularUser, 60000);

    const elevateRes = await fetch(`${BASE_URL}/api/admin/elevate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${elevateUserToken}`,
      },
      body: JSON.stringify({ passkey: 'admin123' }),
    });

    assert(elevateRes.status === 200, 'POST /api/admin/elevate with valid passkey returns 200');

  } catch (error) {
    console.error('\n❌ Unhandled error in test suite:', error);
    failedCount++;
  } finally {
    clearTokenCache();
    await new Promise<void>((resolve) => testServer.close(() => resolve()));
    console.log('[Test Server] Shut down gracefully.');

    console.log('\n============================================================');
    console.log(`Test Summary: ${passedCount} Passed, ${failedCount} Failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runTests();
