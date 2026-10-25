/**
 * Automated Verification Suite for US-3.4: Platform User Directory, Search, Filter & Role/Status Control
 * Issue: #159
 *
 * Acceptance Criteria Verified:
 * AC 3.4.1 — Search and Multi-Criteria Filtering:
 *   - Given an Admin is on the User Directory (/admin/users)
 *   - When typing into the search box or selecting Role (Student/Teacher/Admin) and Status (Approved/Pending/Suspended) filters
 *   - Then the directory updates to show only records matching all active criteria.
 *
 * AC 3.4.2 — Dynamic Role Modification:
 *   - Given an existing user currently assigned as role: 'STUDENT'
 *   - When the Admin clicks the user's action menu and selects "Change Role" -> "Teacher"
 *   - Then updating sends PATCH /api/admin/users/:userId/role setting role = 'TEACHER' and isApproved = true
 *   - And the updated role badge is immediately reflected in the directory.
 *
 * AC 3.4.3 — Account Suspension and Privilege Revocation:
 *   - Given an active user exhibiting disruptive behavior
 *   - When the Admin selects "Suspend Account"
 *   - Then the profile is set to isSuspended = true, active sessions are revoked
 *   - And subsequent requests return HTTP 403 Forbidden ({ "error": "ACCOUNT_SUSPENDED" }).
 */

import http from 'http';
import { app, userDirectoryStore } from '../src/app';
import { Me } from '@linkup/shared';
import { setCachedUser } from '../src/lib/supabase';

