/**
 * Automated Verification Script for US-ATT-04: View Attendance (Host)
 * Module: Attendance | Priority: P0 | Traces to: FR-6.4, S6
 *
 * Acceptance Criteria Verified:
 * 1. The Attendance page (/rooms/:roomId/attendance) shows a session picker dropdown.
 * 2. Selecting a session shows a table: Name, First Join, Last Leave, Total Minutes, Number of Joins.
 * 3. Total minutes are rounded to the nearest minute.
 * 4. The page is accessible only to the host; other users get 403.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { clearMockSessions, addMockSession } from '../src/lib/sessions';
import {
  clearMockAttendance,
  addMockAttendance,
  getSessionAttendanceSummary,
} from '../src/lib/attendance';
import { Me, Session, RoomSummary, AttendanceSummaryItem } from '@linkup/shared';

const TEST_PORT = 3134;
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

    const roomId = 'room-att-04-host-view';
    const hostToken = 'token-host-att-04';
    const studentToken1 = 'token-student-att-04-alice';
    const studentToken2 = 'token-student-att-04-bob';
    const outsiderToken = 'token-outsider-att-04';

    const hostUser: Me = {
      id: 'user-host-att-04',
      fullName: 'Dr. Attendance Host',
      role: 'teacher',
      email: 'host.att04@test.com',
    };

    const studentAlice: Me = {
      id: 'user-student-att-04-alice',
      fullName: 'Alice Anderson',
      role: 'student',
      email: 'alice.att04@test.com',
    };

    const studentBob: Me = {
      id: 'user-student-att-04-bob',
      fullName: 'Bob Builder',
      role: 'student',
      email: 'bob.att04@test.com',
    };

    const outsiderUser: Me = {
      id: 'user-outsider-att-04',
      fullName: 'Oscar Outsider',
      role: 'student',
      email: 'oscar.att04@test.com',
    };

    setCachedUser(hostToken, hostUser);
    setCachedUser(studentToken1, studentAlice);
    setCachedUser(studentToken2, studentBob);
    setCachedUser(outsiderToken, outsiderUser);

    const session1Id = 'session-att-04-sess-1';
    const session2Id = 'session-att-04-sess-2';

    const session1: Session = {
      id: session1Id,
      roomId,
      startedAt: '2026-10-17T09:00:00.000Z',
      endedAt: '2026-10-17T10:00:00.000Z',
      startedBy: hostUser.id,
      livekitRoom: 'lk-room-att-04-s1',
    };

    const session2: Session = {
      id: session2Id,
      roomId,
      startedAt: '2026-10-17T11:00:00.000Z',
      endedAt: null, // Active session
      startedBy: hostUser.id,
      livekitRoom: 'lk-room-att-04-s2',
    };

    addMockSession(session1);
    addMockSession(session2);

    const roomSummary: RoomSummary = {
      id: roomId,
      name: 'Attendance Verification Classroom',
      description: 'Verifying host attendance roster and metrics calculation',
      joinCode: 'ATT004',
      hostName: hostUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: session2.id,
      createdAt: new Date().toISOString(),
      members: [
        {
          userId: hostUser.id,
          fullName: hostUser.fullName,
          userRole: 'teacher',
          memberRole: 'host',
          permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
          joinedAt: new Date().toISOString(),
        },
        {
          userId: studentAlice.id,
          fullName: studentAlice.fullName,
          userRole: 'student',
          memberRole: 'participant',
          permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: false, canCode: false },
          joinedAt: new Date().toISOString(),
        },
        {
          userId: studentBob.id,
          fullName: studentBob.fullName,
          userRole: 'student',
          memberRole: 'participant',
          permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: false, canCode: false },
          joinedAt: new Date().toISOString(),
        },
      ],
    };

    setMockRooms(hostUser.id, [roomSummary]);
    setMockRooms(studentAlice.id, [{ ...roomSummary, myRole: 'participant' }]);
    setMockRooms(studentBob.id, [{ ...roomSummary, myRole: 'participant' }]);

    // Seed attendance records for Session 1:
    // Alice has 2 separate joins:
    // Join 1: 09:05:00 to 09:30:00 (25.0 minutes)
    // Join 2: 09:35:00 to 09:49:40 (14 min 40 sec = 14.667 minutes)
    // Total float = 39.667 minutes -> rounded to 40 minutes!
    addMockAttendance({
      id: 'rec-alice-1',
      sessionId: session1Id,
      roomId,
      userId: studentAlice.id,
      joinedAt: '2026-10-17T09:05:00.000Z',
      leftAt: '2026-10-17T09:30:00.000Z',
    });
    addMockAttendance({
      id: 'rec-alice-2',
      sessionId: session1Id,
      roomId,
      userId: studentAlice.id,
      joinedAt: '2026-10-17T09:35:00.000Z',
      leftAt: '2026-10-17T09:49:40.000Z',
    });

    // Bob has 1 join:
    // Join 1: 09:10:00 to 09:11:30 (90 seconds = 1.5 minutes) -> rounded to 2 minutes!
    addMockAttendance({
      id: 'rec-bob-1',
      sessionId: session1Id,
      roomId,
      userId: studentBob.id,
      joinedAt: '2026-10-17T09:10:00.000Z',
      leftAt: '2026-10-17T09:11:30.000Z',
    });

    // Seed attendance records for Session 2 (active session):
    // Alice is currently active in call (leftAt === null):
    addMockAttendance({
      id: 'rec-alice-s2-1',
      sessionId: session2Id,
      roomId,
      userId: studentAlice.id,
      joinedAt: new Date(Date.now() - 600000).toISOString(), // ~10 mins ago
      leftAt: null,
    });

    console.log('[Phase 1] Security Guard Tests: Enforce 403 for non-hosts (US-ATT-04 AC-4)...');

    // Test 1: Unauthenticated request gets 401
    const unauthRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${session1Id}/attendance`);
    assert(unauthRes.status === 401, 'Unauthenticated request to attendance endpoint returns 401');

    // Test 2: Student Alice calling GET sessions returns 403
    const studentSessionsRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions`, {
      headers: { Authorization: `Bearer ${studentToken1}` },
    });
    assert(studentSessionsRes.status === 403, 'Student calling GET /api/rooms/:roomId/sessions receives 403 HOST_ONLY');
    const studentSessionsJson = await studentSessionsRes.json();
    assert(studentSessionsJson?.error?.code === 'HOST_ONLY', 'Error code is HOST_ONLY for sessions endpoint');

    // Test 3: Student Alice calling GET attendance returns 403
    const studentAttRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${session1Id}/attendance`, {
      headers: { Authorization: `Bearer ${studentToken1}` },
    });
    assert(studentAttRes.status === 403, 'Student Alice calling GET attendance receives 403 HOST_ONLY');
    const studentAttJson = await studentAttRes.json();
    assert(studentAttJson?.error?.code === 'HOST_ONLY', 'Error code is HOST_ONLY for attendance endpoint');

    // Test 4: Student Bob calling GET attendance returns 403
    const bobAttRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${session1Id}/attendance`, {
      headers: { Authorization: `Bearer ${studentToken2}` },
    });
    assert(bobAttRes.status === 403, 'Student Bob calling GET attendance receives 403 HOST_ONLY');

    // Test 5: Outsider calling GET attendance returns 403
    const outsiderAttRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${session1Id}/attendance`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    assert(outsiderAttRes.status === 403, 'Non-member outsider calling GET attendance receives 403');

    console.log('\n[Phase 2] Session Picker Data: Host views sessions list (US-ATT-04 AC-1)...');

    // Test 6: Host fetches all sessions for room
    const hostSessionsRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(hostSessionsRes.status === 200, 'Host calling GET /api/rooms/:roomId/sessions returns 200 OK');
    const sessionsList = await hostSessionsRes.json();
    assert(Array.isArray(sessionsList), 'Sessions response is an array');
    assert(sessionsList.length === 2, `Host received exactly 2 sessions (found: ${sessionsList.length})`);
    assert(sessionsList.some((s: Session) => s.id === session1Id), 'Session 1 is in sessions list');
    assert(sessionsList.some((s: Session) => s.id === session2Id), 'Session 2 is in sessions list');

    console.log('\n[Phase 3] Attendance Table & Metrics Calculation (US-ATT-04 AC-2 & AC-3)...');

    // Test 7: Host fetches attendance for Session 1
    const hostAttRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${session1Id}/attendance`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(hostAttRes.status === 200, 'Host calling GET attendance for Session 1 returns 200 OK');
    const summary: AttendanceSummaryItem[] = await hostAttRes.json();
    assert(Array.isArray(summary), 'Attendance summary is an array');
    assert(summary.length === 2, `Exactly 2 students reported in Session 1 (found: ${summary.length})`);

    // Verify Alice in Session 1
    const aliceData = summary.find((s) => s.userId === studentAlice.id);
    assert(aliceData !== undefined, 'Alice Anderson is present in attendance summary');
    assert(aliceData?.name === studentAlice.fullName, `Alice name matches: "${aliceData?.name}"`);
    assert(aliceData?.firstJoin === '2026-10-17T09:05:00.000Z', `Alice firstJoin is earliest join (09:05:00, got: ${aliceData?.firstJoin})`);
    assert(aliceData?.lastLeave === '2026-10-17T09:49:40.000Z', `Alice lastLeave is latest leave (09:49:40, got: ${aliceData?.lastLeave})`);
    assert(aliceData?.joinCount === 2, `Alice Number of Joins is 2 (got: ${aliceData?.joinCount})`);
    // 25.0 min + 14.667 min = 39.667 min -> rounded to nearest minute = 40
    assert(aliceData?.totalMinutes === 40, `Alice Total Minutes rounded to nearest minute = 40 (got: ${aliceData?.totalMinutes})`);

    // Verify Bob in Session 1
    const bobData = summary.find((s) => s.userId === studentBob.id);
    assert(bobData !== undefined, 'Bob Builder is present in attendance summary');
    assert(bobData?.name === studentBob.fullName, `Bob name matches: "${bobData?.name}"`);
    assert(bobData?.firstJoin === '2026-10-17T09:10:00.000Z', `Bob firstJoin is 09:10:00 (got: ${bobData?.firstJoin})`);
    assert(bobData?.lastLeave === '2026-10-17T09:11:30.000Z', `Bob lastLeave is 09:11:30 (got: ${bobData?.lastLeave})`);
    assert(bobData?.joinCount === 1, `Bob Number of Joins is 1 (got: ${bobData?.joinCount})`);
    // 90 seconds = 1.5 min -> rounded to nearest minute = 2
    assert(bobData?.totalMinutes === 2, `Bob Total Minutes rounded to nearest minute = 2 (got: ${bobData?.totalMinutes})`);

    console.log('\n[Phase 4] Active Session (Null Last Leave) Test...');

    // Test 8: Host fetches attendance for Session 2 (Ongoing)
    const s2AttRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${session2Id}/attendance`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(s2AttRes.status === 200, 'Host calling GET attendance for ongoing Session 2 returns 200 OK');
    const s2Summary: AttendanceSummaryItem[] = await s2AttRes.json();
    const s2Alice = s2Summary.find((s) => s.userId === studentAlice.id);
    assert(s2Alice !== undefined, 'Alice is present in Session 2 attendance');
    assert(s2Alice?.lastLeave === null, `Alice in ongoing session has lastLeave === null (Active) (got: ${s2Alice?.lastLeave})`);
    assert(s2Alice?.totalMinutes !== undefined && s2Alice.totalMinutes >= 9, `Alice has active ongoing minutes computed (got: ${s2Alice?.totalMinutes})`);

    console.log('\n[Phase 5] Direct Function Call Unit Tests...');

    // Test 9: Calling getSessionAttendanceSummary directly as host
    const directSummary = await getSessionAttendanceSummary(hostUser.id, roomId, session1Id);
    assert(directSummary.length === 2, 'Direct function call returns expected 2 student summaries');

    // Test 10: Calling getSessionAttendanceSummary directly as student throws 403
    let thrownError: any = null;
    try {
      await getSessionAttendanceSummary(studentAlice.id, roomId, session1Id);
    } catch (err: any) {
      thrownError = err;
    }
    assert(thrownError !== null, 'Direct function call by non-host throws error');
    assert(thrownError?.code === 'HOST_ONLY', 'Direct function error code is HOST_ONLY');
    assert(thrownError?.status === 403, 'Direct function error status is 403');

  } catch (err) {
    console.error('Unexpected test execution error:', err);
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
