/**
 * Automated Verification Suite for US-3.3: Direct "+ Add Teacher" Pre-Approved Provisioning
 * Issue: #158
 *
 * Acceptance Criteria Verified:
 * AC 3.3.1 — "+ Add Teacher" Modal Trigger and Form Fields:
 *   - Modal fields validation: Full Name (required), Institutional Email (required),
 *     Temporary Password (auto-generated / provided), Department (optional),
 *     and Checkbox: "Pre-approve immediately" (default true).
 *
 * AC 3.3.2 — Successful Pre-Approved Teacher Creation:
 *   - Admin calls POST /api/admin/teachers/provision with valid details and preApprove = true
 *   - Account is created with role: 'TEACHER', isApproved: true, status: 'APPROVED'
 *   - Response returns temporary credentials ready to copy and share.
 *   - Provisioned teacher does not pollute pending approval queue.
 *
 * AC 3.3.3 — Duplicate Email Handling:
 *   - When attempting to provision with an email that already exists
 *   - Returns HTTP 409 Conflict with error code DUPLICATE_EMAIL
 *   - Returns message: "A user with this email address already exists in the system."
 */

import http from 'http';
import { app, pendingTeachersStore, provisionedTeachersStore } from '../src/app';
import { Me } from '@linkup/shared';
import { setCachedUser } from '../src/lib/supabase';

