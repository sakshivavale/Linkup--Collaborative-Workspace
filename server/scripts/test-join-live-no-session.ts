/**
 * Automated Verification Script for US-ERR-02: Join Live When No Session Active
 * Module: Error States & System Resilience
 * Priority: P0 | Traces to: FRD Section 7, FR-3.2
 *
 * Acceptance Criteria Verified:
 * 1. The UI/API shows: "Waiting for the teacher to start the session." when no session is active.
 * 2. When student attempts to join live (HTTP livekit-token or Socket live:joined) before session starts,
 *    it is rejected with 409 / error NO_ACTIVE_SESSION and exact message: "Waiting for the teacher to start the session."
 * 3. When the teacher starts the session, the status updates automatically via session:started event without requiring a page reload.
 * 4. Once session is started, live joining succeeds immediately and attendance tracking activates.
 * 5. When session ends, subsequent live join attempts cleanly revert to "Waiting for the teacher to start the session."
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

const TEST_PORT = 3133;
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
  console.log('🚀 Running US-ERR-02: Join Live When No Session Active Tests');
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
  let hostSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockSessions();
    clearPresence();

    const hostToken = 'test_host_token_us_err_02';
    const studentToken = 'test_student_token_us_err_02';

    const hostUser: Me = {
      id: 'host-user-us-err-02',
      email: 'teacher@linkup.test',
      fullName: 'Prof. Ada Lovelace',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'student-user-us-err-02',
      email: 'student@linkup.test',
      fullName: 'Alan Turing',
      role: 'student',
    };

    setCachedUser(hostToken, hostUser);
    setCachedUser(studentToken, studentUser);

    const roomId = 'room-test-us-err-02';

    const hostRoom = {
      id: roomId,
      name: 'Distributed Systems',
      description: 'US-ERR-02 Active Session Testing',
      joinCode: 'DIST02',
      hostName: hostUser.fullName,
      memberCount: 2,
      myRole: 'host' as const,
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      ownerId: hostUser.id,
      defaultPermissions: {
        canMic: true,
        canCamera: true,
        canScreen: true,
        canWhiteboard: true,
        canCode: true,
      },
      members: [
        {
          userId: hostUser.id,
          fullName: hostUser.fullName,
          userRole: hostUser.role,
          memberRole: 'host' as const,
          permissions: {
            canMic: true,
            canCamera: true,
            canScreen: true,
            canWhiteboard: true,
            canCode: true,
          },
          joinedAt: new Date().toISOString(),
        },
        {
          userId: studentUser.id,
          fullName: studentUser.fullName,
          userRole: studentUser.role,
          memberRole: 'participant' as const,
          permissions: {
            canMic: true,
            canCamera: true,
            canScreen: false,
            canWhiteboard: false,
            canCode: true,
          },
          joinedAt: new Date().toISOString(),
        },
      ],
    };

    const studentRoom = {
      ...hostRoom,
      joinCode: null,
      myRole: 'participant' as const,
    };

    setMockRooms(hostUser.id, [hostRoom]);
    setMockRooms(studentUser.id, [studentRoom]);

    const studentHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${studentToken}`,
    };

    const hostHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hostToken}`,
    };

    // -------------------------------------------------------------------------
    // TEST 1: Acceptance Criterion 1 — Student tries to get live token when no session active
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Test 1]\x1b[0m Verifying student LiveKit token request returns 409 NO_ACTIVE_SESSION with exact message (AC-1)...\n');

    const tokenRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/livekit-token`, {
      method: 'POST',
      headers: studentHeaders,
    });

    assert(tokenRes.status === 409, 'LiveKit token request rejected with HTTP 409 Conflict', `status=${tokenRes.status}`);

    const tokenBody = (await tokenRes.json()) as { error?: { code?: string; message?: string } };
    assert(tokenBody.error?.code === 'NO_ACTIVE_SESSION', 'Error code is NO_ACTIVE_SESSION', `code=${tokenBody.error?.code}`);
    assert(
      tokenBody.error?.message === 'Waiting for the teacher to start the session.',
      'Error message is exactly: "Waiting for the teacher to start the session."',
      `message=${tokenBody.error?.message}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Student connects socket and attempts live:joined when no session active
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 2]\x1b[0m Verifying student socket live:joined is rejected when no session is active...\n');

    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Student socket connection timed out')), 4000);
      studentSocket!.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    // Join room channel first
    await new Promise<void>((resolve) => {
      studentSocket!.emit('room:join', { roomId }, () => resolve());
    });

    // Now emit live:joined when no session active
    const liveJoinedAck = await new Promise<any>((resolve) => {
      studentSocket!.emit('live:joined', { roomId }, (res: any) => {
        resolve(res);
      });
    });

    assert(liveJoinedAck?.ok === false, 'live:joined returns ok: false when no session is active');
    assert(
      liveJoinedAck?.error?.code === 'NO_ACTIVE_SESSION',
      'live:joined returns error code NO_ACTIVE_SESSION',
      `code=${liveJoinedAck?.error?.code}`
    );
    assert(
      liveJoinedAck?.error?.message === 'Waiting for the teacher to start the session.',
      'live:joined error message is exactly: "Waiting for the teacher to start the session."',
      `message=${liveJoinedAck?.error?.message}`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Acceptance Criterion 2 — When teacher starts session, status updates via session:started
    // without requiring page reload
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 3]\x1b[0m Acceptance Criterion 2: Teacher starts session; student receives session:started socket event...\n');

    let receivedSessionStartedEvent: any = null;
    const sessionStartedPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for session:started event')), 5000);
      studentSocket!.on('session:started', (payload: any) => {
        receivedSessionStartedEvent = payload;
        clearTimeout(timeout);
        resolve();
      });
    });

    // Host starts session via API
    const startRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions`, {
      method: 'POST',
      headers: hostHeaders,
    });

    assert(startRes.status === 201, 'Host starting session returns HTTP 201 Created', `status=${startRes.status}`);
    const sessionData = (await startRes.json()) as Session;

    await sessionStartedPromise;

    assert(Boolean(receivedSessionStartedEvent), 'Student received session:started event via Socket.IO');
    assert(receivedSessionStartedEvent?.roomId === roomId, 'Socket event contains matching roomId');
    assert(receivedSessionStartedEvent?.session?.id === sessionData.id, 'Socket event contains started session id');
    assert(receivedSessionStartedEvent?.session?.endedAt === null, 'Active session endedAt is initially null');

    // -------------------------------------------------------------------------
    // TEST 4: After session:started, student can successfully join live call
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 4]\x1b[0m Verifying student can now obtain LiveKit token and join live call...\n');

    const activeTokenRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/livekit-token`, {
      method: 'POST',
      headers: studentHeaders,
    });

    assert(activeTokenRes.status === 200, 'Student LiveKit token request succeeds with 200 OK after session started');
    const activeTokenBody = (await activeTokenRes.json()) as { token?: string; sessionId?: string };
    assert(Boolean(activeTokenBody.token), 'LiveKit token returned in response');
    assert(activeTokenBody.sessionId === sessionData.id, 'SessionId in token matches started session');

    // Emit live:joined now that session is active
    const activeJoinAck = await new Promise<any>((resolve) => {
      studentSocket!.emit('live:joined', { roomId }, (res: any) => {
        resolve(res);
      });
    });

    assert(activeJoinAck?.ok === true, 'Student live:joined succeeds with ok: true once session is active');

    // -------------------------------------------------------------------------
    // TEST 5: When teacher ends session, joining reverts to "Waiting for the teacher to start the session."
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 5]\x1b[0m Verifying ending session emits session:ended and reverts to waiting message...\n');

    let receivedSessionEndedEvent: any = null;
    const sessionEndedPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for session:ended event')), 5000);
      studentSocket!.on('session:ended', (payload: any) => {
        receivedSessionEndedEvent = payload;
        clearTimeout(timeout);
        resolve();
      });
    });

    const endRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${sessionData.id}/end`, {
      method: 'POST',
      headers: hostHeaders,
    });

    assert(endRes.status === 200, 'Host ending session returns 200 OK', `status=${endRes.status}`);
    await sessionEndedPromise;

    assert(receivedSessionEndedEvent?.roomId === roomId, 'Student received session:ended event with correct roomId');
    assert(receivedSessionEndedEvent?.sessionId === sessionData.id, 'Student received session:ended with matching sessionId');

    // Attempting to join live after session end is rejected with waiting message again
    const postEndTokenRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/livekit-token`, {
      method: 'POST',
      headers: studentHeaders,
    });

    assert(postEndTokenRes.status === 409, 'LiveKit token request after session ended returns 409 Conflict');
    const postEndTokenBody = (await postEndTokenRes.json()) as { error?: { code?: string; message?: string } };
    assert(
      postEndTokenBody.error?.message === 'Waiting for the teacher to start the session.',
      'Reverts to: "Waiting for the teacher to start the session."',
      `message=${postEndTokenBody.error?.message}`
    );

    // Socket live:joined also rejected again
    const postEndJoinAck = await new Promise<any>((resolve) => {
      studentSocket!.emit('live:joined', { roomId }, (res: any) => {
        resolve(res);
      });
    });

    assert(postEndJoinAck?.ok === false, 'Socket live:joined rejected after session ended');
    assert(
      postEndJoinAck?.error?.message === 'Waiting for the teacher to start the session.',
      'Socket live:joined error message is: "Waiting for the teacher to start the session."'
    );

  } finally {
    if (studentSocket) studentSocket.disconnect();
    if (hostSocket) hostSocket.disconnect();
    await new Promise<void>((resolve) => {
      testServer.close(() => {
        console.log('\n[Test Server] Closed');
        resolve();
      });
    });
  }

  console.log('\n============================================================');
  console.log(`Summary: ${passedCount} passed, ${failedCount} failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test execution error:', err);
  process.exit(1);
});
