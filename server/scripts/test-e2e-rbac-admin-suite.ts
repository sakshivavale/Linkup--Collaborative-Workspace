/**
 * Automated End-to-End Validation Suite for US-4.1 (Issue #160)
 * Module: Team Collaboration & End-to-End Test Scenarios
 *
 * Detailed Test Scenarios Covered:
 * 4.1.1 E2E Test: Student Registration & Immediate Platform Access (E2E-STUDENT-REG)
 * 4.1.2 E2E Test: Teacher Registration & Pending Gating Screen (E2E-TEACHER-GATING)
 * 4.1.3 E2E Test: Super-Admin Hardcoded Auto-Approval Bypass (E2E-ADMIN-SUPER)
 * 4.1.4 E2E Test: Admin Approval Execution (E2E-ADMIN-APPROVAL-FLOW)
 * 4.1.5 E2E Test: Post-Approval Teacher Room Creation (E2E-TEACHER-POST-APPROVAL)
 * 4.1.6 E2E Test: Non-Admin Route & API Blocking (403 Enforcement) (E2E-SECURITY-ROUTE-GUARDS)
 */

import http from 'http';
import crypto from 'crypto';
import { app, pendingTeachersStore, userDirectoryStore } from '../src/app';
import { Me } from '@linkup/shared';
import { supabase, setCachedUser, setUserSuspension } from '../src/lib/supabase';

const TEST_PORT = 3114;
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

