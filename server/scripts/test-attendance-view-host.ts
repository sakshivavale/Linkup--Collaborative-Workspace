/**
 * Automated Verification Script for US-ATT-04: View Attendance (Host) (P0)
 * Module: Attendance | Priority: P0 | Traces to: FR-6.4, S6
 *
 * Acceptance Criteria Verified:
 * 1. The Attendance page (/rooms/:roomId/attendance) shows a session picker dropdown.
 *    - Backed by GET /rooms/:roomId/sessions and GET /api/rooms/:roomId/sessions.
 * 2. Selecting a session shows a table: Name, First Join, Last Leave, Total Minutes, Number of Joins.
 *    - Backed by GET /rooms/:roomId/sessions/:sessionId/attendance.
 * 3. Total minutes are rounded to the nearest minute.
 *    - Validates Math.round behavior for both single and multiple join sessions.
 * 4. The page is accessible only to the host; other users get 403.
 *    - 401 for unauthenticated requests.
 *    - 403 (HOST_ONLY) for student participants and outsiders.
 *    - 404 for invalid rooms or sessions.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import {
  clearMockSessions,
  setMockSession,
  getAttendanceSummary,
  getSessionsForRoom,
} from '../src/lib/sessions';
import {
  clearMockAttendance,
  addMockAttendance,
  aggregateAttendanceRecords,
} from '../src/lib/attendance';
import { clearPresence } from '../src/realtime/presence';
import { Me, RoomSummary, AttendanceRow, Session } from '@linkup/shared';

const TEST_PORT = 3137;
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
  console.log('🚀 Running US-ATT-04: View Attendance (Host) Tests');
  console.log('   Module: Attendance | Priority: P0 | Traces to: FR-6.4, S6');
  console.log('============================================================\n');

  const testServer = http.createServer(app);
  io.attach(testServer);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockSessions();
    clearMockAttendance();
    clearPresence();

    const roomId = 'room-att-04-host-test';
    const session1Id = 'session-att-04-001';
    const session2Id = 'session-att-04-002';

    const hostToken = 'token-host-att-04';
    const student1Token = 'token-student1-att-04';
    const student2Token = 'token-student2-att-04';
    const outsiderToken = 'token-outsider-att-04';

    const hostUser: Me = {
      id: 'user-host-att-04',
      fullName: 'Prof. Ada Lovelace',
      role: 'teacher',
      email: 'ada.host@test.com',
    };

    const student1User: Me = {
      id: 'user-student1-att-04',
      fullName: 'Grace Hopper',
      role: 'student',
      email: 'grace@test.com',
    };

    const student2User: Me = {
      id: 'user-student2-att-04',
      fullName: 'Alan Turing',
      role: 'student',
      email: 'alan@test.com',
    };

    const student3User: Me = {
      id: 'user-student3-att-04',
      fullName: 'Margaret Hamilton',
      role: 'student',
      email: 'margaret@test.com',
    };

    const outsiderUser: Me = {
      id: 'user-outsider-att-04',
      fullName: 'Eve Intruder',
      role: 'student',
      email: 'eve@test.com',
    };

    setCachedUser(hostToken, hostUser);
    setCachedUser(student1Token, student1User);
    setCachedUser(student2Token, student2User);
    setCachedUser(outsiderToken, outsiderUser);

    const hostRoomSummary: RoomSummary = {
      id: roomId,
      name: 'Computer Architecture & Networks',
      description: 'Room for verifying US-ATT-04 View Attendance',
      joinCode: 'ATT004',
      hostName: hostUser.fullName,
      memberCount: 4,
      myRole: 'host',
      activeSessionId: session2Id,
      createdAt: '2026-10-18T08:00:00.000Z',
    };

    const studentRoomSummary: RoomSummary = {
      ...hostRoomSummary,
      myRole: 'participant',
    };

    setMockRooms(hostUser.id, [hostRoomSummary]);
    setMockRooms(student1User.id, [studentRoomSummary]);
    setMockRooms(student2User.id, [studentRoomSummary]);
    // outsiderUser has no room membership

    // Setup 2 mock sessions for session picker dropdown
    setMockSession(session1Id, {
      id: session1Id,
      roomId,
      startedAt: '2026-10-18T09:00:00.000Z',
      endedAt: '2026-10-18T10:00:00.000Z',
      startedBy: hostUser.id,
    });

    setMockSession(session2Id, {
      id: session2Id,
      roomId,
      startedAt: '2026-10-18T11:00:00.000Z',
      endedAt: '2026-10-18T12:00:00.000Z',
      startedBy: hostUser.id,
    });

    // =============================================================
    // SECTION 1: Host-Only Authorization for Sessions & Attendance (AC-4)
    // =============================================================
    console.log('[Test 1] Verifying unauthenticated request to /rooms/:roomId/sessions returns 401...');
    const unauthSessRes1 = await fetch(`${BASE_URL}/rooms/${roomId}/sessions`);
    assert(unauthSessRes1.status === 401, 'Unauthenticated GET /rooms/:roomId/sessions returns 401');
    const unauthSessBody1 = await unauthSessRes1.json();
    assert(unauthSessBody1?.error?.code === 'UNAUTHENTICATED', 'Error code is UNAUTHENTICATED');

    console.log('\n[Test 2] Verifying unauthenticated request to /api/rooms/:roomId/sessions returns 401...');
    const unauthSessRes2 = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions`);
    assert(unauthSessRes2.status === 401, 'Unauthenticated GET /api/rooms/:roomId/sessions returns 401');

    console.log('\n[Test 3] Verifying student participant cannot view sessions (403 HOST_ONLY)...');
    const studentSessRes = await fetch(`${BASE_URL}/rooms/${roomId}/sessions`, {
      headers: { Authorization: `Bearer ${student1Token}` },
    });
    assert(studentSessRes.status === 403, 'Student participant rejected from sessions list with 403');
    const studentSessBody = await studentSessRes.json();
    assert(studentSessBody?.error?.code === 'HOST_ONLY', 'Error code is HOST_ONLY');

    console.log('\n[Test 4] Verifying outsider non-member cannot view sessions (403 HOST_ONLY)...');
    const outsiderSessRes = await fetch(`${BASE_URL}/rooms/${roomId}/sessions`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    assert(outsiderSessRes.status === 403, 'Outsider rejected from sessions list with 403');

    console.log('\n[Test 5] Verifying unauthenticated request to /rooms/.../attendance returns 401...');
    const unauthAttRes = await fetch(`${BASE_URL}/rooms/${roomId}/sessions/${session1Id}/attendance`);
    assert(unauthAttRes.status === 401, 'Unauthenticated GET attendance returns 401');

    console.log('\n[Test 6] Verifying student participant cannot view attendance (403 HOST_ONLY)...');
    const studentAttRes = await fetch(`${BASE_URL}/rooms/${roomId}/sessions/${session1Id}/attendance`, {
      headers: { Authorization: `Bearer ${student1Token}` },
    });
    assert(studentAttRes.status === 403, 'Student participant rejected from attendance with 403 Forbidden');
    const studentAttBody = await studentAttRes.json();
    assert(studentAttBody?.error?.code === 'HOST_ONLY', 'Error code is HOST_ONLY');

    console.log('\n[Test 7] Verifying outsider non-member cannot view attendance (403 HOST_ONLY)...');
    const outsiderAttRes = await fetch(`${BASE_URL}/rooms/${roomId}/sessions/${session1Id}/attendance`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    assert(outsiderAttRes.status === 403, 'Outsider rejected from attendance with 403 Forbidden');

    console.log('\n[Test 8] Verifying non-existent room returns 404...');
    const nonExistentRoomRes = await fetch(`${BASE_URL}/rooms/non-existent-room/sessions`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(nonExistentRoomRes.status === 404, 'Non-existent room returns 404 Not Found');

    console.log('\n[Test 9] Verifying non-existent session returns 404...');
    const nonExistentSessRes = await fetch(`${BASE_URL}/rooms/${roomId}/sessions/non-existent-sess/attendance`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(nonExistentSessRes.status === 404, 'Non-existent session returns 404 Not Found');

    // =============================================================
    // SECTION 2: Session Picker Dropdown Data (AC-1)
    // =============================================================
    console.log('\n[Test 10] Verifying host can fetch sessions for dropdown picker...');
    const hostSessRes = await fetch(`${BASE_URL}/rooms/${roomId}/sessions`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(hostSessRes.status === 200, 'Host GET /rooms/:roomId/sessions returns 200 OK');
    const sessionsList: Session[] = await hostSessRes.json();
    assert(Array.isArray(sessionsList), 'Sessions response is an array');
    assert(sessionsList.length === 2, `Expected 2 sessions, got ${sessionsList.length}`);
    // Check sorted newest first
    assert(
      new Date(sessionsList[0].startedAt).getTime() >= new Date(sessionsList[1].startedAt).getTime(),
      'Sessions are sorted newest first'
    );
    assert(sessionsList[0].id === session2Id, 'First session in dropdown is session2');
    assert(sessionsList[1].id === session1Id, 'Second session in dropdown is session1');

    console.log('\n[Test 11] Verifying /api/rooms/:roomId/sessions route parity for sessions list...');
    const hostApiSessRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(hostApiSessRes.status === 200, 'Host GET /api/rooms/:roomId/sessions returns 200 OK');
    const apiSessionsList = await hostApiSessRes.json();
    assert(apiSessionsList.length === 2, 'API route returns identical session count');

    // =============================================================
    // SECTION 3: Empty Session Attendance (AC-2)
    // =============================================================
    console.log('\n[Test 12] Verifying empty session returns 200 OK with empty array...');
    const emptyAttRes = await fetch(`${BASE_URL}/rooms/${roomId}/sessions/${session2Id}/attendance`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(emptyAttRes.status === 200, 'Host GET empty session attendance returns 200 OK');
    const emptyRows: AttendanceRow[] = await emptyAttRes.json();
    assert(Array.isArray(emptyRows) && emptyRows.length === 0, 'Empty session returns []');

    // =============================================================
    // SECTION 4: Attendance Table Data & Rounding to Nearest Minute (AC-2, AC-3)
    // =============================================================
    console.log('\n[Test 13] Populating session 1 attendance records and verifying table data...');
    // Student 1 (Grace Hopper):
    // Single continuous join from 09:00:00 to 09:12:40 (12 minutes 40 seconds = 760,000 ms)
    // 760000 / 60000 = 12.667 -> rounds to 13 minutes (nearest minute)
    // Joins: 1
    addMockAttendance({
      id: 'att-1',
      sessionId: session1Id,
      roomId,
      userId: student1User.id,
      userName: student1User.fullName,
      joinedAt: '2026-10-18T09:00:00.000Z',
      leftAt: '2026-10-18T09:12:40.000Z',
    });

    // Student 2 (Alan Turing):
    // Two joins (disconnected and rejoined):
    // Join 1: 09:05:00 to 09:10:10 (5 minutes 10 seconds = 310,000 ms)
    // Join 2: 09:15:00 to 09:19:20 (4 minutes 20 seconds = 260,000 ms)
    // Total duration: 570,000 ms = 9.5 minutes -> rounds to 10 minutes (nearest minute)
    // Joins: 2
    // First join: 09:05:00.000Z
    // Last leave: 09:19:20.000Z
    addMockAttendance({
      id: 'att-2',
      sessionId: session1Id,
      roomId,
      userId: student2User.id,
      userName: student2User.fullName,
      joinedAt: '2026-10-18T09:05:00.000Z',
      leftAt: '2026-10-18T09:10:10.000Z',
    });
    addMockAttendance({
      id: 'att-3',
      sessionId: session1Id,
      roomId,
      userId: student2User.id,
      userName: student2User.fullName,
      joinedAt: '2026-10-18T09:15:00.000Z',
      leftAt: '2026-10-18T09:19:20.000Z',
    });

    // Student 3 (Margaret Hamilton):
    // Quick check-in from 09:20:00 to 09:20:24 (24 seconds = 24,000 ms)
    // 24000 / 60000 = 0.4 -> rounds to 0 minutes (nearest minute)
    // Joins: 1
    addMockAttendance({
      id: 'att-4',
      sessionId: session1Id,
      roomId,
      userId: student3User.id,
      userName: student3User.fullName,
      joinedAt: '2026-10-18T09:20:00.000Z',
      leftAt: '2026-10-18T09:20:24.000Z',
    });

    const populatedAttRes = await fetch(`${BASE_URL}/rooms/${roomId}/sessions/${session1Id}/attendance`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(populatedAttRes.status === 200, 'Host GET populated attendance returns 200 OK');
    const rows: AttendanceRow[] = await populatedAttRes.json();
    assert(Array.isArray(rows), 'Attendance response is array');
    assert(rows.length === 3, `Expected 3 attendance rows, got ${rows.length}`);

    // Verify Student 1 (Grace Hopper): Name, First Join, Last Leave, Total Minutes (rounded), Number of Joins
    const graceRow = rows.find((r) => r.userId === student1User.id);
    assert(!!graceRow, 'Grace Hopper exists in attendance roster');
    if (graceRow) {
      assert(graceRow.fullName === 'Grace Hopper', 'Grace Hopper Name matches');
      assert(graceRow.firstJoin === '2026-10-18T09:00:00.000Z', 'Grace Hopper First Join is 09:00:00.000Z');
      assert(graceRow.lastLeave === '2026-10-18T09:12:40.000Z', 'Grace Hopper Last Leave is 09:12:40.000Z');
      assert(
        graceRow.minutes === 13,
        `Grace Hopper Total Minutes rounded to 13 (expected 13, got ${graceRow.minutes})`
      );
      assert(graceRow.joins === 1, `Grace Hopper Number of Joins is 1 (got ${graceRow.joins})`);
    }

    // Verify Student 2 (Alan Turing): Multiple joins, First Join, Last Leave, Total Minutes (rounded), Joins
    const alanRow = rows.find((r) => r.userId === student2User.id);
    assert(!!alanRow, 'Alan Turing exists in attendance roster');
    if (alanRow) {
      assert(alanRow.fullName === 'Alan Turing', 'Alan Turing Name matches');
      assert(alanRow.firstJoin === '2026-10-18T09:05:00.000Z', 'Alan Turing First Join is 09:05:00.000Z');
      assert(alanRow.lastLeave === '2026-10-18T09:19:20.000Z', 'Alan Turing Last Leave is 09:19:20.000Z');
      assert(
        alanRow.minutes === 10,
        `Alan Turing Total Minutes rounded to 10 (expected 10, got ${alanRow.minutes})`
      );
      assert(alanRow.joins === 2, `Alan Turing Number of Joins is 2 (got ${alanRow.joins})`);
    }

    // Verify Student 3 (Margaret Hamilton): Under 30 seconds rounded to 0
    const margaretRow = rows.find((r) => r.userId === student3User.id);
    assert(!!margaretRow, 'Margaret Hamilton exists in attendance roster');
    if (margaretRow) {
      assert(margaretRow.fullName === 'Margaret Hamilton', 'Margaret Hamilton Name matches');
      assert(margaretRow.firstJoin === '2026-10-18T09:20:00.000Z', 'Margaret Hamilton First Join is 09:20:00.000Z');
      assert(margaretRow.lastLeave === '2026-10-18T09:20:24.000Z', 'Margaret Hamilton Last Leave is 09:20:24.000Z');
      assert(
        margaretRow.minutes === 0,
        `Margaret Hamilton Total Minutes rounded to 0 (expected 0, got ${margaretRow.minutes})`
      );
      assert(margaretRow.joins === 1, `Margaret Hamilton Number of Joins is 1 (got ${margaretRow.joins})`);
    }

    // =============================================================
    // SECTION 5: /api/ Route Parity (AC-2)
    // =============================================================
    console.log('\n[Test 14] Verifying /api/rooms/:roomId/sessions/:sessionId/attendance parity...');
    const apiAttRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${session1Id}/attendance`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(apiAttRes.status === 200, 'Host GET /api/.../attendance returns 200 OK');
    const apiRows: AttendanceRow[] = await apiAttRes.json();
    assert(JSON.stringify(apiRows) === JSON.stringify(rows), 'Both routes return identical attendance summary');

    // =============================================================
    // SECTION 6: Direct Core Function Testing
    // =============================================================
    console.log('\n[Test 15] Direct verification of getAttendanceSummary & aggregateAttendanceRecords...');
    const directRows = await getAttendanceSummary(hostUser.id, roomId, session1Id);
    assert(directRows.length === 3, 'getAttendanceSummary directly returns 3 rows');
    const directGrace = directRows.find((r) => r.userId === student1User.id);
    assert(directGrace?.minutes === 13, 'Direct call returns 13 minutes for Grace');

    const directAggregated = aggregateAttendanceRecords([
      {
        id: 'mock-1',
        sessionId: session1Id,
        roomId,
        userId: 'u1',
        userName: 'Test User',
        joinedAt: '2026-10-18T10:00:00.000Z',
        leftAt: '2026-10-18T10:00:30.000Z', // 30s -> rounds to 1 min (0.5m rounds to 1)
      },
    ]);
    assert(directAggregated[0].minutes === 1, '30 seconds duration rounds to 1 minute');

  } catch (err) {
    console.error('Unexpected error running tests:', err);
    failedCount++;
  } finally {
    testServer.close();
  }

  console.log('\n============================================================');
  console.log(`Summary: ${passedCount} Passed, ${failedCount} Failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests();
