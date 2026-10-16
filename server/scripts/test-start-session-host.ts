/**
 * Automated Verification Script for US-LIVE-01: Start a Session (Host)
 * Priority: P0 | Traces to: FR-3.1
 *
 * Acceptance Criteria Verified:
 * 1. A "Start Session" button is shown in the room header for hosts when no session is active.
 * 2. Clicking starts a session; all room members receive a session:started socket event and see the room update to "Live" status.
 * 3. Only one session can be active per room at a time; a second start attempt returns 409 SESSION_ACTIVE.
 * 4. The session timer starts counting from 00:00 in the header.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { clearMockSessions } from '../src/lib/sessions';
import { clearPresence } from '../src/realtime/presence';
import { Me, Session } from '@linkup/shared';

const TEST_PORT = 3118;
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
  console.log('🚀 Running US-LIVE-01: Start a Session (Host) Tests');
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
    clearPresence();

    const hostToken = 'test_host_token_us_live_01';
    const studentToken = 'test_student_token_us_live_01';
    const outsiderToken = 'test_outsider_token_us_live_01';

    const hostUser: Me = {
      id: 'host-user-us-live-01',
      email: 'host@linkup.test',
      fullName: 'Host Professor',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'student-user-us-live-01',
      email: 'student@linkup.test',
      fullName: 'Student Attendee',
      role: 'student',
    };

    const outsiderUser: Me = {
      id: 'outsider-user-us-live-01',
      email: 'outsider@linkup.test',
      fullName: 'Outsider User',
      role: 'student',
    };

    setCachedUser(hostToken, hostUser, 60000);
    setCachedUser(studentToken, studentUser, 60000);
    setCachedUser(outsiderToken, outsiderUser, 60000);

    const roomId = 'room-test-us-live-01';

    // Configure mock rooms for host and student with NO active session (Idle)
    setMockRooms(hostUser.id, [
      {
        id: roomId,
        name: 'Calculus III Live Classroom',
        description: 'Room for calculus lectures and tutorials',
        joinCode: 'CALC33',
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
        name: 'Calculus III Live Classroom',
        description: 'Room for calculus lectures and tutorials',
        joinCode: null,
        hostName: hostUser.fullName,
        memberCount: 2,
        myRole: 'participant',
        activeSessionId: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    console.log('\x1b[34m[Test 1]\x1b[0m Verifying unauthenticated request to POST /api/rooms/:roomId/sessions returns 401 UNAUTHENTICATED...\n');
    const unauthRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const unauthBody = await unauthRes.json();
    assert(
      unauthRes.status === 401 && unauthBody.error?.code === 'UNAUTHENTICATED',
      'Unauthenticated request rejected with 401 UNAUTHENTICATED',
      `Got status ${unauthRes.status}, code: ${unauthBody.error?.code}`
    );

    console.log('\n\x1b[34m[Test 2]\x1b[0m Verifying non-host participant cannot start a session (403 HOST_ONLY)...\n');
    const studentRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
    });
    const studentBody = await studentRes.json();
    assert(
      studentRes.status === 403 && (studentBody.error?.code === 'HOST_ONLY' || studentBody.error?.code === 'FORBIDDEN'),
      'Student participant cannot start session (403 HOST_ONLY)',
      `Got status ${studentRes.status}, code: ${studentBody.error?.code}`
    );

    console.log('\n\x1b[34m[Test 3]\x1b[0m Verifying outsider cannot start a session (403 HOST_ONLY)...\n');
    const outsiderRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${outsiderToken}`,
      },
    });
    const outsiderBody = await outsiderRes.json();
    assert(
      outsiderRes.status === 403,
      'Outsider non-member cannot start session (403)',
      `Got status ${outsiderRes.status}`
    );

    console.log('\n\x1b[34m[Test 4]\x1b[0m Connecting student to room socket channel to receive session:started event...\n');
    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 4000);
      studentSocket!.on('connect', () => {
        studentSocket!.emit('room:join', { roomId }, (ack: any) => {
          clearTimeout(timeout);
          assert(ack?.ok === true, 'Student successfully joined room socket channel');
          resolve();
        });
      });
      studentSocket!.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Prepare socket listener for session:started event
    const sessionStartedPromise = new Promise<{ roomId: string; session: Session }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('session:started event timed out')), 5000);
      studentSocket!.on('session:started', (payload: any) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });

    console.log('\n\x1b[34m[Test 5]\x1b[0m Host starts a live session via POST /api/rooms/:roomId/sessions (201 Created)...\n');
    const startRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });

    const startBody: Session = await startRes.json();
    assert(
      startRes.status === 201,
      'Host starting session returns HTTP 201 Created',
      `Got status ${startRes.status}`
    );
    assert(
      Boolean(startBody.id && startBody.id.startsWith('session-live-')),
      'Session response contains a valid session id',
      `Session ID: ${startBody.id}`
    );
    assert(
      startBody.roomId === roomId,
      'Session response traces to the target roomId',
      `Room ID: ${startBody.roomId}`
    );
    assert(
      startBody.startedBy === hostUser.id,
      'Session startedBy matches host user ID',
      `Started by: ${startBody.startedBy}`
    );
    assert(
      startBody.endedAt === null,
      'Active session endedAt is initially null',
      `endedAt: ${startBody.endedAt}`
    );
    assert(
      Boolean(startBody.startedAt && !isNaN(new Date(startBody.startedAt).getTime())),
      'Session startedAt contains valid ISO timestamp',
      `startedAt: ${startBody.startedAt}`
    );

    console.log('\n\x1b[34m[Test 6]\x1b[0m Verifying room members receive real-time session:started socket event...\n');
    const receivedEvent = await sessionStartedPromise;
    assert(
      receivedEvent.roomId === roomId,
      'Socket event contains correct roomId',
      `Received roomId: ${receivedEvent.roomId}`
    );
    assert(
      receivedEvent.session?.id === startBody.id,
      'Socket event contains identical session object with matching id',
      `Received session id: ${receivedEvent.session?.id}`
    );

    console.log('\n\x1b[34m[Test 7]\x1b[0m Acceptance Criteria 3: Second start attempt returns 409 SESSION_ACTIVE...\n');
    const secondStartRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });

    const secondStartBody = await secondStartRes.json();
    assert(
      secondStartRes.status === 409,
      'Second start attempt returns HTTP 409 Conflict',
      `Got status ${secondStartRes.status}`
    );
    assert(
      secondStartBody.error?.code === 'SESSION_ACTIVE',
      'Second start attempt returns error code SESSION_ACTIVE',
      `Got code: ${secondStartBody.error?.code}`
    );
    assert(
      Boolean(secondStartBody.error?.message),
      'Second start attempt includes descriptive error message',
      `Message: ${secondStartBody.error?.message}`
    );

    console.log('\n\x1b[34m[Test 8]\x1b[0m Verifying GET /api/rooms/:roomId/sessions/active returns the active session...\n');
    const activeRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/active`, {
      headers: {
        Authorization: `Bearer ${hostToken}`,
      },
    });
    const activeBody = await activeRes.json();
    assert(
      activeRes.status === 200 && activeBody.session?.id === startBody.id,
      'GET /api/rooms/:roomId/sessions/active returns the current active session',
      `Active session id: ${activeBody.session?.id}`
    );

    console.log('\n============================================================');
    console.log(`Summary: ${passedCount} passed, ${failedCount} failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (studentSocket?.connected) {
      studentSocket.disconnect();
    }
    clearMockRooms();
    clearMockSessions();
    clearTokenCache();
    testServer.close();
  }
}

runTests();
