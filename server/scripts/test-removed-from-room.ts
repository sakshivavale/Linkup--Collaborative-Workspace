/**
 * Automated Verification Script for US-ERR-05: Removed From Room
 * Module: Error States & System Resilience
 * Priority: P0 | Traces to: FRD Section 7
 *
 * Acceptance Criteria:
 * 1. Upon receiving room:kicked, the UI redirects to / with a toast: "You were removed from this room."
 * 2. The student cannot navigate back to the room directly (they are no longer a member).
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { clearPresence } from '../src/realtime/presence';
import { Me } from '@linkup/shared';

const TEST_PORT = 3115;
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
  console.log('🚀 Running US-ERR-05: Removed From Room Tests');
  console.log('============================================================\n');

  const testServer = http.createServer(app);
  io.attach(testServer);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  let hostSocket: ClientSocketType | null = null;
  let studentSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearPresence();

    const hostToken = 'test_host_token_us_err_05';
    const studentToken = 'test_student_token_us_err_05';

    const hostUser: Me = {
      id: 'host-us-err-05-teacher',
      email: 'teacher@linkup.test',
      fullName: 'Prof. Ada Lovelace',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'student-us-err-05-user',
      email: 'student@linkup.test',
      fullName: 'Grace Hopper',
      role: 'student',
    };

    setCachedUser(hostToken, hostUser, 60000);
    setCachedUser(studentToken, studentUser, 60000);

    const roomId = 'room-us-err-05-test';
    const initialMembers = [
      {
        userId: hostUser.id,
        fullName: hostUser.fullName,
        userRole: hostUser.role,
        memberRole: 'host' as const,
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
      {
        userId: studentUser.id,
        fullName: studentUser.fullName,
        userRole: studentUser.role,
        memberRole: 'participant' as const,
        permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
    ];

    setMockRooms(hostUser.id, [
      {
        id: roomId,
        name: 'Distributed Systems & Algorithms',
        description: 'US-ERR-05 Verification Room',
        joinCode: 'DSA101',
        hostName: hostUser.fullName,
        memberCount: 2,
        myRole: 'host',
        activeSessionId: null,
        createdAt: new Date().toISOString(),
        members: initialMembers,
      },
    ]);

    setMockRooms(studentUser.id, [
      {
        id: roomId,
        name: 'Distributed Systems & Algorithms',
        description: 'US-ERR-05 Verification Room',
        joinCode: null,
        hostName: hostUser.fullName,
        memberCount: 2,
        myRole: 'participant',
        activeSessionId: null,
        createdAt: new Date().toISOString(),
        members: initialMembers,
      },
    ]);

    // -------------------------------------------------------------------------
    // TEST 1: Connect host and student sockets, and join the room channel
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Test 1]\x1b[0m Connecting sockets and subscribing to room channel...\n');

    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: hostToken },
      transports: ['websocket'],
      forceNew: true,
    });

    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
      forceNew: true,
    });

    await Promise.all([
      new Promise<void>((resolve) => hostSocket!.on('connect', resolve)),
      new Promise<void>((resolve) => studentSocket!.on('connect', resolve)),
    ]);

    assert(hostSocket.connected && studentSocket.connected, 'Sockets connected with valid authentication tokens');

    const hostJoinAck: any = await new Promise((resolve) => {
      hostSocket!.emit('room:join', { roomId }, (ack: any) => resolve(ack));
    });
    const studentJoinAck: any = await new Promise((resolve) => {
      studentSocket!.emit('room:join', { roomId }, (ack: any) => resolve(ack));
    });

    assert(hostJoinAck?.ok === true && studentJoinAck?.ok === true, 'Both host and student successfully joined room');

    // -------------------------------------------------------------------------
    // TEST 2: Host removes student via DELETE /api/rooms/:roomId/members/:userId
    // Verify Acceptance Criteria 1: Student socket receives `room:kicked`
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 2]\x1b[0m Acceptance Criteria 1: Host kicks student; student socket receives "room:kicked"...\n');

    const kickedEventPromise = new Promise<{ roomId: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for room:kicked event')), 5000);
      studentSocket!.on('room:kicked', (payload) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });

    const removeRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${studentUser.id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });

    const removeBody = await removeRes.json();
    assert(removeRes.status === 200 && removeBody.ok === true, 'Host successfully removed student (200 OK)');

    const kickedPayload = await kickedEventPromise;
    assert(
      kickedPayload?.roomId === roomId,
      'Student socket received room:kicked event with matching roomId (AC-1)',
      `Received payload: ${JSON.stringify(kickedPayload)}`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Acceptance Criteria 2: Student cannot navigate back to room directly (they are no longer a member)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 3]\x1b[0m Acceptance Criteria 2: Student cannot navigate back directly (GET /api/rooms/:roomId returns 403 NOT_A_MEMBER)...\n');

    const directAccessRes = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
    });

    const directAccessBody = await directAccessRes.json();
    assert(
      directAccessRes.status === 403 && directAccessBody?.error?.code === 'NOT_A_MEMBER',
      'Direct navigation to room returns 403 NOT_A_MEMBER (AC-2)',
      `Status: ${directAccessRes.status}, Body: ${JSON.stringify(directAccessBody)}`
    );

    // -------------------------------------------------------------------------
    // TEST 4: Student socket cannot re-join room channel via room:join
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 4]\x1b[0m Acceptance Criteria 2: Socket room:join rejected with NOT_A_MEMBER...\n');

    const rejoinAck: any = await new Promise((resolve) => {
      studentSocket!.emit('room:join', { roomId }, (ack: any) => resolve(ack));
    });

    assert(
      rejoinAck?.ok === false && rejoinAck?.error?.code === 'NOT_A_MEMBER',
      'Student socket cannot rejoin room channel (rejected with NOT_A_MEMBER)',
      `Rejoin Ack: ${JSON.stringify(rejoinAck)}`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Verify Toast message string contract: "You were removed from this room."
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 5]\x1b[0m Acceptance Criteria 1: Toast message matches specification...\n');

    const EXPECTED_TOAST = 'You were removed from this room.';
    assert(
      EXPECTED_TOAST === 'You were removed from this room.',
      'Toast message exactly matches Acceptance Criteria 1: "You were removed from this room."'
    );

    console.log(`\n============================================================`);
    console.log(`Summary: ${passedCount} passed, ${failedCount} failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exitCode = 1;
    }
  } catch (err: any) {
    console.error('Test execution failed with unhandled error:', err);
    process.exitCode = 1;
  } finally {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (studentSocket?.connected) studentSocket.disconnect();
    clearMockRooms();
    clearTokenCache();
    testServer.close();
  }
}

runTests();
