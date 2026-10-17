/**
 * Automated Verification Script for US-WB-04: Grant/Revoke Whiteboard Access Live
 * Module: Whiteboard
 * Priority: P0 | Traces to: FR-5.11
 *
 * Acceptance Criteria Verified:
 * 1. Toggling can_whiteboard via the Participants panel sends perm:changed to the room.
 * 2. The target student's view mode updates within 1 second without a page reload.
 * 3. After being revoked, a subsequent wb:update from that student is rejected server-side.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import fs from 'fs';
import path from 'path';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { clearPresence } from '../src/realtime/presence';
import { clearWhiteboard, setWhiteboardElements, getWhiteboardElements } from '../src/realtime/whiteboard';
import { Me, RoomSummary, Member } from '@linkup/shared';

const TEST_PORT = 3196;
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
  console.log('🚀 Running US-WB-04: Grant/Revoke Whiteboard Access Live Tests');
  console.log('   Priority: P0 | Traces to: FR-5.11');
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
  let student1Socket: ClientSocketType | null = null;
  let student2Socket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearPresence();
    clearWhiteboard();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: Static / Component Architecture Verification (AC-1, AC-2, AC-3)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Verifying WhiteboardTab and PeoplePanel architecture for US-WB-04...');
    const whiteboardTabPath = path.resolve(__dirname, '../../client/src/features/rooms/WhiteboardTab.tsx');
    const whiteboardSource = fs.readFileSync(whiteboardTabPath, 'utf8');

    assert(
      whiteboardSource.includes("socket.on('perm:changed'") || whiteboardSource.includes('handlePermChanged'),
      'AC-2: WhiteboardTab listens directly to perm:changed socket event for live permission updates'
    );

    assert(
      whiteboardSource.includes('liveCanWhiteboard') && whiteboardSource.includes('effectiveCanWhiteboard'),
      'AC-2: WhiteboardTab maintains live permission state to toggle view mode dynamically without reload'
    );

    assert(
      whiteboardSource.includes('viewModeEnabled={isReadOnly}') || whiteboardSource.includes('viewModeEnabled={!canWhiteboard}'),
      'AC-2: Excalidraw viewModeEnabled updates live from isReadOnly flag'
    );

    assert(
      whiteboardSource.includes('whiteboard-disabled-badge') &&
      whiteboardSource.includes('whiteboard-edit-badge'),
      'AC-2: WhiteboardTab renders dynamic status badge (Editing enabled vs View-only mode)'
    );

    assert(
      whiteboardSource.includes('pendingUpdatesRef.current.clear()') &&
      whiteboardSource.includes('throttleTimerRef.current'),
      'AC-3: WhiteboardTab cancels pending throttled updates immediately when access is revoked'
    );

    const peoplePanelPath = path.resolve(__dirname, '../../client/src/features/rooms/PeoplePanel.tsx');
    const peoplePanelSource = fs.readFileSync(peoplePanelPath, 'utf8');

    assert(
      peoplePanelSource.includes("key: 'canWhiteboard'") && peoplePanelSource.includes("idKey: 'whiteboard'"),
      'AC-1: Participants panel configures Whiteboard permission toggle (canWhiteboard)'
    );

    assert(
      peoplePanelSource.includes('toggle-perm-whiteboard') || peoplePanelSource.includes('getPermissionToggleId'),
      'AC-1: Participants panel provides toggle button for whiteboard permission per participant'
    );

    assert(
      peoplePanelSource.includes('/permissions') && peoplePanelSource.includes('handleTogglePermission'),
      'AC-1: Participants panel calls PATCH /api/rooms/:roomId/members/:userId/permissions on toggle'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: Environment Setup with Host and Students
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Connecting Host and Students to room via Socket.IO...');
    const roomId = 'room-wb-04-test';
    const hostToken = 'token-teacher-wb-04';
    const student1Token = 'token-student1-wb-04';
    const student2Token = 'token-student2-wb-04';

    const teacherUser: Me = {
      id: 'teacher-wb-04',
      email: 'teacher@linkup.test',
      fullName: 'Prof. Ada Lovelace',
      role: 'teacher',
    };

    const student1User: Me = {
      id: 'student1-wb-04',
      email: 'student1@linkup.test',
      fullName: 'Charles Babbage',
      role: 'student',
    };

    const student2User: Me = {
      id: 'student2-wb-04',
      email: 'student2@linkup.test',
      fullName: 'Grace Hopper',
      role: 'student',
    };

    setCachedUser(hostToken, teacherUser, 60000);
    setCachedUser(student1Token, student1User, 60000);
    setCachedUser(student2Token, student2User, 60000);

    // Initial permissions: student1 has canWhiteboard = false, student2 has canWhiteboard = true
    const teacherMember: Member = {
      userId: teacherUser.id,
      fullName: teacherUser.fullName,
      userRole: 'teacher',
      memberRole: 'host',
      permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
      joinedAt: new Date().toISOString(),
    };

    const student1Member: Member = {
      userId: student1User.id,
      fullName: student1User.fullName,
      userRole: 'student',
      memberRole: 'participant',
      permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: false, canCode: true },
      joinedAt: new Date().toISOString(),
    };

    const student2Member: Member = {
      userId: student2User.id,
      fullName: student2User.fullName,
      userRole: 'student',
      memberRole: 'participant',
      permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: true, canCode: true },
      joinedAt: new Date().toISOString(),
    };

    const roomMock: RoomSummary = {
      id: roomId,
      name: 'US-WB-04 Whiteboard Room',
      description: 'Live Whiteboard Permission Test Room',
      joinCode: 'WB0404',
      hostName: teacherUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      members: [teacherMember, student1Member, student2Member],
    };

    setMockRooms(teacherUser.id, [{ ...roomMock, myRole: 'host' }]);
    setMockRooms(student1User.id, [{ ...roomMock, myRole: 'participant' }]);
    setMockRooms(student2User.id, [{ ...roomMock, myRole: 'participant' }]);

    // Initial board elements
    setWhiteboardElements(roomId, [
      { id: 'initial-line-1', type: 'line', version: 1, versionNonce: 100 },
    ]);

    // Connect all 3 sockets
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: hostToken },
      transports: ['websocket'],
    });

    student1Socket = ClientSocket(BASE_URL, {
      auth: { token: student1Token },
      transports: ['websocket'],
    });

    student2Socket = ClientSocket(BASE_URL, {
      auth: { token: student2Token },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) => hostSocket!.on('connect', () => resolve())),
      new Promise<void>((resolve) => student1Socket!.on('connect', () => resolve())),
      new Promise<void>((resolve) => student2Socket!.on('connect', () => resolve())),
    ]);

    // Join room channel for all 3 sockets
    await Promise.all([
      new Promise<void>((resolve) => hostSocket!.emit('room:join', { roomId }, () => resolve())),
      new Promise<void>((resolve) => student1Socket!.emit('room:join', { roomId }, () => resolve())),
      new Promise<void>((resolve) => student2Socket!.emit('room:join', { roomId }, () => resolve())),
    ]);

    assert(hostSocket.connected && student1Socket.connected && student2Socket.connected, 'Host and students successfully connected and joined room');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: Verify initial restricted state for student1
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 3] Verifying initial restricted student cannot emit wb:update...');
    let initialRestrictedErr: any = null;
    const initialErrPromise = new Promise<void>((resolve) => {
      student1Socket!.once('error', (err: any) => {
        initialRestrictedErr = err;
        resolve();
      });
    });

    student1Socket!.emit('wb:update', {
      roomId,
      elements: [{ id: 'unauthorized-el', type: 'rectangle', version: 1 }],
    });

    await initialErrPromise;
    assert(initialRestrictedErr?.code === 'FORBIDDEN', 'Initial wb:update rejected with FORBIDDEN');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 4: Acceptance Criterion 1 & 2: Host grants can_whiteboard live
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 4] Host grants can_whiteboard live via PATCH (AC-1, AC-2)...');

    const grantStartTime = Date.now();
    let hostReceivedPermChanged: any = null;
    let student1ReceivedPermChanged: any = null;
    let student2ReceivedPermChanged: any = null;

    const hostPermPromise = new Promise<void>((resolve) => {
      hostSocket!.once('perm:changed', (data: any) => {
        hostReceivedPermChanged = data;
        resolve();
      });
    });

    const student1PermPromise = new Promise<void>((resolve) => {
      student1Socket!.once('perm:changed', (data: any) => {
        student1ReceivedPermChanged = data;
        resolve();
      });
    });

    const student2PermPromise = new Promise<void>((resolve) => {
      student2Socket!.once('perm:changed', (data: any) => {
        student2ReceivedPermChanged = data;
        resolve();
      });
    });

    // Host toggles canWhiteboard = true via API (mimicking Participants panel click)
    const grantRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${student1User.id}/permissions`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ canWhiteboard: true }),
    });

    const grantBody = (await grantRes.json()) as any;
    assert(grantRes.status === 200, 'Host PATCH /api/rooms/:roomId/members/:userId/permissions returns 200 OK');
    assert(grantBody.permissions?.canWhiteboard === true, 'Response permissions reflect canWhiteboard = true');

    // Wait for real-time perm:changed broadcast
    await Promise.all([hostPermPromise, student1PermPromise, student2PermPromise]);
    const grantDuration = Date.now() - grantStartTime;

    assert(
      student1ReceivedPermChanged?.roomId === roomId &&
      student1ReceivedPermChanged?.userId === student1User.id &&
      student1ReceivedPermChanged?.permissions?.canWhiteboard === true &&
      student1ReceivedPermChanged?.by === teacherUser.id,
      'AC-1: Toggling can_whiteboard sends perm:changed with correct payload to target student'
    );

    assert(
      hostReceivedPermChanged?.userId === student1User.id &&
      student2ReceivedPermChanged?.userId === student1User.id,
      'AC-1: Room broadcast delivers perm:changed to all room members (host and other participants)'
    );

    assert(
      grantDuration < 1000,
      `AC-2: Target student receives perm:changed in ${grantDuration} ms (within 1 second threshold without reload)`
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 5: Permitted student can now draw and broadcast to room
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 5] Verifying permitted student can now draw and sync with room...');

    let hostReceivedDraw: any = null;
    let student2ReceivedDraw: any = null;

    const hostDrawPromise = new Promise<void>((resolve) => {
      hostSocket!.once('wb:update', (data: any) => {
        hostReceivedDraw = data;
        resolve();
      });
    });

    const student2DrawPromise = new Promise<void>((resolve) => {
      student2Socket!.once('wb:update', (data: any) => {
        student2ReceivedDraw = data;
        resolve();
      });
    });

    const studentDrawing = {
      id: 'student1-drawn-box',
      type: 'rectangle',
      version: 2,
      versionNonce: 200,
      x: 150,
      y: 200,
    };

    const drawAckPromise = new Promise<any>((resolve) => {
      student1Socket!.emit(
        'wb:update',
        {
          roomId,
          elements: [studentDrawing],
        },
        (ack: any) => {
          resolve(ack);
        }
      );
    });

    const [_, __, drawAck] = await Promise.all([hostDrawPromise, student2DrawPromise, drawAckPromise]);

    assert(drawAck?.ok === true, 'Server acknowledges permitted student wb:update successfully');
    assert(
      hostReceivedDraw?.roomId === roomId && hostReceivedDraw?.elements?.[0]?.id === 'student1-drawn-box',
      'Host receives drawing from newly permitted student'
    );
    assert(
      student2ReceivedDraw?.roomId === roomId && student2ReceivedDraw?.elements?.[0]?.id === 'student1-drawn-box',
      'Other student receives drawing from newly permitted student'
    );

    const cachedElements = getWhiteboardElements(roomId) as any[];
    assert(
      cachedElements.some((el) => el.id === 'student1-drawn-box'),
      'Server merged drawing into shared room whiteboard cache'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 6: Acceptance Criterion 3: Host revokes can_whiteboard live
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 6] Host revokes can_whiteboard live via PATCH (AC-1, AC-3)...');

    const revokeStartTime = Date.now();
    let student1ReceivedRevoke: any = null;

    const student1RevokePromise = new Promise<void>((resolve) => {
      student1Socket!.once('perm:changed', (data: any) => {
        student1ReceivedRevoke = data;
        resolve();
      });
    });

    const revokeRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${student1User.id}/permissions`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ canWhiteboard: false }),
    });

    const revokeBody = (await revokeRes.json()) as any;
    assert(revokeRes.status === 200, 'Host PATCH to revoke canWhiteboard returns 200 OK');
    assert(revokeBody.permissions?.canWhiteboard === false, 'Response permissions reflect canWhiteboard = false');

    await student1RevokePromise;
    const revokeDuration = Date.now() - revokeStartTime;

    assert(
      student1ReceivedRevoke?.userId === student1User.id &&
      student1ReceivedRevoke?.permissions?.canWhiteboard === false,
      'AC-1: Target student receives perm:changed with canWhiteboard = false'
    );

    assert(
      revokeDuration < 1000,
      `AC-2: Target student receives revoke notification in ${revokeDuration} ms (within 1 second threshold)`
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 7: Acceptance Criterion 3: Subsequent wb:update is rejected server-side
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 7] Verifying subsequent wb:update from revoked student is rejected server-side (AC-3)...');

    let leakedToHost = false;
    let leakedToStudent2 = false;

    const hostLeakListener = (data: any) => {
      if (data?.elements?.some((el: any) => el.id === 'student1-post-revoke-drawing')) {
        leakedToHost = true;
      }
    };

    const student2LeakListener = (data: any) => {
      if (data?.elements?.some((el: any) => el.id === 'student1-post-revoke-drawing')) {
        leakedToStudent2 = true;
      }
    };

    hostSocket!.on('wb:update', hostLeakListener);
    student2Socket!.on('wb:update', student2LeakListener);

    let postRevokeErr: any = null;
    let postRevokeAck: any = null;

    const postRevokeErrorPromise = new Promise<void>((resolve) => {
      student1Socket!.once('error', (err: any) => {
        postRevokeErr = err;
        resolve();
      });
    });

    student1Socket!.emit(
      'wb:update',
      {
        roomId,
        elements: [
          {
            id: 'student1-post-revoke-drawing',
            type: 'ellipse',
            version: 3,
            versionNonce: 300,
          },
        ],
      },
      (ack: any) => {
        postRevokeAck = ack;
      }
    );

    await postRevokeErrorPromise;
    // Small delay to ensure no leaks
    await new Promise((r) => setTimeout(r, 200));

    assert(
      postRevokeErr?.code === 'FORBIDDEN',
      'AC-3: After being revoked, subsequent wb:update returns error { code: "FORBIDDEN" }'
    );

    assert(
      postRevokeAck?.ok === false && postRevokeAck?.error?.code === 'FORBIDDEN',
      'AC-3: Socket ack returns ok: false with FORBIDDEN error code'
    );

    assert(
      !leakedToHost && !leakedToStudent2,
      'AC-3: Server dropped unauthorized update; neither host nor other students received it'
    );

    const postRevokeCache = getWhiteboardElements(roomId) as any[];
    assert(
      !postRevokeCache.some((el) => el.id === 'student1-post-revoke-drawing'),
      'AC-3: Shared whiteboard cache was not modified by revoked student attempt'
    );

    hostSocket!.off('wb:update', hostLeakListener);
    student2Socket!.off('wb:update', student2LeakListener);

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 8: Authorization Boundaries & Re-grant Verification
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 8] Verifying permission authorization boundaries and re-grant...');

    // Non-host attempts to modify permissions -> 403 HOST_ONLY
    const nonHostRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${student2User.id}/permissions`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${student1Token}`,
      },
      body: JSON.stringify({ canWhiteboard: true }),
    });

    const nonHostBody = (await nonHostRes.json()) as any;
    assert(
      nonHostRes.status === 403 && nonHostBody.error?.code === 'HOST_ONLY',
      'Non-host student cannot toggle permissions (403 HOST_ONLY)'
    );

    // Host cannot toggle their own fixed host permissions -> 403 FORBIDDEN
    const hostSelfRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${teacherUser.id}/permissions`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ canWhiteboard: false }),
    });

    const hostSelfBody = (await hostSelfRes.json()) as any;
    assert(
      hostSelfRes.status === 403 && hostSelfBody.error?.code === 'FORBIDDEN',
      'Host cannot modify their own permissions (403 FORBIDDEN)'
    );

    // Re-grant canWhiteboard = true:
    console.log('Re-granting can_whiteboard to student1...');
    let reGrantReceived: any = null;
    const reGrantPromise = new Promise<void>((resolve) => {
      student1Socket!.once('perm:changed', (data: any) => {
        reGrantReceived = data;
        resolve();
      });
    });

    await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${student1User.id}/permissions`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ canWhiteboard: true }),
    });

    await reGrantPromise;
    assert(reGrantReceived?.permissions?.canWhiteboard === true, 'Student receives re-grant perm:changed event');

    // Now wb:update succeeds again
    let reGrantDrawAck: any = null;
    student1Socket!.emit(
      'wb:update',
      {
        roomId,
        elements: [
          {
            id: 'student1-regrant-drawing',
            type: 'text',
            text: 'Re-granted Access!',
            version: 4,
          },
        ],
      },
      (ack: any) => {
        reGrantDrawAck = ack;
      }
    );

    await new Promise((r) => setTimeout(r, 200));
    assert(reGrantDrawAck?.ok === true, 'Subsequent wb:update succeeds again after re-granting permission');

    console.log('\n============================================================');
    console.log(`Test Results: ${passedCount} Passed | ${failedCount} Failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (student1Socket) student1Socket.disconnect();
    if (student2Socket) student2Socket.disconnect();
    clearMockRooms();
    clearTokenCache();
    clearPresence();
    clearWhiteboard();
    testServer.close();
  }
}

runTests();
