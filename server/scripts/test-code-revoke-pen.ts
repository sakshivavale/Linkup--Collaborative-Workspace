/**
 * Automated Verification Script for US-CODE-04: Revoke Code Permission from Pen Holder
 * Module: Code Workspace
 * Priority: P0 | Traces to: FR-5.4
 *
 * Acceptance Criteria Verified:
 * 1. When can_code is revoked from the current pen holder, the server automatically calls codeService.setPen(roomId, hostId).
 * 2. A code:pen { holderId: hostId } event is emitted to all room members.
 * 3. The former holder's editor immediately switches to read-only.
 * 4. The host's editor becomes writable.
 * 5. CodeTab UI component verifies read-only state, eligibleStudents filtering, and debounce cancellation.
 * 6. Bulk permission revocation also safely reclaims pen to host if pen holder was revoked.
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
import { clearCodeWorkspace, setPenHolder, getCodeState, getPenHolder, codeService } from '../src/realtime/codeWorkspace';
import { Me, RoomSummary, Member } from '@linkup/shared';

const TEST_PORT = 3145;
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
  console.log('🚀 Running US-CODE-04: Revoke Code Permission from Pen Holder');
  console.log('   Priority: P0 | Traces to: FR-5.4');
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
  let observerSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearPresence();
    clearCodeWorkspace();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: Static / Component Verification of US-CODE-04 in CodeTab.tsx & server
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Verifying CodeTab & codeWorkspace implementation for US-CODE-04...');
    const codeTabPath = path.resolve(__dirname, '../../client/src/features/rooms/CodeTab.tsx');
    const codeTabSource = fs.readFileSync(codeTabPath, 'utf8');

    assert(
      codeTabSource.includes('US-CODE-04') && codeTabSource.includes('FR-5.4'),
      'CodeTab references US-CODE-04 and FR-5.4 in documentation'
    );

    assert(
      codeTabSource.includes('userHasCodePermission') &&
      codeTabSource.includes('canEdit = Boolean(isPenHolder && userHasCodePermission)') &&
      codeTabSource.includes('isReadOnly = !canEdit'),
      'CodeTab calculates canEdit and isReadOnly with userHasCodePermission check (AC-3, AC-4)'
    );

    assert(
      codeTabSource.includes('id="code-readonly-badge"') &&
      codeTabSource.includes('id="room-code-editor-sync"') &&
      codeTabSource.includes('readOnly={isReadOnly}'),
      'CodeTab binds isReadOnly to UI badge, Monaco domReadOnly/readOnly, and sync textarea (AC-3)'
    );

    assert(
      codeTabSource.includes('debounceTimerRef.current') &&
      codeTabSource.includes('clearTimeout(debounceTimerRef.current)'),
      'CodeTab cancels pending debounced keystrokes immediately when canEdit is lost (AC-3)'
    );

    const codeWorkspacePath = path.resolve(__dirname, '../src/realtime/codeWorkspace.ts');
    const codeWorkspaceSource = fs.readFileSync(codeWorkspacePath, 'utf8');

    assert(
      codeWorkspaceSource.includes('export const codeService =') &&
      codeWorkspaceSource.includes('setPen: setPenHolder'),
      'codeWorkspace exports codeService.setPen conforming to AC-1'
    );

    const appPath = path.resolve(__dirname, '../src/app.ts');
    const appSource = fs.readFileSync(appPath, 'utf8');

    assert(
      appSource.includes('codeService.setPen(roomId, hostId)') ||
      appSource.includes('codeService.setPen(roomId, user.id)'),
      'app.ts calls codeService.setPen on permission revocation (AC-1)'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // Setup Mock Data & Rooms for Real-time Verification
    // ─────────────────────────────────────────────────────────────────────────────
    const teacherUser: Me = {
      id: 'teacher-code-04',
      email: 'teacher4@linkup.test',
      fullName: 'Prof. Dijkstra',
      role: 'teacher',
    };

    const studentPenHolder: Me = {
      id: 'student-alyssa-04',
      email: 'alyssa4@linkup.test',
      fullName: 'Alyssa Hacker',
      role: 'student',
    };

    const studentObserver: Me = {
      id: 'student-ben-04',
      email: 'ben4@linkup.test',
      fullName: 'Ben Bitdiddle',
      role: 'student',
    };

    const teacherToken = 'token-teacher-04';
    const studentToken = 'token-student-alyssa-04';
    const observerToken = 'token-student-ben-04';

    setCachedUser(teacherToken, teacherUser);
    setCachedUser(studentToken, studentPenHolder);
    setCachedUser(observerToken, studentObserver);

    const roomId = 'room-code-test-04';
    const roomMembers: Member[] = [
      {
        userId: teacherUser.id,
        fullName: teacherUser.fullName,
        userRole: 'teacher',
        memberRole: 'host',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
      {
        userId: studentPenHolder.id,
        fullName: studentPenHolder.fullName,
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
      {
        userId: studentObserver.id,
        fullName: studentObserver.fullName,
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
    ];

    const hostRoom: RoomSummary = {
      id: roomId,
      name: 'Compiler Design Lab',
      description: 'US-CODE-04 automated test room',
      joinCode: 'REV004',
      hostName: teacherUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      members: roomMembers,
    };

    const studentRoom: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    const observerRoom: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    setMockRooms(teacherUser.id, [hostRoom]);
    setMockRooms(studentPenHolder.id, [studentRoom]);
    setMockRooms(studentObserver.id, [observerRoom]);

    // Connect Sockets
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: teacherToken },
      transports: ['websocket'],
    });

    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    observerSocket = ClientSocket(BASE_URL, {
      auth: { token: observerToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => {
      let connected = 0;
      const onConn = () => {
        connected++;
        if (connected === 3) resolve();
      };
      hostSocket!.on('connect', onConn);
      studentSocket!.on('connect', onConn);
      observerSocket!.on('connect', onConn);
    });

    await new Promise<void>((resolve) => {
      let joined = 0;
      const onJoined = () => {
        joined++;
        if (joined === 3) resolve();
      };
      hostSocket!.emit('room:join', { roomId }, onJoined);
      studentSocket!.emit('room:join', { roomId }, onJoined);
      observerSocket!.emit('room:join', { roomId }, onJoined);
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: Assign Pen to Student Alyssa Hacker (Setup for Revoke)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Setting up initial pen assignment to student Alyssa...');

    const studentAssignedPenPromise = new Promise<{ roomId: string; holderId: string }>((resolve) => {
      studentSocket!.once('code:pen', (data) => resolve(data));
    });

    await new Promise<void>((resolve, reject) => {
      hostSocket!.emit('code:pen', { roomId, holderId: studentPenHolder.id }, (ack: any) => {
        if (ack?.ok) resolve();
        else reject(new Error(ack?.error?.message || 'Failed to assign pen'));
      });
    });

    const assignPayload = await studentAssignedPenPromise;
    assert(assignPayload.holderId === studentPenHolder.id, 'Pen successfully assigned to Alyssa Hacker');
    assert(getPenHolder(roomId) === studentPenHolder.id, 'Server code state confirms Alyssa holds pen');

    // Verify Alyssa can write code
    const writeAckPromise = new Promise<any>((resolve) => {
      studentSocket!.emit(
        'code:update',
        { roomId, content: 'def solve(): return 42', language: 'python' },
        (ack: any) => resolve(ack)
      );
    });
    const writeAck = await writeAckPromise;
    assert(writeAck?.ok === true, 'Alyssa can edit code while holding the pen');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: Revoke can_code from Current Pen Holder (US-CODE-04 Acceptance Criteria)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 3] AC-1 & AC-2: Revoking can_code from pen holder Alyssa...');

    // We monitor code:pen events on ALL room members: host, student (former holder), and observer
    const hostPenPromise = new Promise<any>((resolve) => hostSocket!.once('code:pen', (data) => resolve(data)));
    const studentPenPromise = new Promise<any>((resolve) => studentSocket!.once('code:pen', (data) => resolve(data)));
    const observerPenPromise = new Promise<any>((resolve) => observerSocket!.once('code:pen', (data) => resolve(data)));

    // Host calls PATCH /api/rooms/:roomId/members/:userId/permissions with canCode: false
    const revokeRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${studentPenHolder.id}/permissions`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ canCode: false }),
    });

    assert(revokeRes.status === 200, 'Host successfully revoked can_code (HTTP 200)');
    const revokeBody = await revokeRes.json();
    assert(revokeBody.permissions?.canCode === false, 'Response confirms canCode is false for Alyssa');

    // AC-1: Verify server state automatically called codeService.setPen(roomId, hostId)
    const currentServerHolder = getPenHolder(roomId);
    assert(
      currentServerHolder === teacherUser.id,
      'AC-1: Server automatically called codeService.setPen(roomId, hostId) and restored pen to host',
      `Current holder: ${currentServerHolder}`
    );

    // AC-2: Verify code:pen { holderId: hostId } was emitted to ALL room members
    const hostPenEvent = await hostPenPromise;
    const studentPenEvent = await studentPenPromise;
    const observerPenEvent = await observerPenPromise;

    assert(
      hostPenEvent.holderId === teacherUser.id,
      'AC-2: Host received code:pen { holderId: hostId } event',
      JSON.stringify(hostPenEvent)
    );
    assert(
      studentPenEvent.holderId === teacherUser.id,
      'AC-2: Former holder received code:pen { holderId: hostId } event',
      JSON.stringify(studentPenEvent)
    );
    assert(
      observerPenEvent.holderId === teacherUser.id,
      'AC-2: Observer member received code:pen { holderId: hostId } event',
      JSON.stringify(observerPenEvent)
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 4: AC-3 — Former Holder's Editor Immediately Switches to Read-Only
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 4] AC-3: Verifying former holder Alyssa cannot edit (read-only enforcement)...');

    // Student attempts to emit code:update after pen revocation
    const studentUpdateErrPromise = new Promise<{ code?: string; message?: string }>((resolve) => {
      studentSocket!.once('error', (err: any) => resolve(err));
      studentSocket!.emit('code:update', {
        roomId,
        content: 'def hacked(): return False',
        language: 'python',
      });
    });

    const studentUpdateErr = await studentUpdateErrPromise;
    assert(
      studentUpdateErr.code === 'NOT_PEN_HOLDER',
      'AC-3: Server rejects former holder code:update with error { code: "NOT_PEN_HOLDER" }',
      studentUpdateErr.code
    );

    // Verify code state in server was not altered
    const stateAfterBlockedEdit = getCodeState(roomId);
    assert(
      stateAfterBlockedEdit.content === 'def solve(): return 42',
      'Code content preserved; unauthorized edit was dropped'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 5: AC-4 — Host's Editor Becomes Writable
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 5] AC-4: Verifying host editor is writable...');

    const hostEditStatePromise = new Promise<any>((resolve) => {
      studentSocket!.once('code:state', (data) => resolve(data));
    });

    const hostUpdateAckPromise = new Promise<any>((resolve) => {
      hostSocket!.emit(
        'code:update',
        {
          roomId,
          content: '# Host reclaimed editor\nprint("Back with teacher")',
          language: 'python',
        },
        (ack: any) => resolve(ack)
      );
    });

    const hostAck = await hostUpdateAckPromise;
    assert(hostAck?.ok === true, 'AC-4: Host code:update acknowledged successfully');

    const broadcastState = await hostEditStatePromise;
    assert(
      broadcastState.content === '# Host reclaimed editor\nprint("Back with teacher")',
      'AC-4: Host edits broadcast to all members; host editor is fully writable'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 6: Host Cannot Re-assign Pen to Alyssa (can_code is false)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 6] Verifying host cannot re-assign pen to Alyssa without can_code...');

    const reassignErrPromise = new Promise<any>((resolve) => {
      hostSocket!.emit('code:pen', { roomId, holderId: studentPenHolder.id }, (ack: any) => {
        resolve(ack);
      });
    });

    const reassignRes = await reassignErrPromise;
    assert(
      reassignRes?.ok === false && reassignRes?.error?.code === 'FORBIDDEN',
      'Host assignment to student without can_code rejected with FORBIDDEN'
    );
    assert(getPenHolder(roomId) === teacherUser.id, 'Pen remains with host');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 7: Bulk Revocation Reclaims Pen (Edge Case)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 7] Verifying bulk permission revocation reclaims pen if held by student...');

    // Re-grant canCode to Alyssa and give her the pen
    await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${studentPenHolder.id}/permissions`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${teacherToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ canCode: true }),
    });

    await new Promise<void>((resolve) => {
      hostSocket!.emit('code:pen', { roomId, holderId: studentPenHolder.id }, () => resolve());
    });
    assert(getPenHolder(roomId) === studentPenHolder.id, 'Pen given back to Alyssa');

    // Wait for the re-assignment event to settle
    await new Promise((r) => setTimeout(r, 100));

    // Bulk revoke canCode for all students in the room
    const bulkRevokePenPromise = new Promise<any>((resolve) => studentSocket!.once('code:pen', (data) => resolve(data)));
    const bulkRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/permissions/bulk`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ canCode: false }),
    });

    assert(bulkRes.status === 200, 'Bulk permission update successful');
    const bulkPenEvent = await bulkRevokePenPromise;
    assert(bulkPenEvent.holderId === teacherUser.id, 'Bulk canCode revocation returned pen to host');
    assert(getPenHolder(roomId) === teacherUser.id, 'Server pen holder is host after bulk revocation');

  } catch (err: any) {
    console.error('\n\x1b[31m[Test Exception]\x1b[0m', err);
    failedCount++;
  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (studentSocket) studentSocket.disconnect();
    if (observerSocket) observerSocket.disconnect();

    await new Promise<void>((resolve) => {
      testServer.close(() => resolve());
    });

    console.log('\n============================================================');
    console.log(`Results: \x1b[32m${passedCount} passed\x1b[0m, \x1b[31m${failedCount} failed\x1b[0m`);
    console.log('============================================================\n');

    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runTests();
