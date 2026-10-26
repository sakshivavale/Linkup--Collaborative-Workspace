/**
 * Automated Verification Script for US-WB-02: Draw on the Whiteboard (Permitted User)
 * Module: Whiteboard
 * Priority: P0 | Traces to: FR-5.11, FR-5.12
 *
 * Acceptance Criteria Verified:
 * 1. The editor is writable for members with can_whiteboard = true and the host.
 * 2. Changed elements are throttled at 100 ms and broadcast via wb:update.
 * 3. All other members see changes within 500 ms.
 * 4. Deletions (Excalidraw isDeleted: true) sync correctly.
 * 5. The image tool is disabled (images need file storage, which is out of scope).
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
import {
  clearWhiteboard,
  getWhiteboardElements,
  setWhiteboardElements,
  mergeWhiteboardElements,
} from '../src/realtime/whiteboard';
import { Me, RoomSummary, Member, WB_THROTTLE_MS } from '@linkup/shared';

const TEST_PORT = 3192;
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
  console.log('🚀 Running US-WB-02: Draw on the Whiteboard (Permitted User) Automated Tests');
  console.log('   Priority: P0 | Traces to: FR-5.11, FR-5.12');
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
  let permittedStudentSocket: ClientSocketType | null = null;
  let restrictedStudentSocket: ClientSocketType | null = null;
  let lateJoinerSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearPresence();
    clearWhiteboard();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: Static & Component Verification (AC-1, AC-2, AC-5)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Static & Component Architecture Verification (AC-1, AC-2, AC-5)...');
    const wbTabPath = path.resolve(__dirname, '../../client/src/features/rooms/WhiteboardTab.tsx');
    const wbTabSource = fs.readFileSync(wbTabPath, 'utf8');

    assert(
      wbTabSource.includes("from '@excalidraw/excalidraw'") && wbTabSource.includes('<Excalidraw'),
      'WhiteboardTab integrates real @excalidraw/excalidraw component'
    );

    assert(
      wbTabSource.includes('viewModeEnabled={isReadOnly}') || wbTabSource.includes('viewModeEnabled={!canWhiteboard}'),
      'AC-1: Excalidraw viewModeEnabled is set to isReadOnly (writable for can_whiteboard=true and host)'
    );

    assert(
      wbTabSource.includes('whiteboard-disabled-badge') &&
      wbTabSource.includes('Teacher turned off whiteboard access'),
      'AC-1: WhiteboardTab displays disabled badge when !canWhiteboard'
    );

    assert(
      wbTabSource.includes('tools:') && wbTabSource.includes('image: false'),
      'AC-5: Image tool is explicitly disabled in Excalidraw UIOptions (tools: { image: false })'
    );

    assert(
      wbTabSource.includes('onPaste=') && wbTabSource.includes('data.files') && wbTabSource.includes('return false'),
      'AC-5: onPaste handler blocks image file pasting into Excalidraw canvas'
    );

    assert(
      wbTabSource.includes('WB_THROTTLE_MS') && WB_THROTTLE_MS === 100,
      'AC-2: Shared constant WB_THROTTLE_MS is 100 ms for throttling whiteboard updates'
    );

    assert(
      wbTabSource.includes('sentVersionsRef') &&
      wbTabSource.includes('pendingUpdatesRef') &&
      wbTabSource.includes('reconcileElements'),
      'AC-2 & AC-3: WhiteboardTab tracks sent/seen versions and uses reconcileElements to prevent echo loops'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // Setup Mock Room & Users for Real-time Verification
    // ─────────────────────────────────────────────────────────────────────────────
    const teacherUser: Me = {
      id: 'teacher-wb-02',
      email: 'teacher-wb@linkup.test',
      fullName: 'Prof. Ada Lovelace',
      role: 'teacher',
    };

    const permittedStudent: Me = {
      id: 'student-permitted-wb-02',
      email: 'student-perm@linkup.test',
      fullName: 'Claude Shannon',
      role: 'student',
    };

    const restrictedStudent: Me = {
      id: 'student-restricted-wb-02',
      email: 'student-restr@linkup.test',
      fullName: 'Charles Babbage',
      role: 'student',
    };

    const lateStudent: Me = {
      id: 'student-late-wb-02',
      email: 'student-late@linkup.test',
      fullName: 'Alan Turing',
      role: 'student',
    };

    const teacherToken = 'mock-token-teacher-wb-02';
    const permittedToken = 'mock-token-student-perm-wb-02';
    const restrictedToken = 'mock-token-student-restr-wb-02';
    const lateToken = 'mock-token-student-late-wb-02';

    setCachedUser(teacherToken, teacherUser);
    setCachedUser(permittedToken, permittedStudent);
    setCachedUser(restrictedToken, restrictedStudent);
    setCachedUser(lateToken, lateStudent);

    const roomId = 'room-wb-02-test';

    const mockMembers: Member[] = [
      {
        userId: teacherUser.id,
        fullName: teacherUser.fullName,
        userRole: teacherUser.role,
        joinedAt: new Date().toISOString(),
        memberRole: 'host',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
      },
      {
        userId: permittedStudent.id,
        fullName: permittedStudent.fullName,
        userRole: permittedStudent.role,
        joinedAt: new Date().toISOString(),
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
      },
      {
        userId: restrictedStudent.id,
        fullName: restrictedStudent.fullName,
        userRole: restrictedStudent.role,
        joinedAt: new Date().toISOString(),
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: false, canCode: true },
      },
      {
        userId: lateStudent.id,
        fullName: lateStudent.fullName,
        userRole: lateStudent.role,
        joinedAt: new Date().toISOString(),
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
      },
    ];

    const teacherRoom: RoomSummary = {
      id: roomId,
      name: 'Interactive Whiteboard Room',
      description: 'Room for verifying US-WB-02',
      joinCode: 'WB02JOIN',
      myRole: 'host',
      membersCount: 4,
      createdAt: new Date().toISOString(),
      activeSessionId: null,
      members: mockMembers,
    };

    const permittedRoom: RoomSummary = {
      ...teacherRoom,
      myRole: 'participant',
    };

    const restrictedRoom: RoomSummary = {
      ...teacherRoom,
      myRole: 'participant',
    };

    const lateRoom: RoomSummary = {
      ...teacherRoom,
      myRole: 'participant',
    };

    setMockRooms(teacherUser.id, [teacherRoom]);
    setMockRooms(permittedStudent.id, [permittedRoom]);
    setMockRooms(restrictedStudent.id, [restrictedRoom]);
    setMockRooms(lateStudent.id, [lateRoom]);

    // Connect Host & Student Sockets
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: teacherToken },
      transports: ['websocket'],
    });

    permittedStudentSocket = ClientSocket(BASE_URL, {
      auth: { token: permittedToken },
      transports: ['websocket'],
    });

    restrictedStudentSocket = ClientSocket(BASE_URL, {
      auth: { token: restrictedToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((r) => hostSocket!.on('connect', r)),
      new Promise<void>((r) => permittedStudentSocket!.on('connect', r)),
      new Promise<void>((r) => restrictedStudentSocket!.on('connect', r)),
    ]);

    // Join room channel
    await Promise.all([
      new Promise<void>((r) => hostSocket!.emit('room:join', { roomId }, () => r())),
      new Promise<void>((r) => permittedStudentSocket!.emit('room:join', { roomId }, () => r())),
      new Promise<void>((r) => restrictedStudentSocket!.emit('room:join', { roomId }, () => r())),
    ]);

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: AC-1 & Server-side Permission Enforcement: Student without can_whiteboard is rejected
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Verifying server rejects wb:update from restricted student (can_whiteboard=false)...');
    let leakDetected = false;
    const leakListener = () => {
      leakDetected = true;
    };
    hostSocket.on('wb:update', leakListener);
    permittedStudentSocket.on('wb:update', leakListener);

    const forbiddenPromise = new Promise<{ code?: string; event?: string }>((resolve) => {
      restrictedStudentSocket!.once('error', (err: any) => resolve(err));
      restrictedStudentSocket!.emit('wb:update', {
        roomId,
        elements: [{ id: 'crafted-rect', type: 'rectangle', version: 1, versionNonce: 100 }],
      });
    });

    const err = await forbiddenPromise;
    assert(err.code === 'FORBIDDEN', 'Server drops unauthorized wb:update and returns error FORBIDDEN', err.code);

    await new Promise((r) => setTimeout(r, 120));
    assert(!leakDetected, 'No other clients in room received unauthorized whiteboard update');
    hostSocket.off('wb:update', leakListener);
    permittedStudentSocket.off('wb:update', leakListener);

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: AC-1, AC-2, AC-3: Permitted student draws -> updates broadcast within 500 ms
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 3] Verifying permitted student draws -> broadcasts to other members within 500 ms (AC-2, AC-3)...');
    const startTime = Date.now();

    const hostReceivePromise = new Promise<any>((resolve) => {
      hostSocket!.once('wb:update', (data) => resolve(data));
    });

    const testElement = {
      id: 'rect-element-1',
      type: 'rectangle',
      x: 100,
      y: 150,
      width: 200,
      height: 100,
      strokeColor: '#6366f1',
      backgroundColor: '#e0e7ff',
      isDeleted: false,
      version: 1,
      versionNonce: 101,
    };

    permittedStudentSocket.emit('wb:update', {
      roomId,
      elements: [testElement],
    });

    const receivedPayload = await hostReceivePromise;
    const latency = Date.now() - startTime;

    assert(receivedPayload.roomId === roomId, 'Broadcast payload contains matching roomId');
    assert(receivedPayload.by === permittedStudent.id, 'Broadcast payload contains sender userId');
    assert(Array.isArray(receivedPayload.elements) && receivedPayload.elements.length === 1, 'Broadcast payload contains changed elements array');
    assert(receivedPayload.elements[0].id === 'rect-element-1', 'Broadcast element id matches drawn element');
    assert(latency < 500, `AC-3: Other member received update in ${latency} ms (well within 500 ms threshold)`);

    // Verify server in-memory elements cache was updated
    const serverElements = getWhiteboardElements(roomId) as any[];
    assert(serverElements.some((e) => e.id === 'rect-element-1'), 'Server merged element into room whiteboard cache');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 4: AC-4: Deletions (Excalidraw isDeleted: true) sync correctly
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 4] Verifying deletions (Excalidraw isDeleted: true) sync correctly (AC-4)...');

    const deletionReceivePromise = new Promise<any>((resolve) => {
      hostSocket!.once('wb:update', (data) => resolve(data));
    });

    const deletedElement = {
      ...testElement,
      isDeleted: true,
      version: 2, // version bumped on delete in Excalidraw
      versionNonce: 102,
    };

    permittedStudentSocket.emit('wb:update', {
      roomId,
      elements: [deletedElement],
    });

    const deletionPayload = await deletionReceivePromise;
    assert(deletionPayload.elements[0].id === 'rect-element-1', 'Deletion update received for rect-element-1');
    assert(deletionPayload.elements[0].isDeleted === true, 'AC-4: isDeleted is true on received update');
    assert(deletionPayload.elements[0].version === 2, 'Version was bumped on deletion');

    const updatedServerElements = getWhiteboardElements(roomId) as any[];
    const cachedElem = updatedServerElements.find((e) => e.id === 'rect-element-1');
    assert(cachedElem && cachedElem.isDeleted === true, 'Server cache holds deleted element with isDeleted: true');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 5: Element Reconciliation & Conflict Resolution (Higher version & lower versionNonce)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 5] Verifying server element reconciliation (higher version & tie-breaking nonce)...');

    // 1. Lower version should NOT overwrite higher version
    mergeWhiteboardElements(roomId, [
      { id: 'rect-element-1', version: 1, versionNonce: 50, isDeleted: false },
    ]);
    const afterStaleMerge = (getWhiteboardElements(roomId) as any[]).find((e) => e.id === 'rect-element-1');
    assert(afterStaleMerge.version === 2 && afterStaleMerge.isDeleted === true, 'Stale lower-version element ignored');

    // 2. Tie on version -> lower versionNonce wins
    mergeWhiteboardElements(roomId, [
      { id: 'tie-element', version: 5, versionNonce: 200, text: 'higher-nonce' },
    ]);
    mergeWhiteboardElements(roomId, [
      { id: 'tie-element', version: 5, versionNonce: 100, text: 'lower-nonce-winner' },
    ]);
    const tieResult = (getWhiteboardElements(roomId) as any[]).find((e) => e.id === 'tie-element');
    assert(tieResult.text === 'lower-nonce-winner', 'Tie on version resolved by lower versionNonce (deterministic tie-break)');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 6: Late Joiner Snapshot: Whiteboard elements restored from room:join snapshot
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 6] Verifying late joiner receives full whiteboard elements in room:join snapshot...');

    lateJoinerSocket = ClientSocket(BASE_URL, {
      auth: { token: lateToken },
      transports: ['websocket'],
    });

    await new Promise<void>((r) => lateJoinerSocket!.on('connect', r));

    const snapshotRes = await new Promise<any>((resolve) => {
      lateJoinerSocket!.emit('room:join', { roomId }, (ack: any) => resolve(ack));
    });

    assert(snapshotRes?.ok === true, 'Late joiner room:join ack ok: true');
    assert(Array.isArray(snapshotRes?.snapshot?.board?.elements), 'Snapshot contains board.elements array');
    const lateElements = snapshotRes.snapshot.board.elements;
    assert(lateElements.some((e: any) => e.id === 'rect-element-1' && e.isDeleted === true), 'Snapshot includes deleted element');
    assert(lateElements.some((e: any) => e.id === 'tie-element'), 'Snapshot includes reconciled tie element');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 7: Host draws on whiteboard and broadcasts to all room members
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 7] Verifying host draws and broadcasts wb:update to all room participants...');

    const studentReceivePromise = new Promise<any>((resolve) => {
      permittedStudentSocket!.once('wb:update', (data) => resolve(data));
    });

    const hostCircleElement = {
      id: 'circle-host-1',
      type: 'ellipse',
      x: 300,
      y: 300,
      width: 150,
      height: 150,
      isDeleted: false,
      version: 1,
      versionNonce: 55,
    };

    hostSocket.emit('wb:update', {
      roomId,
      elements: [hostCircleElement],
    });

    const hostUpdatePayload = await studentReceivePromise;
    assert(hostUpdatePayload.roomId === roomId, 'Student received host wb:update');
    assert(hostUpdatePayload.by === teacherUser.id, 'Host is identified as sender');
    assert(hostUpdatePayload.elements[0].id === 'circle-host-1', 'Element id matches host drawing');

  } catch (err: any) {
    console.error('\n\x1b[31m[Test Suite Error]\x1b[0m', err);
    failedCount++;
  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (permittedStudentSocket) permittedStudentSocket.disconnect();
    if (restrictedStudentSocket) restrictedStudentSocket.disconnect();
    if (lateJoinerSocket) lateJoinerSocket.disconnect();

    testServer.close();

    console.log('\n============================================================');
    console.log(`Test Results: ${passedCount} Passed | ${failedCount} Failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runTests();
