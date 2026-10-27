/**
 * Automated Verification Script for US-WB-05: Clear Board (Host)
 * Module: Whiteboard
 * Priority: P1 | Traces to: FR-5.14
 *
 * Acceptance Criteria:
 * 1. A "Clear Board" button is visible to the host only.
 * 2. Clicking shows a confirmation dialog.
 * 3. On confirm, the server emits wb:cleared to the room; all clients reset the canvas to empty.
 * 4. The cleared state is persisted.
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
  setWhiteboardElements,
  getWhiteboardElements,
  getOrLoadWhiteboardState,
  getMockWhiteboardDb,
  clearAndPersistWhiteboard,
} from '../src/realtime/whiteboard';
import { Me, RoomSummary, Member } from '@linkup/shared';

const TEST_PORT = 3198;
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
  console.log('🚀 Running US-WB-05: Clear Board (Host) Automated Tests');
  console.log('   Priority: P1 | Traces to: FR-5.14');
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
    console.log('[Test 1] Verifying WhiteboardTab architecture for US-WB-05...');
    const whiteboardTabPath = path.resolve(__dirname, '../../client/src/features/rooms/WhiteboardTab.tsx');
    const whiteboardSource = fs.readFileSync(whiteboardTabPath, 'utf8');

    assert(
      whiteboardSource.includes('whiteboard-clear-board') && whiteboardSource.includes('{isHost &&'),
      'AC-1: "Clear Board" button is conditionally rendered for the host only'
    );

    assert(
      whiteboardSource.includes('showClearConfirm') &&
      whiteboardSource.includes('clear-board-modal') &&
      whiteboardSource.includes('confirm-clear-board-btn') &&
      whiteboardSource.includes('cancel-clear-board-btn'),
      'AC-2: Clicking shows a confirmation modal dialog with confirm and cancel buttons'
    );

    assert(
      whiteboardSource.includes("socket.emit('wb:clear'") || whiteboardSource.includes('wb:clear'),
      'AC-3: Confirming in the dialog emits wb:clear to the server'
    );

    assert(
      whiteboardSource.includes("socket.on('wb:cleared'") || whiteboardSource.includes('handleWbCleared'),
      'AC-3: WhiteboardTab listens to wb:cleared to reset the canvas on all clients'
    );

    assert(
      whiteboardSource.includes('updateScene({ elements: [] })') || whiteboardSource.includes('resetScene'),
      'AC-3: Resetting canvas clears scene elements to empty array'
    );

    console.log('\n[Test 1.1] Verifying Server index.ts and whiteboard.ts architecture for US-WB-05...');
    const serverIndexPath = path.resolve(__dirname, '../src/index.ts');
    const serverIndexSource = fs.readFileSync(serverIndexPath, 'utf8');

    assert(
      serverIndexSource.includes("socket.on('wb:clear'"),
      'AC-3: Server registers wb:clear socket event listener'
    );

    assert(
      serverIndexSource.includes("emit('wb:cleared'"),
      'AC-3: Server emits wb:cleared to the room upon authorized clear'
    );

    assert(
      serverIndexSource.includes('clearAndPersistWhiteboard'),
      'AC-4: Server integrates clearAndPersistWhiteboard to persist cleared empty state'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: Multi-Client Connection and Initial Board Setup
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Connecting Host and Students to room with existing drawing...');
    const roomId = 'room-wb-05-clear-test';

    const hostUser: Me = {
      id: 'host-user-1',
      fullName: 'Host Teacher',
      email: 'host@test.com',
      role: 'teacher',
    };
    const student1: Me = {
      id: 'student-user-1',
      fullName: 'Student One (Permitted)',
      email: 'student1@test.com',
      role: 'student',
    };
    const student2: Me = {
      id: 'student-user-2',
      fullName: 'Student Two (View-Only)',
      email: 'student2@test.com',
      role: 'student',
    };

    setCachedUser('host-token', hostUser);
    setCachedUser('student1-token', student1);
    setCachedUser('student2-token', student2);

    const members: Member[] = [
      {
        userId: hostUser.id,
        fullName: hostUser.fullName,
        userRole: 'teacher',
        memberRole: 'host',
        joinedAt: new Date().toISOString(),
        permissions: {
          canMic: true,
          canCamera: true,
          canScreen: true,
          canWhiteboard: true,
          canCode: true,
        },
      },
      {
        userId: student1.id,
        fullName: student1.fullName,
        userRole: 'student',
        memberRole: 'participant',
        joinedAt: new Date().toISOString(),
        permissions: {
          canMic: true,
          canCamera: true,
          canScreen: false,
          canWhiteboard: true,
          canCode: false,
        },
      },
      {
        userId: student2.id,
        fullName: student2.fullName,
        userRole: 'student',
        memberRole: 'participant',
        joinedAt: new Date().toISOString(),
        permissions: {
          canMic: true,
          canCamera: true,
          canScreen: false,
          canWhiteboard: false,
          canCode: false,
        },
      },
    ];

    const mockRoom: RoomSummary = {
      id: roomId,
      name: 'Whiteboard Clear Test Room',
      description: 'US-WB-05 Clear Board Room',
      joinCode: 'WB1234',
      hostName: hostUser.fullName,
      myRole: 'host',
      memberCount: 3,
      createdAt: new Date().toISOString(),
      activeSessionId: null,
      members,
    };

    setMockRooms(hostUser.id, [{ ...mockRoom, myRole: 'host' }]);
    setMockRooms(student1.id, [{ ...mockRoom, myRole: 'participant' }]);
    setMockRooms(student2.id, [{ ...mockRoom, myRole: 'participant' }]);

    // Populate initial drawing elements on the whiteboard
    const initialElements = [
      {
        id: 'shape-1',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 150,
        height: 80,
        version: 1,
        versionNonce: 1111,
      },
      {
        id: 'shape-2',
        type: 'ellipse',
        x: 300,
        y: 200,
        width: 120,
        height: 120,
        version: 1,
        versionNonce: 2222,
      },
    ];
    setWhiteboardElements(roomId, initialElements);

    // Connect Host socket
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: 'host-token' },
      transports: ['websocket'],
    });

    // Connect Student 1 socket
    student1Socket = ClientSocket(BASE_URL, {
      auth: { token: 'student1-token' },
      transports: ['websocket'],
    });

    // Connect Student 2 socket
    student2Socket = ClientSocket(BASE_URL, {
      auth: { token: 'student2-token' },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) => hostSocket!.on('connect', () => resolve())),
      new Promise<void>((resolve) => student1Socket!.on('connect', () => resolve())),
      new Promise<void>((resolve) => student2Socket!.on('connect', () => resolve())),
    ]);

    assert(hostSocket.connected && student1Socket.connected && student2Socket.connected, 'All 3 client sockets connected');

    // Join all sockets to room
    const hostJoinAck: any = await new Promise((resolve) =>
      hostSocket!.emit('room:join', { roomId }, (ack: any) => resolve(ack))
    );
    const student1JoinAck: any = await new Promise((resolve) =>
      student1Socket!.emit('room:join', { roomId }, (ack: any) => resolve(ack))
    );
    const student2JoinAck: any = await new Promise((resolve) =>
      student2Socket!.emit('room:join', { roomId }, (ack: any) => resolve(ack))
    );

    assert(hostJoinAck?.ok === true && student1JoinAck?.ok === true && student2JoinAck?.ok === true, 'All sockets joined room');

    // Verify snapshot has elements
    const currentMemory = getWhiteboardElements(roomId);
    assert(currentMemory.length === 2, 'Initial whiteboard elements loaded in room cache (2 elements)');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: Unauthorized Attempt to Clear Board by Student (Server Rejection)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 3] Verifying server rejects wb:clear from non-host student (AC-1 Authorization Boundary)...');

    let leakedWbCleared = false;
    const leakListener = () => {
      leakedWbCleared = true;
    };
    hostSocket.on('wb:cleared', leakListener);
    student2Socket.on('wb:cleared', leakListener);

    const unauthorizedErrorPromise = new Promise<any>((resolve) => {
      student1Socket!.once('error', (err) => resolve(err));
    });

    // Student 1 attempts to emit wb:clear
    student1Socket.emit('wb:clear', { roomId });

    const unauthorizedErr = await unauthorizedErrorPromise;
    assert(
      unauthorizedErr.code === 'FORBIDDEN' || unauthorizedErr.code === 'HOST_ONLY',
      'Server dropped unauthorized wb:clear from student and returned error FORBIDDEN',
      unauthorizedErr.code
    );

    // Allow time for any leak
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert(!leakedWbCleared, 'No clients received wb:cleared from unauthorized attempt');

    hostSocket.off('wb:cleared', leakListener);
    student2Socket.off('wb:cleared', leakListener);

    // Board elements should still exist untouched
    const afterFailedClear = getWhiteboardElements(roomId);
    assert(afterFailedClear.length === 2, 'Whiteboard elements remain untouched after rejected clear');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 4: Host Clears Whiteboard -> Server Emits wb:cleared to Room (AC-3)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 4] Verifying Host emits wb:clear -> Server broadcasts wb:cleared to room (AC-3)...');

    const hostClearedPromise = new Promise<any>((resolve) => {
      hostSocket!.once('wb:cleared', (data) => resolve(data));
    });
    const student1ClearedPromise = new Promise<any>((resolve) => {
      student1Socket!.once('wb:cleared', (data) => resolve(data));
    });
    const student2ClearedPromise = new Promise<any>((resolve) => {
      student2Socket!.once('wb:cleared', (data) => resolve(data));
    });

    // Host emits wb:clear
    hostSocket.emit('wb:clear', { roomId });

    const [hostClearedData, student1ClearedData, student2ClearedData] = await Promise.all([
      hostClearedPromise,
      student1ClearedPromise,
      student2ClearedPromise,
    ]);

    assert(
      hostClearedData?.roomId === roomId,
      'AC-3: Host socket received wb:cleared event with matching roomId'
    );
    assert(
      student1ClearedData?.roomId === roomId,
      'AC-3: Permitted student received wb:cleared event with matching roomId'
    );
    assert(
      student2ClearedData?.roomId === roomId,
      'AC-3: View-only student received wb:cleared event with matching roomId'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 5: Cleared State is Persisted (AC-4)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 5] Verifying cleared state is persisted (AC-4)...');

    // Synchronous memory cache should be empty
    const memoryAfterClear = getWhiteboardElements(roomId);
    assert(
      Array.isArray(memoryAfterClear) && memoryAfterClear.length === 0,
      'AC-4: In-memory board cache reset to empty array []'
    );

    // Asynchronous loader (state check) should return empty elements
    const loadedState = await getOrLoadWhiteboardState(roomId);
    assert(
      Array.isArray(loadedState.elements) && loadedState.elements.length === 0,
      'AC-4: getOrLoadWhiteboardState returns empty elements []'
    );

    // Mock DB entry should be persisted as empty []
    const mockDbElements = getMockWhiteboardDb(roomId);
    assert(
      Array.isArray(mockDbElements) && mockDbElements.length === 0,
      'AC-4: Mock DB store persisted with empty elements []'
    );

    // Verify REST API endpoint GET /api/rooms/:roomId/whiteboard returns empty board
    const restResponse = await fetch(`${BASE_URL}/api/rooms/${roomId}/whiteboard`, {
      headers: {
        Authorization: 'Bearer host-token',
      },
    });
    const restData: any = await restResponse.json();
    assert(
      restResponse.status === 200 && Array.isArray(restData.elements) && restData.elements.length === 0,
      'AC-4: GET /api/rooms/:roomId/whiteboard returns 200 with empty elements []'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 6: Fresh Diagram Creation & Subsequent Draws Work Post-Clear
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 6] Verifying users can start a fresh diagram on the cleared board...');

    const freshElement = {
      id: 'fresh-diagram-rect-1',
      type: 'rectangle',
      x: 250,
      y: 250,
      width: 200,
      height: 100,
      version: 1,
      versionNonce: 3333,
    };

    const studentReceivedFreshPromise = new Promise<any>((resolve) => {
      student1Socket!.once('wb:update', (data) => resolve(data));
    });

    // Host starts fresh diagram
    hostSocket.emit('wb:update', {
      roomId,
      elements: [freshElement],
    });

    const receivedFreshUpdate = await studentReceivedFreshPromise;
    assert(
      receivedFreshUpdate?.elements?.length === 1 && receivedFreshUpdate.elements[0].id === 'fresh-diagram-rect-1',
      'Participants receive fresh diagram elements via wb:update after board clear'
    );

    const memoryPostFresh = getWhiteboardElements(roomId);
    assert(
      memoryPostFresh.length === 1 && (memoryPostFresh[0] as any).id === 'fresh-diagram-rect-1',
      'Whiteboard memory cache correctly stores the new fresh diagram'
    );

    // Re-verify clearAndPersistWhiteboard directly
    await clearAndPersistWhiteboard(roomId);
    assert(getWhiteboardElements(roomId).length === 0, 'clearAndPersistWhiteboard cleanly resets canvas state');

    console.log('\n============================================================');
    console.log(`Test Results: ${passedCount} Passed, ${failedCount} Failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (student1Socket) student1Socket.disconnect();
    if (student2Socket) student2Socket.disconnect();

    testServer.close();
  }
}

runTests();
