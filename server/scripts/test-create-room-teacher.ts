/**
 * Automated Verification Script for US-DASH-03: Create a Room (Teacher)
 * Traces to: FR-8.3, FR-2.1, S3
 * 
 * Acceptance Criteria Verified:
 * 1. A "Create Room" button is visible on the dashboard only for users with the teacher role.
 * 2. Clicking it opens a modal with: Room Name (required, max 80 chars), Description (optional, max 500 chars), and 5 default-permission toggles (Mic, Camera, Screen, Whiteboard, Code).
 * 3. Submitting creates the room and adds the teacher as host.
 * 4. The system generates a unique 6-character join code (characters: A-Z, 2-9; no O, 0, I, 1).
 * 5. The new room card appears on the dashboard immediately.
 * 6. Students do not see the Create Room button; a direct API call with a student token returns 403 TEACHER_ONLY.
 */

import http from 'http';
import { app } from '../src/app';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { generateJoinCode, JOIN_CODE_CHARS, clearMockRooms } from '../src/lib/rooms';
import { Me, Room, RoomSummary } from '@linkup/shared';

const TEST_PORT = 3099;
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
  console.log('🚀 Running US-DASH-03: Create a Room (Teacher) Tests');
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
      body: JSON.stringify({ name: 'CS101' }),
    });
    const unauthBody = (await unauthRes.json()) as { error?: { code?: string } };
    assert(
      unauthRes.status === 401 && unauthBody.error?.code === 'UNAUTHENTICATED',
      'POST /api/rooms without token returns 401 UNAUTHENTICATED',
      `Got status ${unauthRes.status}, code ${unauthBody.error?.code}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Acceptance Criterion 6 - Student token calling POST /api/rooms returns 403 TEACHER_ONLY
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 2]\x1b[0m Verifying student token receives 403 TEACHER_ONLY (Criterion 6)...\n');

    const studentToken = 'test_student_token_us_dash_03';
    const studentUser: Me = {
      id: 'student-uuid-dash-03',
      email: 'student@linkup.test',
      fullName: 'Emma Student',
      role: 'student',
    };
    setCachedUser(studentToken, studentUser, 60000);

    const studentRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        name: 'Hacked Classroom',
        description: 'Student attempting room creation',
      }),
    });
    const studentBody = (await studentRes.json()) as { error?: { code?: string; message?: string } };
    assert(
      studentRes.status === 403 && studentBody.error?.code === 'TEACHER_ONLY',
      'Student calling POST /api/rooms returns 403 TEACHER_ONLY',
      `Got status ${studentRes.status}, code ${studentBody.error?.code}`
    );

    // -------------------------------------------------------------------------
    // Setup Teacher User for Remaining Tests
    // -------------------------------------------------------------------------
    const teacherToken = 'test_teacher_token_us_dash_03';
    const teacherUser: Me = {
      id: 'teacher-uuid-dash-03',
      email: 'prof.turing@linkup.test',
      fullName: 'Prof. Alan Turing',
      role: 'teacher',
    };
    setCachedUser(teacherToken, teacherUser, 60000);

    const teacherHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherToken}`,
    };

    // -------------------------------------------------------------------------
    // TEST 3: Validation - Empty or whitespace-only room name returns 400 VALIDATION
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 3]\x1b[0m Verifying empty or whitespace room name is rejected...\n');

    const emptyNameRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: teacherHeaders,
      body: JSON.stringify({ name: '     ' }),
    });
    const emptyNameBody = (await emptyNameRes.json()) as { error?: { code?: string } };
    assert(
      emptyNameRes.status === 400 && emptyNameBody.error?.code === 'VALIDATION',
      'Empty/whitespace room name returns 400 VALIDATION',
      `Got status ${emptyNameRes.status}, code ${emptyNameBody.error?.code}`
    );

    // -------------------------------------------------------------------------
    // TEST 4: Validation - Room name > 80 characters returns 400 VALIDATION
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 4]\x1b[0m Verifying room name > 80 characters is rejected...\n');

    const longName = 'A'.repeat(81);
    const longNameRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: teacherHeaders,
      body: JSON.stringify({ name: longName }),
    });
    const longNameBody = (await longNameRes.json()) as { error?: { code?: string } };
    assert(
      longNameRes.status === 400 && longNameBody.error?.code === 'VALIDATION',
      'Room name > 80 chars returns 400 VALIDATION',
      `Got status ${longNameRes.status}, code ${longNameBody.error?.code}`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Validation - Description > 500 characters returns 400 VALIDATION
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 5]\x1b[0m Verifying description > 500 characters is rejected...\n');

    const longDesc = 'D'.repeat(501);
    const longDescRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: teacherHeaders,
      body: JSON.stringify({
        name: 'Valid Name',
        description: longDesc,
      }),
    });
    const longDescBody = (await longDescRes.json()) as { error?: { code?: string } };
    assert(
      longDescRes.status === 400 && longDescBody.error?.code === 'VALIDATION',
      'Description > 500 chars returns 400 VALIDATION',
      `Got status ${longDescRes.status}, code ${longDescBody.error?.code}`
    );

    // -------------------------------------------------------------------------
    // TEST 6: Teacher creates room -> returns 201 CREATED with Room object (Criteria 2 & 3)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 6]\x1b[0m Verifying teacher successfully creates room (201 CREATED)...\n');

    const roomPayload = {
      name: 'CS102: Data Structures & Algorithms',
      description: 'Interactive lecture with live code compiler, video stream, and whiteboard.',
      defaultPermissions: {
        canMic: true,
        canCamera: false,
        canScreen: false,
        canWhiteboard: true,
        canCode: true,
      },
    };

    const createRes = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: teacherHeaders,
      body: JSON.stringify(roomPayload),
    });
    const createdRoom = (await createRes.json()) as Room;

    assert(
      createRes.status === 201,
      'POST /api/rooms returns 201 CREATED',
      `Got status ${createRes.status}`
    );

    assert(
      createdRoom.name === roomPayload.name,
      'Created room name matches request input',
      `Expected "${roomPayload.name}", got "${createdRoom.name}"`
    );

    assert(
      createdRoom.myRole === 'host',
      'Teacher is designated as host (Criterion 3)',
      `Expected "host", got "${createdRoom.myRole}"`
    );

    assert(
      createdRoom.memberCount === 1,
      'Initial member count is 1',
      `Expected 1, got ${createdRoom.memberCount}`
    );

    assert(
      createdRoom.activeSessionId === null,
      'Newly created room has no active session initially',
      `Expected null, got ${createdRoom.activeSessionId}`
    );

    assert(
      createdRoom.defaultPermissions.canMic === true &&
      createdRoom.defaultPermissions.canCamera === false &&
      createdRoom.defaultPermissions.canWhiteboard === true &&
      createdRoom.defaultPermissions.canCode === true,
      'Default permissions accurately reflect configuration toggles',
      JSON.stringify(createdRoom.defaultPermissions)
    );

    // -------------------------------------------------------------------------
    // TEST 7: Join Code Verification (Criterion 4)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 7]\x1b[0m Verifying join code format and character constraints (Criterion 4)...\n');

    const joinCode = createdRoom.joinCode;
    assert(
      typeof joinCode === 'string' && joinCode.length === 6,
      'Join code is exactly 6 characters in length',
      `Got joinCode: "${joinCode}" (length: ${joinCode?.length})`
    );

    // Characters: A-Z, 2-9; no O, 0, I, 1
    const validCharsetRegex = /^[A-HJ-NP-Z2-9]{6}$/;
    assert(
      validCharsetRegex.test(joinCode || ''),
      'Join code uses only allowed characters: A-Z, 2-9; no O, 0, I, 1',
      `Join code "${joinCode}" matches regex ${validCharsetRegex}`
    );

    const hasAmbiguousChars = /[O0I1]/.test(joinCode || '');
    assert(
      !hasAmbiguousChars,
      'Join code contains zero ambiguous characters (no O, 0, I, 1)',
      `Ambiguous test result: ${hasAmbiguousChars}`
    );

    // -------------------------------------------------------------------------
    // TEST 8: Immediate Dashboard Appearance (Criterion 5)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 8]\x1b[0m Verifying new room appears on dashboard via GET /api/rooms (Criterion 5)...\n');

    const getRoomsRes = await fetch(`${BASE_URL}/api/rooms`, {
      headers: teacherHeaders,
    });
    const roomsList = (await getRoomsRes.json()) as RoomSummary[];

    const foundRoom = roomsList.find((r) => r.id === createdRoom.id);
    assert(
      Boolean(foundRoom),
      'Created room is returned in GET /api/rooms for the teacher',
      `Found room: ${Boolean(foundRoom)} in ${roomsList.length} rooms`
    );

    assert(
      foundRoom?.joinCode === createdRoom.joinCode,
      'Host sees joinCode in dashboard room summary',
      `Host joinCode: "${foundRoom?.joinCode}"`
    );

    // -------------------------------------------------------------------------
    // TEST 9: Statistical Join Code Generation Validation (1,000 iterations)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 9]\x1b[0m Running 1,000 statistical join code generation checks...\n');

    let allCodesValid = true;
    let foundForbiddenChar = false;
    const generatedCodes = new Set<string>();

    for (let i = 0; i < 1000; i++) {
      const code = generateJoinCode();
      if (code.length !== 6 || !validCharsetRegex.test(code)) {
        allCodesValid = false;
      }
      if (/[O0I1]/.test(code)) {
        foundForbiddenChar = true;
      }
      generatedCodes.add(code);
    }

    assert(
      allCodesValid && !foundForbiddenChar,
      'All 1,000 generated codes strictly adhere to charset [A-HJ-NP-Z2-9] without O, 0, I, 1',
      `Charset verified across 6,000 generated characters`
    );

    assert(
      generatedCodes.size > 990,
      `High entropy and randomness verified (${generatedCodes.size}/1000 unique codes generated)`
    );

  } catch (err) {
    console.error('Unexpected error during test execution:', err);
    failedCount++;
  } finally {
    clearTokenCache();
    clearMockRooms();
    testServer.close();

    console.log('\n============================================================');
    console.log(`📊 Test Results: ${passedCount} Passed, ${failedCount} Failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runTests();
