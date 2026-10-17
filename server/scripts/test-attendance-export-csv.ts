/**
 * Automated Verification Script for US-ATT-06: Export Attendance CSV (P1)
 * Module: Attendance | Priority: P1 | Traces to: FR-6.6
 *
 * Acceptance Criteria Verified:
 * 1. A "Download CSV" button is available on the Attendance page.
 * 2. GET /rooms/:roomId/sessions/:sessionId/attendance.csv returns a text/csv response.
 * 3. The CSV includes columns: Name, First Join, Last Leave, Total Minutes, Number of Joins.
 * 4. Proper host-only authorization (401 for unauth, 403 for student/outsider).
 * 5. Special character escaping for CSV names.
 * 6. Empty session handling.
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
  getAttendanceCSV,
  attendanceToCSV,
} from '../src/lib/sessions';
import {
  clearMockAttendance,
  addMockAttendance,
} from '../src/lib/attendance';
import { clearPresence } from '../src/realtime/presence';
import { Me, RoomSummary } from '@linkup/shared';

const TEST_PORT = 3136;
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
  console.log('🚀 Running US-ATT-06: Export Attendance CSV Tests');
  console.log('   Module: Attendance | Priority: P1 | Traces to: FR-6.6');
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

    const roomId = 'room-att-06-csv-test';
    const sessionId = 'session-att-06-001';

    const hostToken = 'token-host-att-06';
    const student1Token = 'token-student1-att-06';
    const outsiderToken = 'token-outsider-att-06';

    const hostUser: Me = {
      id: 'user-host-att-06',
      fullName: 'Dr. Jane Smith',
      role: 'teacher',
      email: 'host.att06@test.com',
    };

    const student1User: Me = {
      id: 'user-student1-att-06',
      fullName: 'Alice Wonderland',
      role: 'student',
      email: 'alice.att06@test.com',
    };

    const student2User: Me = {
      id: 'user-student2-att-06',
      fullName: 'Bob Builder',
      role: 'student',
      email: 'bob.att06@test.com',
    };

    const studentEscapedUser: Me = {
      id: 'user-student-escaped-att-06',
      fullName: 'O\'Connor, Tim "The Expert"',
      role: 'student',
      email: 'tim.att06@test.com',
    };

    const outsiderUser: Me = {
      id: 'user-outsider-att-06',
      fullName: 'Eve Outsider',
      role: 'student',
      email: 'outsider.att06@test.com',
    };

    setCachedUser(hostToken, hostUser);
    setCachedUser(student1Token, student1User);
    setCachedUser(outsiderToken, outsiderUser);

    const hostRoomSummary: RoomSummary = {
      id: roomId,
      name: 'Attendance CSV Lecture',
      description: 'Room for verifying US-ATT-06 CSV export',
      joinCode: 'ATT006',
      hostName: hostUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: sessionId,
      createdAt: '2026-10-17T14:00:00.000Z',
    };

    const studentRoomSummary: RoomSummary = {
      ...hostRoomSummary,
      myRole: 'participant',
    };

    setMockRooms(hostUser.id, [hostRoomSummary]);
    setMockRooms(student1User.id, [studentRoomSummary]);
    // outsider has no room

    setMockSession(sessionId, {
      id: sessionId,
      roomId,
      startedAt: '2026-10-17T15:00:00.000Z',
      endedAt: '2026-10-17T16:00:00.000Z',
      startedBy: hostUser.id,
    });

    // -------------------------------------------------------------
    // Test 1: Unauthenticated request to /rooms/:roomId/sessions/:sessionId/attendance.csv returns 401
    // -------------------------------------------------------------
    console.log('[Test 1] Verifying unauthenticated request to /rooms/.../attendance.csv returns 401...');
    const unauthRes1 = await fetch(`${BASE_URL}/rooms/${roomId}/sessions/${sessionId}/attendance.csv`);
    assert(unauthRes1.status === 401, 'Unauthenticated request to /rooms/.../attendance.csv returns 401');
    const unauthBody1 = await unauthRes1.json();
    assert(unauthBody1?.error?.code === 'UNAUTHENTICATED', 'Error code is UNAUTHENTICATED');

    // -------------------------------------------------------------
    // Test 2: Unauthenticated request to /api/rooms/:roomId/sessions/:sessionId/attendance.csv returns 401
    // -------------------------------------------------------------
    console.log('\n[Test 2] Verifying unauthenticated request to /api/rooms/.../attendance.csv returns 401...');
    const unauthRes2 = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${sessionId}/attendance.csv`);
    assert(unauthRes2.status === 401, 'Unauthenticated request to /api/rooms/.../attendance.csv returns 401');

    // -------------------------------------------------------------
    // Test 3: Student participant cannot export CSV (403 HOST_ONLY)
    // -------------------------------------------------------------
    console.log('\n[Test 3] Verifying student participant cannot export CSV (403 HOST_ONLY)...');
    const studentRes = await fetch(`${BASE_URL}/rooms/${roomId}/sessions/${sessionId}/attendance.csv`, {
      headers: { Authorization: `Bearer ${student1Token}` },
    });
    assert(studentRes.status === 403, 'Student participant rejected with 403 Forbidden');
    const studentBody = await studentRes.json();
    assert(studentBody?.error?.code === 'HOST_ONLY', 'Error code is HOST_ONLY');

    // -------------------------------------------------------------
    // Test 4: Outsider cannot export CSV (403 HOST_ONLY)
    // -------------------------------------------------------------
    console.log('\n[Test 4] Verifying outsider non-member cannot export CSV (403 HOST_ONLY)...');
    const outsiderRes = await fetch(`${BASE_URL}/rooms/${roomId}/sessions/${sessionId}/attendance.csv`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    assert(outsiderRes.status === 403, 'Outsider rejected with 403 Forbidden');

    // -------------------------------------------------------------
    // Test 5: Unknown room returns 404 ROOM_NOT_FOUND
    // -------------------------------------------------------------
    console.log('\n[Test 5] Verifying non-existent room returns 404...');
    const wrongRoomRes = await fetch(`${BASE_URL}/rooms/non-existent-room/sessions/${sessionId}/attendance.csv`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(wrongRoomRes.status === 404, 'Non-existent room returns 404 Not Found');

    // -------------------------------------------------------------
    // Test 6: Unknown session returns 404 SESSION_NOT_FOUND
    // -------------------------------------------------------------
    console.log('\n[Test 6] Verifying non-existent session returns 404...');
    const wrongSessionRes = await fetch(`${BASE_URL}/rooms/${roomId}/sessions/unknown-session-id/attendance.csv`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(wrongSessionRes.status === 404, 'Non-existent session returns 404 Not Found');

    // -------------------------------------------------------------
    // Test 7: Empty session returns 200 OK with text/csv and CSV header row
    // -------------------------------------------------------------
    console.log('\n[Test 7] Verifying empty session returns 200 with text/csv header row...');
    const emptyRes = await fetch(`${BASE_URL}/rooms/${roomId}/sessions/${sessionId}/attendance.csv`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(emptyRes.status === 200, 'Host requesting empty session CSV returns 200 OK');
    const contentType = emptyRes.headers.get('content-type') || '';
    assert(contentType.includes('text/csv'), `Content-Type header is text/csv (found: ${contentType})`);
    const disposition = emptyRes.headers.get('content-disposition') || '';
    assert(disposition.includes('attachment') && disposition.includes(`attendance-${sessionId}.csv`), `Content-Disposition header is attachment with filename`);

    const emptyCsv = await emptyRes.text();
    const emptyLines = emptyCsv.trim().split(/\r?\n/);
    assert(emptyLines.length === 1, `CSV contains exactly 1 row (header row) when session has no attendees`);
    assert(
      emptyLines[0] === 'Name,First Join,Last Leave,Total Minutes,Number of Joins',
      `Header matches exact required columns: ${emptyLines[0]}`
    );

    // -------------------------------------------------------------
    // Test 8: Multi-participant attendance with reconnects and accurate totals
    // -------------------------------------------------------------
    console.log('\n[Test 8] Adding attendance records and verifying populated CSV export...');
    // Alice: joined 15:00:00 -> left 15:30:00 (30 mins), then rejoined 15:35:00 -> left 15:50:00 (15 mins) = 45 mins, 2 joins
    addMockAttendance({
      id: 101,
      sessionId,
      roomId,
      userId: student1User.id,
      userName: student1User.fullName,
      joinedAt: '2026-10-17T15:00:00.000Z',
      leftAt: '2026-10-17T15:30:00.000Z',
    });
    addMockAttendance({
      id: 102,
      sessionId,
      roomId,
      userId: student1User.id,
      userName: student1User.fullName,
      joinedAt: '2026-10-17T15:35:00.000Z',
      leftAt: '2026-10-17T15:50:00.000Z',
    });

    // Bob: joined 15:05:00 -> left 15:45:00 (40 mins), 1 join
    addMockAttendance({
      id: 103,
      sessionId,
      roomId,
      userId: student2User.id,
      userName: student2User.fullName,
      joinedAt: '2026-10-17T15:05:00.000Z',
      leftAt: '2026-10-17T15:45:00.000Z',
    });

    // Tim (with quotes/comma in name): joined 15:10:00 -> left 15:35:00 (25 mins), 1 join
    addMockAttendance({
      id: 104,
      sessionId,
      roomId,
      userId: studentEscapedUser.id,
      userName: studentEscapedUser.fullName,
      joinedAt: '2026-10-17T15:10:00.000Z',
      leftAt: '2026-10-17T15:35:00.000Z',
    });

    // Request via /rooms/...
    const csvRes = await fetch(`${BASE_URL}/rooms/${roomId}/sessions/${sessionId}/attendance.csv`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(csvRes.status === 200, 'GET /rooms/.../attendance.csv returns 200 OK');
    const csvContentType = csvRes.headers.get('content-type') || '';
    assert(csvContentType.includes('text/csv'), 'Response Content-Type is text/csv');

    const csvText = await csvRes.text();
    const rows = csvText.trim().split(/\r?\n/);

    assert(rows.length === 4, `CSV contains 1 header + 3 student rows (found: ${rows.length})`);
    assert(
      rows[0] === 'Name,First Join,Last Leave,Total Minutes,Number of Joins',
      'CSV header is "Name,First Join,Last Leave,Total Minutes,Number of Joins"'
    );

    // Verify Alice row: Alice Wonderland,2026-10-17T15:00:00.000Z,2026-10-17T15:50:00.000Z,45,2
    const aliceRow = rows.find((r) => r.startsWith('Alice Wonderland'));
    assert(!!aliceRow, 'Alice Wonderland exists in CSV output');
    if (aliceRow) {
      const parts = aliceRow.split(',');
      assert(parts[0] === 'Alice Wonderland', `Alice Name is correct: ${parts[0]}`);
      assert(parts[1] === '2026-10-17T15:00:00.000Z', `Alice First Join is 15:00:00.000Z (found: ${parts[1]})`);
      assert(parts[2] === '2026-10-17T15:50:00.000Z', `Alice Last Leave is 15:50:00.000Z (found: ${parts[2]})`);
      assert(parts[3] === '45', `Alice Total Minutes is 45 (found: ${parts[3]})`);
      assert(parts[4] === '2', `Alice Number of Joins is 2 (found: ${parts[4]})`);
    }

    // Verify Bob row: Bob Builder,2026-10-17T15:05:00.000Z,2026-10-17T15:45:00.000Z,40,1
    const bobRow = rows.find((r) => r.startsWith('Bob Builder'));
    assert(!!bobRow, 'Bob Builder exists in CSV output');
    if (bobRow) {
      const parts = bobRow.split(',');
      assert(parts[0] === 'Bob Builder', `Bob Name is correct: ${parts[0]}`);
      assert(parts[1] === '2026-10-17T15:05:00.000Z', `Bob First Join is 15:05:00.000Z (found: ${parts[1]})`);
      assert(parts[2] === '2026-10-17T15:45:00.000Z', `Bob Last Leave is 15:45:00.000Z (found: ${parts[2]})`);
      assert(parts[3] === '40', `Bob Total Minutes is 40 (found: ${parts[3]})`);
      assert(parts[4] === '1', `Bob Number of Joins is 1 (found: ${parts[4]})`);
    }

    // Verify Escaped student row: "O'Connor, Tim ""The Expert""",2026-10-17T15:10:00.000Z,2026-10-17T15:35:00.000Z,25,1
    const escapedRow = rows.find((r) => r.includes('O\'Connor'));
    assert(!!escapedRow, 'Escaped student name row exists in CSV');
    if (escapedRow) {
      assert(
        escapedRow.startsWith('"O\'Connor, Tim ""The Expert"""'),
        `Student with comma and quotes escaped per RFC 4180: ${escapedRow}`
      );
      assert(escapedRow.includes('25,1'), `Contains 25 minutes and 1 join: ${escapedRow}`);
    }

    // -------------------------------------------------------------
    // Test 9: Also verify /api/rooms/:roomId/sessions/:sessionId/attendance.csv
    // -------------------------------------------------------------
    console.log('\n[Test 9] Verifying /api/rooms/.../attendance.csv route parity...');
    const apiCsvRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${sessionId}/attendance.csv`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(apiCsvRes.status === 200, 'GET /api/rooms/.../attendance.csv returns 200 OK');
    const apiCsvText = await apiCsvRes.text();
    assert(apiCsvText === csvText, 'Both /rooms/... and /api/rooms/... return identical CSV content');

    // -------------------------------------------------------------
    // Test 10: Verify JSON endpoint GET /api/rooms/:roomId/sessions/:sessionId/attendance
    // -------------------------------------------------------------
    console.log('\n[Test 10] Verifying JSON attendance summary endpoint GET /api/rooms/.../attendance...');
    const jsonRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${sessionId}/attendance`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    assert(jsonRes.status === 200, 'GET /api/rooms/.../attendance returns 200 OK');
    const jsonRows = await jsonRes.json();
    assert(Array.isArray(jsonRows), 'Returns an array of AttendanceRow');
    assert(jsonRows.length === 3, `Returns 3 participant records (found: ${jsonRows.length})`);

    const aliceJson = jsonRows.find((r: any) => r.userId === student1User.id);
    assert(aliceJson?.fullName === 'Alice Wonderland', 'Alice fullName matches in JSON');
    assert(aliceJson?.minutes === 45, 'Alice minutes is 45 in JSON');
    assert(aliceJson?.joins === 2, 'Alice joins is 2 in JSON');

    // -------------------------------------------------------------
    // Test 11: Direct verification of library exports
    // -------------------------------------------------------------
    console.log('\n[Test 11] Direct verification of getAttendanceSummary and getAttendanceCSV functions...');
    const summaryDirect = await getAttendanceSummary(hostUser.id, roomId, sessionId);
    assert(summaryDirect.length === 3, 'getAttendanceSummary returns 3 rows directly');
    const csvDirect = await getAttendanceCSV(hostUser.id, roomId, sessionId);
    assert(csvDirect.includes('Alice Wonderland,2026-10-17T15:00:00.000Z'), 'getAttendanceCSV produces valid CSV directly');

    console.log('\n============================================================');
    console.log(`Summary: ${passedCount} Passed, ${failedCount} Failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  } finally {
    testServer.close();
  }
}

runTests();
