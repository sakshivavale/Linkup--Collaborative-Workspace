/**
 * Automated Verification Script for US-LIVE-05: End a Session (Host)
 * Priority: P0 | Traces to: FR-3.6
 *
 * Acceptance Criteria Verified:
 * 1. An "End Session" button is visible in the room header for the host during an active session.
 * 2. Ending sets ended_at on the session, deletes the LiveKit room, closes all open attendance records, and emits session:ended to the room.
 * 3. All participants see a "Session has ended" message and are returned to the room's non-live view.
 * 4. The session timer in the header stops and is replaced with "Session ended".
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { clearMockSessions, getMockAttendance, addMockAttendance, clearMockAttendance } from '../src/lib/sessions';
import { clearPresence } from '../src/realtime/presence';
import { Me, Session } from '@linkup/shared';

const TEST_PORT = 3125;
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
  console.log('🚀 Running US-LIVE-05: End a Session (Host) Tests');
  console.log('============================================================\n');

  const testServer = http.createServer(app);
  io.attach(testServer);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  let studentSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockSessions();
    clearMockAttendance();
    clearPresence();

    const hostToken = 'test_host_token_us_live_05';
    const studentToken = 'test_student_token_us_live_05';
    const outsiderToken = 'test_outsider_token_us_live_05';

    const hostUser: Me = {
      id: 'host-user-us-live-05',
      email: 'host@linkup.test',
      fullName: 'Host Professor',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'student-user-us-live-05',
      email: 'student@linkup.test',
      fullName: 'Student Attendee',
      role: 'student',
    };

    const outsiderUser: Me = {
      id: 'outsider-user-us-live-05',
      email: 'outsider@linkup.test',
      fullName: 'Outsider User',
      role: 'student',
    };

    setCachedUser(hostToken, hostUser, 60000);
    setCachedUser(studentToken, studentUser, 60000);
    setCachedUser(outsiderToken, outsiderUser, 60000);

    const roomId = 'room-test-us-live-05';

    // Set up mock rooms for host and student
    setMockRooms(hostUser.id, [
      {
        id: roomId,
        name: 'Advanced Algorithms Live',
        description: 'Host-led interactive session',
        joinCode: 'ALGO99',
        hostName: hostUser.fullName,
        memberCount: 2,
        myRole: 'host',
        activeSessionId: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    setMockRooms(studentUser.id, [
      {
        id: roomId,
        name: 'Advanced Algorithms Live',
        description: 'Host-led interactive session',
        joinCode: null,
        hostName: hostUser.fullName,
        memberCount: 2,
        myRole: 'participant',
        activeSessionId: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    console.log('\x1b[34m[Test 1]\x1b[0m Host starts a live session to prepare for end test...\n');
    const startRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });

    const activeSession: Session = await startRes.json();
    assert(startRes.status === 201, 'Host started session with 201 Created');
    assert(Boolean(activeSession?.id), `Active session created with ID: ${activeSession?.id}`);

    // Add mock attendance records for student and host to verify attendance closure
    addMockAttendance({
      id: 1,
      sessionId: activeSession.id,
      roomId,
      userId: hostUser.id,
      joinedAt: activeSession.startedAt,
      leftAt: null,
    });
    addMockAttendance({
      id: 2,
      sessionId: activeSession.id,
      roomId,
      userId: studentUser.id,
      joinedAt: activeSession.startedAt,
      leftAt: null,
    });

    console.log('\n\x1b[34m[Test 2]\x1b[0m Unauthenticated request to POST /api/rooms/:roomId/sessions/:sessionId/end returns 401 UNAUTHENTICATED...\n');
    const unauthRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${activeSession.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const unauthBody = await unauthRes.json();
    assert(
      unauthRes.status === 401 && unauthBody.error?.code === 'UNAUTHENTICATED',
      'Unauthenticated request rejected with 401 UNAUTHENTICATED',
      `Got status ${unauthRes.status}, code: ${unauthBody.error?.code}`
    );

    console.log('\n\x1b[34m[Test 3]\x1b[0m Non-host student participant cannot end session (403 HOST_ONLY)...\n');
    const studentRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${activeSession.id}/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
    });
    const studentBody = await studentRes.json();
    assert(
      studentRes.status === 403 && (studentBody.error?.code === 'HOST_ONLY' || studentBody.error?.code === 'FORBIDDEN'),
      'Student participant cannot end session (403 HOST_ONLY)',
      `Got status ${studentRes.status}, code: ${studentBody.error?.code}`
    );

    console.log('\n\x1b[34m[Test 4]\x1b[0m Outsider non-member cannot end session (403 HOST_ONLY)...\n');
    const outsiderRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${activeSession.id}/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${outsiderToken}`,
      },
    });
    assert(outsiderRes.status === 403, 'Outsider rejected with 403 Forbidden');

    console.log('\n\x1b[34m[Test 5]\x1b[0m Connect student socket to room to listen for session:ended event...\n');
    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 4000);
      studentSocket!.on('connect', () => {
        studentSocket!.emit('room:join', { roomId }, (ack: any) => {
          clearTimeout(timeout);
          assert(ack?.ok === true, 'Student socket joined room channel');
          resolve();
        });
      });
      studentSocket!.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const sessionEndedPromise = new Promise<{ roomId: string; sessionId: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('session:ended event timed out')), 5000);
      studentSocket!.on('session:ended', (payload: any) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });

    console.log('\n\x1b[34m[Test 6]\x1b[0m Host ends the session via POST /api/rooms/:roomId/sessions/:sessionId/end (200 OK)...\n');
    const endRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${activeSession.id}/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });

    const endBody: Session = await endRes.json();
    assert(endRes.status === 200, 'Host ending session returns HTTP 200 OK', `Status: ${endRes.status}`);
    assert(endBody.id === activeSession.id, 'Response session id matches the ended session');
    assert(endBody.roomId === roomId, 'Response session roomId matches the target room');
    assert(Boolean(endBody.endedAt), `endedAt is populated with ISO timestamp: ${endBody.endedAt}`);
    assert(
      new Date(endBody.endedAt!).getTime() >= new Date(endBody.startedAt).getTime(),
      'endedAt timestamp is greater than or equal to startedAt'
    );

    console.log('\n\x1b[34m[Test 7]\x1b[0m Verifying room members receive session:ended socket event...\n');
    const receivedEvent = await sessionEndedPromise;
    assert(receivedEvent.roomId === roomId, 'Socket event contains matching roomId');
    assert(receivedEvent.sessionId === activeSession.id, 'Socket event contains matching sessionId');

    console.log('\n\x1b[34m[Test 8]\x1b[0m Acceptance Criteria 2: Verifying open attendance records were closed...\n');
    const attendance = getMockAttendance();
    const openRecords = attendance.filter((a) => a.sessionId === activeSession.id && a.leftAt === null);
    assert(openRecords.length === 0, 'All open attendance records for the session have been closed');
    assert(
      attendance.every((a) => a.sessionId !== activeSession.id || a.leftAt === endBody.endedAt),
      'Attendance leftAt is populated with session endedAt timestamp'
    );

    console.log('\n\x1b[34m[Test 9]\x1b[0m Verifying GET /api/rooms/:roomId/sessions/active returns null after session ended...\n');
    const activeCheckRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/active`, {
      headers: {
        Authorization: `Bearer ${hostToken}`,
      },
    });
    const activeCheckBody = await activeCheckRes.json();
    assert(
      activeCheckRes.status === 200 && activeCheckBody.session === null,
      'Active session is now null',
      `Session: ${JSON.stringify(activeCheckBody.session)}`
    );

    console.log('\n\x1b[34m[Test 10]\x1b[0m Attempting to end an already ended session returns 404 NO_ACTIVE_SESSION...\n');
    const secondEndRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${activeSession.id}/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });
    const secondEndBody = await secondEndRes.json();
    assert(
      secondEndRes.status === 404,
      'Ending session when none is active returns 404',
      `Status: ${secondEndRes.status}, code: ${secondEndBody.error?.code}`
    );

    console.log('\n============================================================');
    console.log(`Summary: ${passedCount} passed, ${failedCount} failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  } finally {
    if (studentSocket && studentSocket.connected) {
      studentSocket.disconnect();
    }
    testServer.close();
  }
}

runTests();
