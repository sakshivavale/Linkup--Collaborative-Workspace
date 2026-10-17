/**
 * Automated Verification Script for US-WB-01: View the Shared Whiteboard
 * Module: Whiteboard
 * Priority: P0 | Traces to: FR-5.10, FR-5.11
 *
 * Acceptance Criteria Verified:
 * 1. The Whiteboard tab renders Excalidraw in view-only mode for members where can_whiteboard = false and who are not the host.
 * 2. Drawings appear in view-only mode with no drawing tools visible.
 * 3. Attempting a whiteboard draw via a crafted socket event returns error { code: "FORBIDDEN" } and does not affect the board for others.
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

const TEST_PORT = 3169;
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
  console.log('🚀 Running US-WB-01: View the Shared Whiteboard Automated Tests');
  console.log('   Priority: P0 | Traces to: FR-5.10, FR-5.11');
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
  let viewOnlyStudentSocket: ClientSocketType | null = null;
  let permittedStudentSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearPresence();
    clearWhiteboard();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: Static / Component Verification of Excalidraw View-Only Mode (AC-1 & AC-2)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Verifying WhiteboardTab renders Excalidraw in view-only mode (AC-1, AC-2)...');
    const whiteboardTabPath = path.resolve(__dirname, '../../client/src/features/rooms/WhiteboardTab.tsx');
    const whiteboardSource = fs.readFileSync(whiteboardTabPath, 'utf8');

    assert(
      whiteboardSource.includes('@excalidraw/excalidraw') && whiteboardSource.includes('<Excalidraw'),
      'WhiteboardTab imports and renders Excalidraw from @excalidraw/excalidraw'
    );

    assert(
      whiteboardSource.includes('!isHost && !canWhiteboard') || whiteboardSource.includes('isReadOnly'),
      'WhiteboardTab calculates view-only condition: members where can_whiteboard = false and who are not the host'
    );

    assert(
      whiteboardSource.includes('viewModeEnabled={isReadOnly}') || whiteboardSource.includes('viewModeEnabled={!isHost && !canWhiteboard}'),
      'Excalidraw receives viewModeEnabled in view-only mode to hide all drawing tools'
    );

    assert(
      whiteboardSource.includes('whiteboard-disabled-badge') &&
      whiteboardSource.includes('whiteboard-view-only-badge'),
      'Whiteboard tab renders view-only badge indicating read-only access'
    );

    assert(
      whiteboardSource.includes('tools: {') && whiteboardSource.includes('image: false'),
      'Excalidraw UIOptions disables image tool per architecture specification'
    );

    assert(
      whiteboardSource.includes('room-whiteboard-canvas') && whiteboardSource.includes('room-whiteboard-container'),
      'Whiteboard container elements have id="room-whiteboard-container" and id="room-whiteboard-canvas"'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // Setup Mock Room and Users for Real-Time Socket Tests
    // ─────────────────────────────────────────────────────────────────────────────
    const roomId = 'room-wb-test-01';

    const teacherUser: Me = {
      id: 'teacher-wb-01',
      fullName: 'Prof. Turing',
      role: 'teacher',
      email: 'teacher.wb@linkup.test',
    };
    const teacherToken = 'token-teacher-wb-01';
    setCachedUser(teacherToken, teacherUser);

    const viewOnlyStudent: Me = {
      id: 'student-viewonly-01',
      fullName: 'Ada Lovelace',
      role: 'student',
      email: 'ada@linkup.test',
    };
    const viewOnlyStudentToken = 'token-student-viewonly-01';
    setCachedUser(viewOnlyStudentToken, viewOnlyStudent);

    const permittedStudent: Me = {
      id: 'student-permitted-01',
      fullName: 'Charles Babbage',
      role: 'student',
      email: 'charles@linkup.test',
    };
    const permittedStudentToken = 'token-student-permitted-01';
    setCachedUser(permittedStudentToken, permittedStudent);

    const mockMembers: Member[] = [
      {
        userId: teacherUser.id,
        fullName: teacherUser.fullName,
        userRole: 'teacher',
        memberRole: 'host',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
      {
        userId: viewOnlyStudent.id,
        fullName: viewOnlyStudent.fullName,
        userRole: 'student',
        memberRole: 'participant',
        // can_whiteboard = false
        permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: false, canCode: false },
        joinedAt: new Date().toISOString(),
      },
      {
        userId: permittedStudent.id,
        fullName: permittedStudent.fullName,
        userRole: 'student',
        memberRole: 'participant',
        // can_whiteboard = true
        permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: true, canCode: false },
        joinedAt: new Date().toISOString(),
      },
    ];

    const mockRoom: RoomSummary = {
      id: roomId,
      name: 'Algorithm Analysis Whiteboard',
      description: 'Collaborative Whiteboard Room',
      joinCode: 'WB01AA',
      hostName: teacherUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      members: mockMembers,
    };

    setMockRooms(teacherUser.id, [{ ...mockRoom, myRole: 'host' }]);
    setMockRooms(viewOnlyStudent.id, [{ ...mockRoom, myRole: 'participant' }]);
    setMockRooms(permittedStudent.id, [{ ...mockRoom, myRole: 'participant' }]);

    // Pre-populate whiteboard with initial drawing elements (FR-5.10, FR-5.11)
    const initialDrawings = [
      { id: 'shape-1', type: 'rectangle', x: 100, y: 150, width: 200, height: 100, version: 1, versionNonce: 101 },
      { id: 'text-1', type: 'text', x: 120, y: 180, text: 'Binary Tree', version: 1, versionNonce: 102 },
    ];
    setWhiteboardElements(roomId, initialDrawings);

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: Late Join / Room Join Snapshot contains drawings (AC-1, AC-2)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Verifying view-only member receives drawings on room:join snapshot...');

    viewOnlyStudentSocket = ClientSocket(BASE_URL, {
      auth: { token: viewOnlyStudentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      viewOnlyStudentSocket!.on('connect', () => resolve());
      viewOnlyStudentSocket!.on('connect_error', reject);
    });

    const joinAckPromise = new Promise<any>((resolve) => {
      viewOnlyStudentSocket!.emit('room:join', { roomId }, (res: any) => {
        resolve(res);
      });
    });

    const joinRes = await joinAckPromise;
    assert(joinRes?.ok === true, 'View-only student successfully joins room');

    const snapshotBoard = joinRes?.snapshot?.board || joinRes?.data?.board;
    assert(
      Array.isArray(snapshotBoard?.elements) && snapshotBoard.elements.length === 2,
      'View-only student receives existing drawings in room:join snapshot'
    );
    assert(
      snapshotBoard?.elements?.some((el: any) => el.id === 'shape-1') &&
      snapshotBoard?.elements?.some((el: any) => el.text === 'Binary Tree'),
      'Drawing elements match initial board state exactly'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: Host draws and View-Only student receives live drawings (AC-1, AC-2)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 3] Verifying view-only student receives real-time drawings via wb:update...');

    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: teacherToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      hostSocket!.on('connect', () => resolve());
      hostSocket!.on('connect_error', reject);
    });

    await new Promise<void>((resolve) => {
      hostSocket!.emit('room:join', { roomId }, () => resolve());
    });

    const newDrawings = [
      ...initialDrawings,
      { id: 'shape-2', type: 'arrow', x: 200, y: 250, points: [[0, 0], [100, 100]], version: 2, versionNonce: 201 },
    ];

    const studentReceivedWbUpdatePromise = new Promise<any>((resolve) => {
      viewOnlyStudentSocket!.once('wb:update', (data: any) => {
        resolve(data);
      });
    });

    hostSocket.emit('wb:update', {
      roomId,
      elements: newDrawings,
    });

    const receivedUpdate = await studentReceivedWbUpdatePromise;
    assert(receivedUpdate?.roomId === roomId, 'View-only student received wb:update for the room');
    assert(
      Array.isArray(receivedUpdate?.elements) && receivedUpdate.elements.length === 3,
      'View-only student receives all 3 updated drawings'
    );
    assert(
      receivedUpdate.elements.some((el: any) => el.id === 'shape-2'),
      'Newly drawn arrow shape is present in live update'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 4: Crafted socket event from member with can_whiteboard = false (AC-3)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 4] Attempting crafted wb:update from member with can_whiteboard = false (AC-3)...');

    permittedStudentSocket = ClientSocket(BASE_URL, {
      auth: { token: permittedStudentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      permittedStudentSocket!.on('connect', () => resolve());
      permittedStudentSocket!.on('connect_error', reject);
    });

    await new Promise<void>((resolve) => {
      permittedStudentSocket!.emit('room:join', { roomId }, () => resolve());
    });

    let hostReceivedTamperedDraw = false;
    let permittedStudentReceivedTamperedDraw = false;

    const hostTamperListener = () => { hostReceivedTamperedDraw = true; };
    const permittedTamperListener = () => { permittedStudentReceivedTamperedDraw = true; };

    hostSocket.on('wb:update', hostTamperListener);
    permittedStudentSocket.on('wb:update', permittedTamperListener);

    const craftedDrawings = [
      { id: 'malicious-shape', type: 'rectangle', x: 999, y: 999, width: 500, height: 500, version: 99 },
    ];

    const forbiddenErrorPromise = new Promise<any>((resolve) => {
      viewOnlyStudentSocket!.once('error', (err: any) => {
        resolve(err);
      });
      viewOnlyStudentSocket!.emit('wb:update', {
        roomId,
        elements: craftedDrawings,
      });
    });

    const forbiddenErr = await forbiddenErrorPromise;
    assert(
      forbiddenErr?.code === 'FORBIDDEN',
      'Attempting whiteboard draw via crafted socket returns error { code: "FORBIDDEN" }',
      JSON.stringify(forbiddenErr)
    );

    // Give time to ensure no message leaked to other sockets
    await new Promise((r) => setTimeout(r, 150));

    assert(
      !hostReceivedTamperedDraw,
      'Host did not receive unauthorized drawing from view-only member'
    );
    assert(
      !permittedStudentReceivedTamperedDraw,
      'Permitted student did not receive unauthorized drawing from view-only member'
    );

    // Verify room board elements remain unaffected
    const storedElements = getWhiteboardElements(roomId);
    assert(
      !storedElements.some((el: any) => el?.id === 'malicious-shape'),
      'Room whiteboard elements remain unaffected by crafted socket event'
    );
    assert(
      storedElements.length === 3,
      'Board element count remains exactly 3 valid elements'
    );

    hostSocket.off('wb:update', hostTamperListener);
    permittedStudentSocket.off('wb:update', permittedTamperListener);

  } catch (error) {
    console.error('Test execution failed with error:', error);
    failedCount++;
  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (viewOnlyStudentSocket) viewOnlyStudentSocket.disconnect();
    if (permittedStudentSocket) permittedStudentSocket.disconnect();

    await new Promise<void>((resolve) => {
      testServer.close(() => {
        console.log('\n[Test Server] Closed');
        resolve();
      });
    });
  }

  console.log('\n============================================================');
  console.log(`Test Summary: ${passedCount} Passed, ${failedCount} Failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
