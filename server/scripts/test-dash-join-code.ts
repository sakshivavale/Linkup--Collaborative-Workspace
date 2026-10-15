/**
 * Automated Verification Script for US-DASH-04: Join a Room with Code (Student)
 * Priority: P0 | Traces to: FR-8.3, FR-2.3, S3
 *
 * Acceptance Criteria Verified:
 * 1. A "Join with Code" input and button is always visible for students (and also teachers).
 * 2. The code is case-insensitive; the server normalises to uppercase before lookup.
 * 3. On success, the user is added to the room and the room card appears on the dashboard.
 * 4. Joining a room you are already a member of is idempotent (no error, no duplicate membership).
 * 5. An unknown code shows: "No room found with that code."
 */

import http from 'http';
import { app } from '../src/app';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { 
  registerMockCatalogRoom, 
  clearMockCatalog, 
  setMockRooms, 
  clearMockRooms 
} from '../src/lib/rooms';
import { Me } from '@linkup/shared';

const TEST_PORT = 3098;
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
  console.log('🚀 Running US-DASH-04: Join a Room with Code Tests');
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
    // TEST 1: Unauthenticated request to POST /api/rooms/join returns 401
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Test 1]\x1b[0m Verifying unauthenticated POST /api/rooms/join is rejected with 401 UNAUTHENTICATED...\n');

    const unauthRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABC123' }),
    });
    const unauthBody = (await unauthRes.json()) as { error?: { code?: string } };
    assert(
      unauthRes.status === 401 && unauthBody.error?.code === 'UNAUTHENTICATED',
      'POST /api/rooms/join without token returns 401 UNAUTHENTICATED',
      `Got status ${unauthRes.status}, code ${unauthBody.error?.code}`
    );

    // -------------------------------------------------------------------------
    // SETUP: Register test student and sample mock rooms
    // -------------------------------------------------------------------------
    const studentToken = 'valid_student_token_us_dash_04';
    const studentUser: Me = {
      id: 'student-uuid-dash-04',
      email: 'student@linkup.test',
      fullName: 'Alex Student',
      role: 'student',
    };
    setCachedUser(studentToken, studentUser, 60000);

    const studentHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${studentToken}`,
    };

    // Teacher user
    const teacherToken = 'valid_teacher_token_us_dash_04';
    const teacherUser: Me = {
      id: 'teacher-uuid-dash-04',
      email: 'teacher2@linkup.test',
      fullName: 'Prof. Marie Curie',
      role: 'teacher',
    };
    setCachedUser(teacherToken, teacherUser, 60000);

    const teacherHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherToken}`,
    };

    // Clear mock state and setup available catalog room
    clearMockCatalog();
    clearMockRooms();

    registerMockCatalogRoom({
      id: 'room-cs101-uuid',
      name: 'CS101: Intro to Computer Science',
      description: 'Fall semester lecture room',
      joinCode: 'CS101A',
      hostName: 'Prof. Alan Turing',
    });

    registerMockCatalogRoom({
      id: 'room-math201-uuid',
      name: 'MATH201: Calculus & Linear Algebra',
      description: 'Mathematics tutorial workspace',
      joinCode: 'MTH201',
      hostName: 'Dr. Ada Lovelace',
    });

    // Initial state: student has 0 rooms
    setMockRooms(studentUser.id, []);

    // -------------------------------------------------------------------------
    // TEST 2: Missing or invalid code returns 400 VALIDATION
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 2]\x1b[0m Verifying empty or invalid code returns 400 VALIDATION...\n');

    const emptyCodeRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ code: '' }),
    });
    const emptyCodeBody = (await emptyCodeRes.json()) as { error?: { code?: string } };
    assert(
      emptyCodeRes.status === 400 && emptyCodeBody.error?.code === 'VALIDATION',
      'Empty code returns 400 VALIDATION',
      `Got status ${emptyCodeRes.status}`
    );

    const shortCodeRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ code: 'ABC' }),
    });
    const shortCodeBody = (await shortCodeRes.json()) as { error?: { code?: string } };
    assert(
      shortCodeRes.status === 400 && shortCodeBody.error?.code === 'VALIDATION',
      'Short code (< 6 chars) returns 400 VALIDATION',
      `Got status ${shortCodeRes.status}`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Acceptance Criterion 5: Unknown code returns "No room found with that code."
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 3]\x1b[0m Verifying unknown code shows "No room found with that code." (AC-5)...\n');

    const unknownRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ code: 'ZZZZ99' }),
    });
    const unknownBody = (await unknownRes.json()) as { error?: { code?: string; message?: string } };
    assert(
      unknownRes.status === 404 &&
      unknownBody.error?.code === 'ROOM_NOT_FOUND' &&
      unknownBody.error?.message === 'No room found with that code.',
      'Unknown code returns 404 ROOM_NOT_FOUND with exact message "No room found with that code."',
      `Got status ${unknownRes.status}, message: "${unknownBody.error?.message}"`
    );

    // -------------------------------------------------------------------------
    // TEST 4: Acceptance Criterion 2: Case-insensitivity (lowercase code "cs101a")
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 4]\x1b[0m Verifying code is case-insensitive and normalises to uppercase (AC-2)...\n');

    const caseRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ code: 'cs101a' }), // lowercase entered by user
    });
    const caseBody = (await caseRes.json()) as { roomId?: string };
    assert(
      caseRes.status === 200 && caseBody.roomId === 'room-cs101-uuid',
      'Submitting lowercase "cs101a" joins uppercase "CS101A" room',
      `Got status ${caseRes.status}, roomId: ${caseBody.roomId}`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Acceptance Criterion 3: On success, user added and room appears on dashboard
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 5]\x1b[0m Verifying room card appears in user dashboard rooms list (AC-3)...\n');

    const getRoomsRes = await fetch(`${BASE_URL}/api/rooms`, {
      headers: studentHeaders,
    });
    const rooms = (await getRoomsRes.json()) as Array<{ id: string; name: string }>;
    assert(
      getRoomsRes.status === 200 &&
      Array.isArray(rooms) &&
      rooms.some((r) => r.id === 'room-cs101-uuid'),
      'Joined room appears on student dashboard GET /api/rooms',
      `Rooms count: ${rooms.length}`
    );

    // -------------------------------------------------------------------------
    // TEST 6: Acceptance Criterion 4: Idempotency (joining again returns success without error/duplicate)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 6]\x1b[0m Verifying idempotency when joining a room user is already a member of (AC-4)...\n');

    const reJoinRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ code: 'CS101A' }),
    });
    const reJoinBody = (await reJoinRes.json()) as { roomId?: string };
    assert(
      reJoinRes.status === 200 && reJoinBody.roomId === 'room-cs101-uuid',
      'Re-joining room returns 200 without error',
      `Got status ${reJoinRes.status}`
    );

    // Check no duplicate rooms in dashboard
    const getRoomsAfterRes = await fetch(`${BASE_URL}/api/rooms`, {
      headers: studentHeaders,
    });
    const roomsAfter = (await getRoomsAfterRes.json()) as Array<{ id: string }>;
    const duplicates = roomsAfter.filter((r) => r.id === 'room-cs101-uuid');
    assert(
      duplicates.length === 1,
      'No duplicate room memberships created',
      `Instances in room list: ${duplicates.length}`
    );

    // -------------------------------------------------------------------------
    // TEST 7: Acceptance Criterion 1: Teachers can also join another teacher\'s room
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 7]\x1b[0m Verifying teachers can also join rooms using code (AC-1)...\n');

    setMockRooms(teacherUser.id, []);
    const teacherJoinRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: teacherHeaders,
      body: JSON.stringify({ code: 'mth201' }),
    });
    const teacherJoinBody = (await teacherJoinRes.json()) as { roomId?: string };
    assert(
      teacherJoinRes.status === 200 && teacherJoinBody.roomId === 'room-math201-uuid',
      'Teacher can join another teacher room with code',
      `Got status ${teacherJoinRes.status}, roomId: ${teacherJoinBody.roomId}`
    );

  } finally {
    clearTokenCache();
    clearMockCatalog();
    clearMockRooms();
    await new Promise<void>((resolve) => testServer.close(() => resolve()));
    console.log('\n[Test Server] Shut down.\n');
  }

  console.log('============================================================');
  console.log(`Summary: ${passedCount} passed, ${failedCount} failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