async function runE2ESuite() {
  console.log('\n============================================================');
  console.log('🚀 Running US-4.1: Automated End-to-End Validation Suite (Issue #160)');
  console.log('============================================================\n');

  const testServer = http.createServer(app);
  let createdTeacherId = '';
  let createdRoomId = '';

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[E2E Test Server] Running on ${BASE_URL}\n`);
      resolve();
    });
  });

  try {
    // =========================================================================
    // SCENARIO 4.1.1: Student Registration & Immediate Platform Access (E2E-STUDENT-REG)
    // =========================================================================
    console.log('\x1b[34m[Scenario 4.1.1]\x1b[0m E2E-STUDENT-REG: Student Registration & Immediate Access...\n');

    const studentId = crypto.randomUUID();
    const studentEmail = `alex.student.${Date.now()}@linkup.io`;
    const studentToken = `token_${studentId}`;
    const studentUser: Me = {
      id: studentId,
      email: studentEmail,
      fullName: 'Alex Student',
      role: 'STUDENT',
      isApproved: true,
      status: 'APPROVED',
      isAdmin: false,
      isSuspended: false,
    };
    setCachedUser(studentToken, studentUser, 60000);
    userDirectoryStore.set(studentId, {
      id: studentId,
      fullName: studentUser.fullName,
      email: studentUser.email,
      role: 'STUDENT',
      status: 'APPROVED',
      isApproved: true,
      isSuspended: false,
      createdAt: new Date().toISOString(),
    });

    // 1. Verify student can access /api/me immediately upon signup
    const studentMeRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    const studentMeData = (await studentMeRes.json()) as any;

    assert(
      studentMeRes.status === 200,
      'Student can authenticate and access /api/me immediately upon signup',
      `Got status ${studentMeRes.status}`
    );
    assert(
      (studentMeData.user?.role || '').toLowerCase() === 'student' &&
        studentMeData.user?.isApproved === true,
      'Student database profile is verified with role = "STUDENT" and isApproved = true',
      JSON.stringify(studentMeData.user)
    );

    // 2. Room joining is active and accessible for student
    const studentRoomsRes = await fetch(`${BASE_URL}/api/rooms`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(
      studentRoomsRes.status === 200,
      'Student can query active rooms and join sessions on Student Dashboard (/)',
      `Got status ${studentRoomsRes.status}`
    );

    // 3. Student attempting to create rooms is prohibited (AC 2.1.3: TEACHER_ONLY)
    const studentCreateRoomRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ name: 'Student Room Attempt' }),
    });
    assert(
      studentCreateRoomRes.status === 403,
      'Student attempting room creation receives HTTP 403 TEACHER_ONLY',
      `Got status ${studentCreateRoomRes.status}`
    );

    // =========================================================================
    // SCENARIO 4.1.2: Teacher Registration & Pending Gating Screen (E2E-TEACHER-GATING)
    // =========================================================================
    console.log('\n\x1b[34m[Scenario 4.1.2]\x1b[0m E2E-TEACHER-GATING: Teacher Registration & Pending Gating...\n');

    let teacherId = crypto.randomUUID();
    const teacherEmail = `prof.marcus.test.${Date.now()}@linkup.io`;

    try {
      const { data: authUser } = await supabase.auth.admin.createUser({
        email: teacherEmail,
        password: 'Password123!',
        email_confirm: true,
        user_metadata: {
          full_name: 'Prof. Marcus Test',
          role: 'teacher',
        },
      });
      if (authUser?.user?.id) {
        teacherId = authUser.user.id;
      }
    } catch (e) {
      console.warn('Could not create auth user, falling back to random UUID');
    }

    createdTeacherId = teacherId;
    const teacherToken = `token_${teacherId}`;
    const pendingTeacherUser: Me = {
      id: teacherId,
      email: teacherEmail,
      fullName: 'Prof. Marcus Test',
      role: 'teacher',
      isApproved: false,
      status: 'PENDING_TEACHER',
      isAdmin: false,
      isSuspended: false,
    };
    setCachedUser(teacherToken, pendingTeacherUser, 60000);

    // Sync profile to database profiles table
    try {
      await supabase.from('profiles').upsert({
        id: teacherId,
        full_name: 'Prof. Marcus Test',
        role: 'teacher',
        isApproved: false,
        is_approved: false,
        status: 'PENDING_TEACHER',
      });
    } catch {}

    // Register teacher into backend notification queue
    const regRes = await fetch(`${BASE_URL}/api/auth/register-teacher`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: teacherId,
        fullName: 'Prof. Marcus Test',
        email: teacherEmail,
      }),
    });
    assert(
      regRes.status === 201,
      'Teacher registration endpoint dispatches pending registration event',
      `Got status ${regRes.status}`
    );

    // Verify unapproved teacher profile is isApproved = false & PENDING_TEACHER
    const teacherMeRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    const teacherMeData = (await teacherMeRes.json()) as any;
    assert(
      teacherMeData.user?.isApproved === false &&
        (teacherMeData.user?.status === 'PENDING_TEACHER' ||
          teacherMeData.user?.teacher_status === 'pending'),
      'Teacher account is created with isApproved = false and status = "PENDING_TEACHER"',
      JSON.stringify(teacherMeData.user)
    );

    // Unapproved teacher attempting to create a room is gated with 403 TEACHER_NOT_APPROVED
    const blockedCreateRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`,
      },
      body: JSON.stringify({ name: 'Blocked Teacher Room' }),
    });
    const blockedCreateData = (await blockedCreateRes.json()) as any;
    assert(
      blockedCreateRes.status === 403 &&
        (blockedCreateData.error === 'TEACHER_NOT_APPROVED' ||
          blockedCreateData.code === 'TEACHER_NOT_APPROVED'),
      'Unapproved teacher room creation is blocked with HTTP 403 TEACHER_NOT_APPROVED',
      `Status: ${blockedCreateRes.status}, Error: ${JSON.stringify(blockedCreateData.error)}`
    );

    // =========================================================================
    // SCENARIO 4.1.3: Super-Admin Hardcoded Auto-Approval Bypass (E2E-ADMIN-SUPER)
    // =========================================================================
    console.log('\n\x1b[34m[Scenario 4.1.3]\x1b[0m E2E-ADMIN-SUPER: Super-Admin Hardcoded Auto-Approval Bypass...\n');

    const superAdminEmail = 'sakshivavale9@gmail.com';
    const superAdminToken = 'mock-admin-token-sakshi';

    // 1. Verify super-admin token auto-provisions with role = 'ADMIN' and isApproved = true
    const adminMeRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    const adminMeData = (await adminMeRes.json()) as any;

    assert(
      adminMeRes.status === 200,
      'Super-admin (sakshivavale9@gmail.com) authenticates successfully',
      `Got status ${adminMeRes.status}`
    );
    assert(
      (adminMeData.user?.role || '').toUpperCase() === 'ADMIN' &&
        adminMeData.user?.isApproved === true,
      'Super-admin record immediately has role = "ADMIN" and isApproved = true (bypassing queue)',
      JSON.stringify(adminMeData.user)
    );

    // 2. Super-admin can access administrative overview & analytics cards (/admin)
    const analyticsRes = await fetch(`${BASE_URL}/api/admin/analytics/overview`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    const analyticsData = (await analyticsRes.json()) as any;
    assert(
      analyticsRes.status === 200,
      'Super-admin queries GET /api/admin/analytics/overview returning HTTP 200 OK',
      `Got status ${analyticsRes.status}`
    );
    assert(
      typeof analyticsData.totalUsers === 'number' &&
        typeof analyticsData.activeStudents === 'number' &&
        typeof analyticsData.approvedTeachers === 'number' &&
        typeof analyticsData.pendingApprovals === 'number' &&
        typeof analyticsData.activeRooms === 'number',
      'Platform analytics cards populated with numerical counts for all 5 KPI metrics',
      JSON.stringify(analyticsData)
    );

    // =========================================================================
    // SCENARIO 4.1.4: Admin Approval Execution (E2E-ADMIN-APPROVAL-FLOW)
    // =========================================================================
    console.log('\n\x1b[34m[Scenario 4.1.4]\x1b[0m E2E-ADMIN-APPROVAL-FLOW: Admin Approval Execution...\n');

    // 1. Verify Marcus is present in the pending approvals queue
    const queueBeforeRes = await fetch(`${BASE_URL}/api/admin/pending-teachers`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    const queueBeforeData = (await queueBeforeRes.json()) as any;
    const isMarcusInQueue = (queueBeforeData.pendingTeachers || []).some(
      (t: any) => t.id === teacherId || t.email === teacherEmail
    );
    assert(
      isMarcusInQueue,
      `Pending approvals queue contains applicant "${pendingTeacherUser.fullName}"`,
      `Found in queue? ${isMarcusInQueue}`
    );

    // 2. Admin executes approval action
    const approveRes = await fetch(`${BASE_URL}/api/admin/users/${teacherId}/approval`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ isApproved: true, status: 'APPROVED' }),
    });
    const approveData = (await approveRes.json()) as any;
    assert(
      approveRes.status === 200,
      'Admin approves pending teacher via PATCH /api/admin/users/:userId/approval returning HTTP 200 OK',
      `Got status ${approveRes.status}`
    );
    assert(
      approveData.isApproved === true && approveData.status === 'APPROVED',
      'Approval response updates status = "APPROVED" and isApproved = true',
      JSON.stringify(approveData)
    );

    // 3. Confirm applicant row is removed from pending queue
    const queueAfterRes = await fetch(`${BASE_URL}/api/admin/pending-teachers`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    const queueAfterData = (await queueAfterRes.json()) as any;
    const isStillInQueue = (queueAfterData.pendingTeachers || []).some(
      (t: any) => t.id === teacherId
    );
    assert(
      !isStillInQueue,
      'Approved teacher row is immediately removed from the pending approvals queue',
      `Still in queue? ${isStillInQueue}`
    );

    // =========================================================================
    // SCENARIO 4.1.5: Post-Approval Teacher Room Creation (E2E-TEACHER-POST-APPROVAL)
    // =========================================================================
    console.log('\n\x1b[34m[Scenario 4.1.5]\x1b[0m E2E-TEACHER-POST-APPROVAL: Post-Approval Room Creation...\n');

    // 1. Teacher session now reflects approval without requiring re-login
    const teacherPostMeRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    const teacherPostMeData = (await teacherPostMeRes.json()) as any;
    assert(
      teacherPostMeData.user?.isApproved === true,
      'Teacher active session is updated to isApproved = true immediately without re-login',
      `isApproved: ${teacherPostMeData.user?.isApproved}`
    );

    // 2. Teacher creates collaborative room via POST /api/rooms
    const createRoomRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`,
      },
      body: JSON.stringify({
        name: 'Advanced Algorithms 101',
        description: 'Live collaborative session',
      }),
    });
    const createRoomData = (await createRoomRes.json()) as any;
    if (createRoomData?.id || createRoomData?.room?.id) {
      createdRoomId = createRoomData.id || createRoomData.room?.id;
    }

    assert(
      createRoomRes.status === 201,
      'Approved teacher successfully creates room returning HTTP 201 Created',
      `Got status ${createRoomRes.status}`
    );

    const roomJoinCode =
      createRoomData.joinCode ||
      createRoomData.code ||
      createRoomData.room?.code ||
      createRoomData.room?.joinCode;
    const teacherMemberRole = createRoomData.myRole || createRoomData.room?.myRole;

    assert(
      typeof roomJoinCode === 'string' && /^[A-Z0-9]{6}$/.test(roomJoinCode),
      'New room receives a unique 6-character alphanumeric join code',
      `Code: ${roomJoinCode}`
    );
    assert(
      teacherMemberRole === 'host',
      'Creating teacher is granted "host" member privileges in collaborative room',
      `Role: ${teacherMemberRole}`
    );

    // =========================================================================
    // SCENARIO 4.1.6: Non-Admin Route & API Blocking (403 Enforcement) (E2E-SECURITY-ROUTE-GUARDS)
    // =========================================================================
    console.log('\n\x1b[34m[Scenario 4.1.6]\x1b[0m E2E-SECURITY-ROUTE-GUARDS: Non-Admin Route & API Blocking (403)...\n');

    const unauthorizedTokens = [
      { role: 'STUDENT', isApproved: true, token: studentToken, label: 'Approved Student' },
      { role: 'TEACHER', isApproved: true, token: teacherToken, label: 'Approved Teacher' },
    ];

    const protectedAdminEndpoints = [
      '/api/admin/analytics/overview',
      '/api/admin/users',
      '/api/admin/pending-teachers',
    ];

    for (const userCase of unauthorizedTokens) {
      for (const endpoint of protectedAdminEndpoints) {
        const testRes = await fetch(`${BASE_URL}${endpoint}`, {
          headers: { Authorization: `Bearer ${userCase.token}` },
        });
        assert(
          testRes.status === 403,
          `${userCase.label} querying ${endpoint} receives HTTP 403 Forbidden`,
          `Got status ${testRes.status}`
        );
      }
    }

    // Unapproved Admin (role: 'ADMIN', isApproved: false) is blocked with 403
    const unapprovedAdminToken = 'token_unapproved_admin_test';
    setCachedUser(
      unapprovedAdminToken,
      {
        id: 'admin-unapproved-id',
        email: 'staff.unapproved@school.org',
        fullName: 'Pending Admin',
        role: 'ADMIN',
        isApproved: false,
        status: 'PENDING',
        isAdmin: true,
      },
      60000
    );

    const unapprovedAdminRes = await fetch(`${BASE_URL}/api/admin/analytics/overview`, {
      headers: { Authorization: `Bearer ${unapprovedAdminToken}` },
    });
    assert(
      unapprovedAdminRes.status === 403,
      'Unapproved Admin (isApproved: false) receives HTTP 403 FORBIDDEN_ADMIN_ONLY',
      `Got status ${unapprovedAdminRes.status}`
    );

    // Suspended User privilege revocation (HTTP 403 ACCOUNT_SUSPENDED)
    const disruptiveUserId = 'disruptive-user-e2e';
    const disruptiveToken = 'token_disruptive_e2e';
    setCachedUser(
      disruptiveToken,
      {
        id: disruptiveUserId,
        email: 'disruptive@linkup.test',
        fullName: 'Disruptive User',
        role: 'STUDENT',
        isApproved: true,
        status: 'APPROVED',
        isSuspended: false,
      },
      60000
    );

    // Admin suspends disruptive user
    setUserSuspension(disruptiveUserId, true);
    const suspendedReqRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${disruptiveToken}` },
    });
    const suspendedReqData = (await suspendedReqRes.json()) as any;
    assert(
      suspendedReqRes.status === 403,
      'Suspended user access to authenticated endpoints returns HTTP 403 Forbidden',
      `Got status ${suspendedReqRes.status}`
    );
    assert(
      suspendedReqData.error === 'ACCOUNT_SUSPENDED' ||
        suspendedReqData.error?.code === 'ACCOUNT_SUSPENDED',
      'Suspended user receives error code "ACCOUNT_SUSPENDED"',
      `Got error: ${JSON.stringify(suspendedReqData.error)}`
    );

    // =========================================================================
    // FINAL SUMMARY
    // =========================================================================
    console.log('\n============================================================');
    console.log(`E2E Test Execution Summary: ${passedCount} Passed, ${failedCount} Failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    } else {
      console.log('🎉 All US-4.1 E2E Integration Scenarios (4.1.1 — 4.1.6) Passed Successfully!\n');
      process.exit(0);
    }
  } catch (err) {
    console.error('Fatal error during E2E test execution:', err);
    process.exit(1);
  } finally {
    try {
      if (createdRoomId) {
        await supabase.from('rooms').delete().eq('id', createdRoomId);
      }
      if (createdTeacherId) {
        await supabase.from('profiles').delete().eq('id', createdTeacherId);
        await supabase.auth.admin.deleteUser(createdTeacherId);
      }
    } catch {}
    testServer.close();
  }
}

runE2ESuite();
