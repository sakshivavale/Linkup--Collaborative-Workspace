/**
 * Automated Verification Script for US-PERM-05: Server-side Permission Enforcement
 * Priority: P0 | Traces to: FR-4.6, BR-5
 *
 * Acceptance Criteria Verified:
 * 1. A student without can_mic whose client attempts to publish audio: LiveKit rejects the publish (permission denied error).
 * 2. A socket wb:update event from a student without can_whiteboard: the server drops the event and emits error { code: "FORBIDDEN" } back to the sender; no other clients receive the update.
 * 3. A socket code:update event from a user who is not the current pen holder: server drops it with error { code: "NOT_PEN_HOLDER" }.
 * 4. PATCH /rooms/:roomId/members/:userId/permissions from a non-host returns 403 HOST_ONLY.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { clearMockSessions, setMockSession } from '../src/lib/sessions';
import { clearPresence } from '../src/realtime/presence';
import { clearCodeWorkspace, setPenHolder, getPenHolder } from '../src/realtime/codeWorkspace';
import { clearWhiteboard } from '../src/realtime/whiteboard';
import { mintLivekitToken, enforceLivekitPublish, sourcesFrom } from '../src/lib/livekit';
import { Me, RoomSummary } from '@linkup/shared';

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
  console.log('🚀 Running US-PERM-05: Server-side Permission Enforcement Tests');
  console.log('   Priority: P0 | Traces to: FR-4.6, BR-5');
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
  let studentPermittedSocket: ClientSocketType | null = null;
  let studentRestrictedSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockSessions();
    clearPresence();
    clearCodeWorkspace();
    clearWhiteboard();

    const hostToken = 'test_host_token_us_perm_05';
    const studentPermittedToken = 'test_student_permitted_token_us_perm_05';
    const studentRestrictedToken = 'test_student_restricted_token_us_perm_05';

    const hostUser: Me = {
      id: 'teacher-user-perm-05',
      email: 'teacher@linkup.test',
      fullName: 'Prof. Ada Lovelace',
      role: 'teacher',
    };

    const studentPermitted: Me = {
      id: 'student-perm-allowed-05',
      email: 'allowed@linkup.test',
      fullName: 'Claude Shannon',
      role: 'student',
    };

    const studentRestricted: Me = {
      id: 'student-perm-restricted-05',
      email: 'restricted@linkup.test',
      fullName: 'Charles Babbage',
      role: 'student',
    };

    setCachedUser(hostToken, hostUser, 60000);
    setCachedUser(studentPermittedToken, studentPermitted, 60000);
    setCachedUser(studentRestrictedToken, studentRestricted, 60000);

    const roomId = 'room-test-us-perm-05';
    const sessionId = 'session-test-us-perm-05';

    setMockSession(roomId, {
      id: sessionId,
      roomId,
      startedAt: new Date().toISOString(),
      endedAt: null,
      startedBy: hostUser.id,
    });


    const roomMembers = [
      {
        userId: hostUser.id,
        fullName: hostUser.fullName,
        userRole: hostUser.role,
        memberRole: 'host' as const,
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
      {
        userId: studentPermitted.id,
        fullName: studentPermitted.fullName,
        userRole: studentPermitted.role,
        memberRole: 'participant' as const,
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
      {
        userId: studentRestricted.id,
        fullName: studentRestricted.fullName,
        userRole: studentRestricted.role,
        memberRole: 'participant' as const,
        permissions: { canMic: false, canCamera: false, canScreen: false, canWhiteboard: false, canCode: false },
        joinedAt: new Date().toISOString(),
      },
    ];

    const hostRoom: RoomSummary = {
      id: roomId,
      name: 'Advanced CS Room',
      description: 'Testing permission guards',
      joinCode: 'PERM05',
      hostName: hostUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: sessionId,
      createdAt: new Date().toISOString(),
      members: roomMembers,
    };

    const permittedRoom: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    const restrictedRoom: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    setMockRooms(hostUser.id, [hostRoom]);
    setMockRooms(studentPermitted.id, [permittedRoom]);
    setMockRooms(studentRestricted.id, [restrictedRoom]);

    // Connect all three users to sockets and join the room channel
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: hostToken },
      transports: ['websocket'],
    });

    studentPermittedSocket = ClientSocket(BASE_URL, {
      auth: { token: studentPermittedToken },
      transports: ['websocket'],
    });

    studentRestrictedSocket = ClientSocket(BASE_URL, {
      auth: { token: studentRestrictedToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) => hostSocket!.on('connect', () => resolve())),
      new Promise<void>((resolve) => studentPermittedSocket!.on('connect', () => resolve())),
      new Promise<void>((resolve) => studentRestrictedSocket!.on('connect', () => resolve())),
    ]);

    // Join room channel
    await Promise.all([
      new Promise<void>((resolve) => hostSocket!.emit('room:join', roomId, () => resolve())),
      new Promise<void>((resolve) => studentPermittedSocket!.emit('room:join', roomId, () => resolve())),
      new Promise<void>((resolve) => studentRestrictedSocket!.emit('room:join', roomId, () => resolve())),
    ]);

    // ─────────────────────────────────────────────────────────────
    // TEST 1: Acceptance Criteria 1 — LiveKit Audio Publish Enforcement
    // ─────────────────────────────────────────────────────────────
    console.log('\x1b[34m[Test 1]\x1b[0m Acceptance Criteria 1: Student without can_mic cannot publish audio (LiveKit rejects publish)...\n');

    // Request LiveKit token for studentRestricted (can_mic = false)
    const tokenResRestricted = await fetch(`${BASE_URL}/api/rooms/${roomId}/livekit-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentRestrictedToken}`,
        'Content-Type': 'application/json',
      },
    });

    assert(tokenResRestricted.status === 200, 'Student can request livekit token for active session');
    const restrictedTokenData = await tokenResRestricted.json();
    assert(Array.isArray(restrictedTokenData.sources), 'Token response contains allowed publish sources');
    assert(!restrictedTokenData.sources.includes('microphone'), 'Token sources does NOT include microphone for student without can_mic');

    // LiveKit server-side publish enforcement: Attempt to publish audio track
    const audioPublishAttemptRestricted = enforceLivekitPublish(
      { canPublish: restrictedTokenData.canPublish, canPublishSources: restrictedTokenData.sources },
      'microphone'
    );
    assert(!audioPublishAttemptRestricted.allowed, 'LiveKit rejects audio publish from student without can_mic');
    assert(
      audioPublishAttemptRestricted.error?.code === 'PERMISSION_DENIED',
      'LiveKit returns PERMISSION_DENIED error on audio publish attempt',
      audioPublishAttemptRestricted.error?.code
    );

    // Request LiveKit token for studentPermitted (can_mic = true)
    const tokenResPermitted = await fetch(`${BASE_URL}/api/rooms/${roomId}/livekit-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentPermittedToken}`,
        'Content-Type': 'application/json',
      },
    });
    const permittedTokenData = await tokenResPermitted.json();
    assert(permittedTokenData.sources.includes('microphone'), 'Token sources includes microphone for permitted student');
    const audioPublishAttemptPermitted = enforceLivekitPublish(
      { canPublish: permittedTokenData.canPublish, canPublishSources: permittedTokenData.sources },
      'microphone'
    );
    assert(audioPublishAttemptPermitted.allowed, 'LiveKit allows audio publish when student has can_mic');

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Acceptance Criteria 2 — Whiteboard Server-side Enforcement
    // ─────────────────────────────────────────────────────────────
    console.log('\n\x1b[34m[Test 2]\x1b[0m Acceptance Criteria 2: Socket wb:update from student without can_whiteboard is dropped with error { code: "FORBIDDEN" }...\n');

    let otherClientReceivedWhiteboardUpdate = false;
    const whiteboardListener = () => {
      otherClientReceivedWhiteboardUpdate = true;
    };
    hostSocket.on('wb:update', whiteboardListener);
    studentPermittedSocket.on('wb:update', whiteboardListener);

    // Attempt crafted wb:update from studentRestricted (can_whiteboard = false)
    const wbForbiddenPromise = new Promise<{ code?: string; event?: string }>((resolve) => {
      studentRestrictedSocket!.once('error', (err: any) => {
        resolve(err);
      });
      studentRestrictedSocket!.emit('wb:update', {
        roomId,
        elements: [{ id: 'crafted-element', type: 'rectangle' }],
      });
    });

    const wbErr = await wbForbiddenPromise;
    assert(wbErr.code === 'FORBIDDEN', 'Server drops wb:update and emits error with code "FORBIDDEN"', wbErr.code);

    // Give time to ensure no message leaked to other sockets
    await new Promise((r) => setTimeout(r, 100));
    assert(!otherClientReceivedWhiteboardUpdate, 'No other clients in room received the unauthorized whiteboard update');

    // Permitted student sends wb:update -> other clients DO receive it
    hostSocket.off('wb:update', whiteboardListener);
    studentPermittedSocket.off('wb:update', whiteboardListener);

    const wbReceivedPromise = new Promise<any>((resolve) => {
      hostSocket!.once('wb:update', (data) => resolve(data));
    });

    studentPermittedSocket.emit('wb:update', {
      roomId,
      elements: [{ id: 'valid-element', type: 'line' }],
    });

    const validWbData = await wbReceivedPromise;
    assert(validWbData.elements?.length === 1, 'Permitted student can broadcast wb:update to room');

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Acceptance Criteria 3 — Code Update Pen Holder Enforcement
    // ─────────────────────────────────────────────────────────────
    console.log('\n\x1b[34m[Test 3]\x1b[0m Acceptance Criteria 3: Socket code:update from non-pen-holder is dropped with error { code: "NOT_PEN_HOLDER" }...\n');

    // Currently host is default pen holder
    const initialHolder = getPenHolder(roomId, hostUser.id);
    assert(initialHolder === hostUser.id, 'Host is initial pen holder');

    let otherClientReceivedCodeState = false;
    const codeListener = () => {
      otherClientReceivedCodeState = true;
    };
    hostSocket.on('code:state', codeListener);
    studentPermittedSocket.on('code:state', codeListener);

    // studentPermitted attempts code:update while host holds the pen
    const codeNotHolderPromise = new Promise<{ code?: string; event?: string }>((resolve) => {
      studentPermittedSocket!.once('error', (err: any) => {
        resolve(err);
      });
      studentPermittedSocket!.emit('code:update', {
        roomId,
        content: 'print("Hacked")',
        language: 'python',
      });
    });

    const codeErr = await codeNotHolderPromise;
    assert(codeErr.code === 'NOT_PEN_HOLDER', 'Server drops code:update and emits error { code: "NOT_PEN_HOLDER" }', codeErr.code);

    await new Promise((r) => setTimeout(r, 100));
    assert(!otherClientReceivedCodeState, 'No other clients received unauthorized code update');

    hostSocket.off('code:state', codeListener);
    studentPermittedSocket.off('code:state', codeListener);

    // Host (pen holder) emits code:update -> other clients receive it
    const codeStatePromise = new Promise<any>((resolve) => {
      studentPermittedSocket!.once('code:state', (data) => resolve(data));
    });

    hostSocket.emit('code:update', {
      roomId,
      content: 'print("Hello LinkUp")',
      language: 'python',
    });

    const validCodeData = await codeStatePromise;
    assert(validCodeData.content === 'print("Hello LinkUp")', 'Pen holder can update code and broadcast to others');

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Acceptance Criteria 4 — PATCH permissions from non-host returns 403 HOST_ONLY
    // ─────────────────────────────────────────────────────────────
    console.log('\n\x1b[34m[Test 4]\x1b[0m Acceptance Criteria 4: PATCH permissions from non-host returns 403 HOST_ONLY...\n');

    // Non-host (studentPermitted) attempts to change permissions
    const nonHostPatchRes = await fetch(`${BASE_URL}/rooms/${roomId}/members/${studentRestricted.id}/permissions`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${studentPermittedToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ canMic: true }),
    });

    assert(nonHostPatchRes.status === 403, 'Non-host PATCH returns HTTP 403 Forbidden', `${nonHostPatchRes.status}`);
    const nonHostPatchBody = await nonHostPatchRes.json();
    assert(
      nonHostPatchBody.error?.code === 'HOST_ONLY',
      'Server returns error code HOST_ONLY for non-host PATCH request',
      nonHostPatchBody.error?.code
    );

    // Verify /api prefix as well
    const nonHostApiPatchRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${studentRestricted.id}/permissions`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${studentPermittedToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ canWhiteboard: true }),
    });
    assert(nonHostApiPatchRes.status === 403, 'Non-host PATCH /api/rooms/... returns HTTP 403');
    const nonHostApiBody = await nonHostApiPatchRes.json();
    assert(nonHostApiBody.error?.code === 'HOST_ONLY', 'Returns error code HOST_ONLY on /api route');

    // Host updates permissions successfully
    const hostPatchRes = await fetch(`${BASE_URL}/rooms/${roomId}/members/${studentRestricted.id}/permissions`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${hostToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ canWhiteboard: true }),
    });
    assert(hostPatchRes.status === 200, 'Host can successfully update member permissions');
    const hostPatchBody = await hostPatchRes.json();
    assert(hostPatchBody.permissions?.canWhiteboard === true, 'Member permissions updated successfully');

  } catch (err: any) {
    console.error('\n\x1b[31m[Test Runner Exception]\x1b[0m', err);
    failedCount++;
  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (studentPermittedSocket) studentPermittedSocket.disconnect();
    if (studentRestrictedSocket) studentRestrictedSocket.disconnect();

    await new Promise<void>((resolve) => {
      testServer.close(() => resolve());
    });

    console.log('\n============================================================');
    console.log(`Test Results: \x1b[32m${passedCount} Passed\x1b[0m | \x1b[31m${failedCount} Failed\x1b[0m`);
    console.log('============================================================\n');

    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runTests();