const TEST_PORT = 3112;
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
  console.log('🚀 Running US-3.3: Direct "+ Add Teacher" Pre-Approved Provisioning Tests');
  console.log('============================================================\n');

  const testServer = http.createServer(app);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  try {
    const adminToken = 'jwt_test_admin_us33';
    const adminUser: Me = {
      id: 'admin-uuid-us33',
      email: 'admin.director@linkup.test',
      fullName: 'Chief Administrator',
      role: 'ADMIN',
      isApproved: true,
      status: 'APPROVED',
      isAdmin: true,
    };
    setCachedUser(adminToken, adminUser, 60000);

    const studentToken = 'jwt_test_student_us33';
    const studentUser: Me = {
      id: 'student-uuid-us33',
      email: 'student.unauthorized@linkup.test',
      fullName: 'Regular Student',
      role: 'student',
      isApproved: true,
      status: 'APPROVED',
      isAdmin: false,
    };
    setCachedUser(studentToken, studentUser, 60000);

    const teacherToken = 'jwt_test_teacher_us33';
    const teacherUser: Me = {
      id: 'teacher-uuid-us33',
      email: 'teacher.unauthorized@linkup.test',
      fullName: 'Regular Teacher',
      role: 'teacher',
      isApproved: true,
      status: 'APPROVED',
      isAdmin: false,
    };
    setCachedUser(teacherToken, teacherUser, 60000);

    // -------------------------------------------------------------------------
    // TEST 1: Route Protection & Admin RBAC Enforcement
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Test 1]\x1b[0m Verifying RBAC protection on POST /api/admin/teachers/provision...\n');

    const unauthRes = await fetch(`${BASE_URL}/api/admin/teachers/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Dr. Test', email: 'test@oxford.edu' }),
    });
    assert(
      unauthRes.status === 401,
      'Unauthenticated request to POST /api/admin/teachers/provision returns 401 Unauthorized',
      `Got status ${unauthRes.status}`
    );

    const studentRes = await fetch(`${BASE_URL}/api/admin/teachers/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ fullName: 'Dr. Test', email: 'test@oxford.edu' }),
    });
    assert(
      studentRes.status === 403,
      'Student request to POST /api/admin/teachers/provision returns 403 Forbidden',
      `Got status ${studentRes.status}`
    );

    const regularTeacherRes = await fetch(`${BASE_URL}/api/admin/teachers/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`,
      },
      body: JSON.stringify({ fullName: 'Dr. Test', email: 'test@oxford.edu' }),
    });
    assert(
      regularTeacherRes.status === 403,
      'Teacher request to POST /api/admin/teachers/provision returns 403 Forbidden',
      `Got status ${regularTeacherRes.status}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: AC 3.3.1 — Form Fields Validation (Required fields)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 2]\x1b[0m Verifying required field validation (AC 3.3.1)...\n');

    // Missing Full Name
    const missingNameRes = await fetch(`${BASE_URL}/api/admin/teachers/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ email: 'teacher@oxford.edu' }),
    });
    const missingNameData = (await missingNameRes.json()) as any;
    assert(
      missingNameRes.status === 400 && missingNameData?.error?.message?.includes('Full Name is required'),
      'Missing Full Name returns 400 Bad Request with validation error message',
      `Got status ${missingNameRes.status}`
    );

    // Missing Institutional Email
    const missingEmailRes = await fetch(`${BASE_URL}/api/admin/teachers/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ fullName: 'Dr. Alan Turing' }),
    });
    const missingEmailData = (await missingEmailRes.json()) as any;
    assert(
      missingEmailRes.status === 400 && missingEmailData?.error?.message?.includes('Institutional Email is required'),
      'Missing Institutional Email returns 400 Bad Request with validation error message',
      `Got status ${missingEmailRes.status}`
    );

    // -------------------------------------------------------------------------
    // TEST 3: AC 3.3.2 — Successful Pre-Approved Teacher Creation
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 3]\x1b[0m Verifying successful pre-approved teacher provisioning (AC 3.3.2)...\n');

    const teacherEmail = `prof.grace.hopper.${Date.now()}@navy.edu`;
    const provisionRes = await fetch(`${BASE_URL}/api/admin/teachers/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        fullName: 'Rear Admiral Grace Hopper',
        email: teacherEmail,
        department: 'Computer Systems & Compilers',
        preApprove: true,
      }),
    });
    const provisionData = (await provisionRes.json()) as any;

    assert(
      provisionRes.status === 201,
      'POST /api/admin/teachers/provision returns HTTP 201 Created',
      `Got status ${provisionRes.status}`
    );

    assert(
      provisionData.success === true,
      'Response payload confirms successful provisioning (success === true)'
    );

    assert(
      provisionData.teacher?.role === 'teacher' &&
        provisionData.teacher?.isApproved === true &&
        provisionData.teacher?.status === 'APPROVED',
      'Teacher account created with role="teacher", isApproved=true, status="APPROVED"',
      JSON.stringify(provisionData.teacher)
    );

    assert(
      typeof provisionData.credentials?.temporaryPassword === 'string' &&
        provisionData.credentials.temporaryPassword.length >= 8,
      'Response includes temporary password credentials for sharing with instructor',
      `Got temporaryPassword: ${provisionData.credentials?.temporaryPassword}`
    );

    // Verify teacher is NOT in the pending approval queue
    const queueCheckRes = await fetch(`${BASE_URL}/api/admin/pending-teachers`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const queueCheckData = (await queueCheckRes.json()) as any;
    const isFoundInPending = (queueCheckData.pendingTeachers || []).some(
      (t: any) => t.email.toLowerCase() === teacherEmail.toLowerCase()
    );
    assert(
      !isFoundInPending,
      'Pre-approved teacher is NOT placed into pending approval queue (bypassed queue directly)',
      `Found in queue? ${isFoundInPending}`
    );

    // -------------------------------------------------------------------------
    // TEST 4: AC 3.3.3 — Duplicate Email Handling
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 4]\x1b[0m Verifying duplicate email rejection with exact error message (AC 3.3.3)...\n');

    const duplicateRes = await fetch(`${BASE_URL}/api/admin/teachers/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        fullName: 'Another Instructor',
        email: teacherEmail, // Re-submitting the exact same email
        department: 'Mathematics',
        preApprove: true,
      }),
    });
    const duplicateData = (await duplicateRes.json()) as any;

    assert(
      duplicateRes.status === 409,
      'Duplicate email submission returns HTTP 409 Conflict',
      `Got status ${duplicateRes.status}`
    );

    assert(
      duplicateData?.error?.code === 'DUPLICATE_EMAIL',
      'Duplicate error returns error code "DUPLICATE_EMAIL"',
      `Got code: ${duplicateData?.error?.code}`
    );

    assert(
      duplicateData?.error?.message === 'A user with this email address already exists in the system.',
      'Duplicate error returns exact message: "A user with this email address already exists in the system."',
      `Got message: "${duplicateData?.error?.message}"`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Provision with preApprove = false (Queued for verification)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 5]\x1b[0m Verifying teacher provisioning with preApprove = false...\n');

    const unapprovedEmail = `prof.donald.knuth.${Date.now()}@stanford.edu`;
    const unapprovedRes = await fetch(`${BASE_URL}/api/admin/teachers/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        fullName: 'Prof. Donald Knuth',
        email: unapprovedEmail,
        department: 'Computer Science',
        preApprove: false,
      }),
    });
    const unapprovedData = (await unapprovedRes.json()) as any;

    assert(
      unapprovedRes.status === 201,
      'POST /api/admin/teachers/provision with preApprove=false returns HTTP 201 Created',
      `Got status ${unapprovedRes.status}`
    );

    assert(
      unapprovedData.teacher?.isApproved === false &&
        unapprovedData.teacher?.status === 'PENDING_TEACHER',
      'Account created with isApproved=false and status="PENDING_TEACHER"',
      JSON.stringify(unapprovedData.teacher)
    );

    // Verify this teacher DOES appear in the pending queue
    const queueCheckRes2 = await fetch(`${BASE_URL}/api/admin/pending-teachers`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const queueCheckData2 = (await queueCheckRes2.json()) as any;
    const isFoundInPending2 = (queueCheckData2.pendingTeachers || []).some(
      (t: any) => t.email.toLowerCase() === unapprovedEmail.toLowerCase()
    );
    assert(
      isFoundInPending2,
      'Non-pre-approved teacher is successfully placed in the pending approval queue',
      `Found in queue? ${isFoundInPending2}`
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
      console.log('🎉 All US-3.3 tests passed successfully!\n');
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