const TEST_PORT = 3113;
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
  console.log('🚀 Running US-3.4: Platform User Directory, Search, Filter & Role/Status Control Tests');
  console.log('============================================================\n');

  const testServer = http.createServer(app);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  try {
    const adminToken = 'jwt_test_admin_us34';
    const adminUser: Me = {
      id: 'admin-uuid-us34',
      email: 'admin.director@linkup.test',
      fullName: 'Chief Directory Administrator',
      role: 'ADMIN',
      isApproved: true,
      status: 'APPROVED',
      isAdmin: true,
    };
    setCachedUser(adminToken, adminUser, 60000);

    const studentToken = 'jwt_test_student_us34';
    const studentUser: Me = {
      id: 'student-uuid-us34',
      email: 'alex.student@linkup.test',
      fullName: 'Alex Johnson',
      role: 'STUDENT',
      isApproved: true,
      status: 'APPROVED',
      isAdmin: false,
      isSuspended: false,
    };
    setCachedUser(studentToken, studentUser, 60000);

    // -------------------------------------------------------------------------
    // TEST 1: Access Control on User Directory Endpoints
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Test 1]\x1b[0m Verifying access control on GET /api/admin/users...\n');

    const unauthRes = await fetch(`${BASE_URL}/api/admin/users`);
    assert(
      unauthRes.status === 401,
      'Unauthenticated request to GET /api/admin/users returns 401 Unauthorized',
      `Got status ${unauthRes.status}`
    );

    const studentRes = await fetch(`${BASE_URL}/api/admin/users`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(
      studentRes.status === 403,
      'Non-admin request to GET /api/admin/users returns 403 Forbidden',
      `Got status ${studentRes.status}`
    );

    const adminRes = await fetch(`${BASE_URL}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminData = (await adminRes.json()) as any;
    assert(
      adminRes.status === 200 && Array.isArray(adminData.users) && adminData.users.length > 0,
      'Admin querying GET /api/admin/users returns HTTP 200 OK with users array',
      `Got status ${adminRes.status}, count: ${adminData.users?.length}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: AC 3.4.1 — Multi-Criteria Filtering (Search, Role, Status)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 2]\x1b[0m Verifying search and multi-criteria filters (AC 3.4.1)...\n');

    // 2a: Search filter
    const searchRes = await fetch(`${BASE_URL}/api/admin/users?search=Maya`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const searchData = (await searchRes.json()) as any;
    const allMatchSearch = searchData.users?.every((u: any) =>
      u.fullName.toLowerCase().includes('maya') || u.email.toLowerCase().includes('maya')
    );
    assert(
      searchRes.status === 200 && searchData.users?.length > 0 && allMatchSearch,
      'Query param ?search=Maya returns only users matching "Maya"',
      `Matched ${searchData.users?.length} user(s)`
    );

    // 2b: Role filter: TEACHER
    const teacherRoleRes = await fetch(`${BASE_URL}/api/admin/users?role=TEACHER`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const teacherRoleData = (await teacherRoleRes.json()) as any;
    const allTeachers = teacherRoleData.users?.every((u: any) => u.role.toUpperCase() === 'TEACHER');
    assert(
      teacherRoleRes.status === 200 && teacherRoleData.users?.length > 0 && allTeachers,
      'Query param ?role=TEACHER returns only users where role === "TEACHER"',
      `Matched ${teacherRoleData.users?.length} teacher(s)`
    );

    // 2c: Role filter: STUDENT
    const studentRoleRes = await fetch(`${BASE_URL}/api/admin/users?role=STUDENT`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const studentRoleData = (await studentRoleRes.json()) as any;
    const allStudents = studentRoleData.users?.every((u: any) => u.role.toUpperCase() === 'STUDENT');
    assert(
      studentRoleRes.status === 200 && studentRoleData.users?.length > 0 && allStudents,
      'Query param ?role=STUDENT returns only users where role === "STUDENT"',
      `Matched ${studentRoleData.users?.length} student(s)`
    );

    // 2d: Status filter: SUSPENDED
    const suspendedRes = await fetch(`${BASE_URL}/api/admin/users?status=SUSPENDED`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const suspendedData = (await suspendedRes.json()) as any;
    const allSuspended = suspendedData.users?.every(
      (u: any) => u.status.toUpperCase() === 'SUSPENDED' || u.isSuspended === true
    );
    assert(
      suspendedRes.status === 200 && suspendedData.users?.length > 0 && allSuspended,
      'Query param ?status=SUSPENDED returns only users where status === "SUSPENDED"',
      `Matched ${suspendedData.users?.length} suspended user(s)`
    );

    // 2e: Combined filter (Role=TEACHER & Status=PENDING)
    const combinedRes = await fetch(`${BASE_URL}/api/admin/users?role=TEACHER&status=PENDING`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const combinedData = (await combinedRes.json()) as any;
    const allCombined = combinedData.users?.every(
      (u: any) => u.role.toUpperCase() === 'TEACHER' && u.status.toUpperCase() === 'PENDING'
    );
    assert(
      combinedRes.status === 200 && allCombined,
      'Combined query param ?role=TEACHER&status=PENDING returns only pending teachers',
      `Matched ${combinedData.users?.length} user(s)`
    );

    // -------------------------------------------------------------------------
    // TEST 3: AC 3.4.2 — Dynamic Role Modification (STUDENT -> TEACHER)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 3]\x1b[0m Verifying dynamic role modification (AC 3.4.2)...\n');

    const targetUserId = 'student-demo-2'; // Maya Patel (starts as STUDENT)
    const beforeUser = userDirectoryStore.get(targetUserId);
    assert(
      beforeUser?.role === 'STUDENT',
      'Target user begins with role === "STUDENT"',
      `Current role: ${beforeUser?.role}`
    );

    const changeRoleRes = await fetch(`${BASE_URL}/api/admin/users/${targetUserId}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: 'TEACHER' }),
    });
    const changeRoleData = (await changeRoleRes.json()) as any;

    assert(
      changeRoleRes.status === 200,
      'PATCH /api/admin/users/:userId/role returns HTTP 200 OK',
      `Got status ${changeRoleRes.status}`
    );

    assert(
      changeRoleData.user?.role === 'TEACHER' && changeRoleData.user?.isApproved === true,
      'User role modified to TEACHER with isApproved = true',
      JSON.stringify(changeRoleData.user)
    );

    // Verify updated role in directory query
    const verifyDirectoryRes = await fetch(`${BASE_URL}/api/admin/users?search=Maya`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const verifyDirectoryData = (await verifyDirectoryRes.json()) as any;
    const updatedUserInDir = verifyDirectoryData.users?.find((u: any) => u.id === targetUserId);

    assert(
      updatedUserInDir?.role === 'TEACHER' && updatedUserInDir?.isApproved === true,
      'User directory immediately reflects updated TEACHER role badge',
      `Got role: ${updatedUserInDir?.role}`
    );

    // Validation rejection for missing/invalid role
    const invalidRoleRes = await fetch(`${BASE_URL}/api/admin/users/${targetUserId}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: 'SUPER_HERO' }),
    });
    assert(
      invalidRoleRes.status === 400,
      'Invalid role value returns 400 Bad Request with validation message',
      `Got status ${invalidRoleRes.status}`
    );

    // -------------------------------------------------------------------------
    // TEST 4: AC 3.4.3 — Account Suspension and Privilege Revocation
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 4]\x1b[0m Verifying account suspension & subsequent 403 ACCOUNT_SUSPENDED (AC 3.4.3)...\n');

    const suspendTargetId = 'student-demo-3'; // Lucas Garcia
    const suspendTargetToken = 'jwt_test_lucas_garcia';
    const suspendTargetUser: Me = {
      id: suspendTargetId,
      email: 'lucas.student@linkup.test',
      fullName: 'Lucas Garcia',
      role: 'STUDENT',
      isApproved: true,
      status: 'APPROVED',
      isSuspended: false,
    };
    setCachedUser(suspendTargetToken, suspendTargetUser, 60000);

    // 4a: Prior to suspension, user can call authenticated /api/me endpoint
    const preSuspendRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${suspendTargetToken}` },
    });
    assert(
      preSuspendRes.status === 200,
      'Active user can access authenticated /api/me prior to suspension',
      `Got status ${preSuspendRes.status}`
    );

    // 4b: Admin selects "Suspend Account"
    const suspendActionRes = await fetch(`${BASE_URL}/api/admin/users/${suspendTargetId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ isSuspended: true, status: 'SUSPENDED' }),
    });
    const suspendActionData = (await suspendActionRes.json()) as any;

    assert(
      suspendActionRes.status === 200,
      'PATCH /api/admin/users/:userId/status returns HTTP 200 OK',
      `Got status ${suspendActionRes.status}`
    );

    assert(
      suspendActionData.user?.isSuspended === true && suspendActionData.user?.status === 'SUSPENDED',
      'Profile set to isSuspended = true and status = "SUSPENDED"',
      JSON.stringify(suspendActionData.user)
    );

    // 4c: Subsequent requests return HTTP 403 Forbidden with exact code ACCOUNT_SUSPENDED
    const postSuspendRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${suspendTargetToken}` },
    });
    const postSuspendData = (await postSuspendRes.json()) as any;

    assert(
      postSuspendRes.status === 403,
      'Subsequent requests by suspended user return HTTP 403 Forbidden',
      `Got status ${postSuspendRes.status}`
    );

    assert(
      postSuspendData.error === 'ACCOUNT_SUSPENDED' || postSuspendData.error?.code === 'ACCOUNT_SUSPENDED',
      'Subsequent response body contains { error: "ACCOUNT_SUSPENDED" }',
      `Got error: ${JSON.stringify(postSuspendData.error)}`
    );

    // 4d: Admin unsuspends / restores the account
    const restoreRes = await fetch(`${BASE_URL}/api/admin/users/${suspendTargetId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ isSuspended: false, action: 'unsuspend' }),
    });
    assert(
      restoreRes.status === 200,
      'Admin unsuspending account returns HTTP 200 OK',
      `Got status ${restoreRes.status}`
    );

    // User can access authenticated endpoints again after unsuspend
    const postRestoreRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${suspendTargetToken}` },
    });
    assert(
      postRestoreRes.status === 200,
      'Restored user can access authenticated endpoints again',
      `Got status ${postRestoreRes.status}`
    );

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log('\n============================================================');
    console.log(`Test Execution Finished: ${passedCount} Passed, ${failedCount} Failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    } else {
      console.log('🎉 All US-3.4 backend tests passed successfully!\n');
      process.exit(0);
    }
  } catch (err) {
    console.error('Fatal error during test execution:', err);
    process.exit(1);
  } finally {
    testServer.close();
  }
}

runTests();
