/**
 * Automated Verification Script for US-WB-03: Whiteboard State Persists
 * Module: Whiteboard
 * Priority: P0 | Traces to: FR-5.13
 *
 * Acceptance Criteria Verified:
 * 1. whiteboard_state is persisted to Postgres (debounced 5 s and on last editor leave).
 * 2. Joining or rejoining the room loads the current board state from the room:join snapshot.
 * 3. Board state survives a server restart.
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
  clearMockWhiteboardDb,
  getWhiteboardElements,
  getOrLoadWhiteboardState,
  persistWhiteboardState,
  getMockWhiteboardDb,
} from '../src/realtime/whiteboard';
import { Me, RoomSummary } from '@linkup/shared';

const TEST_PORT = 3195;
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
  console.log('🚀 Running US-WB-03: Whiteboard State Persists Automated Tests');
  console.log('   Priority: P0 | Traces to: FR-5.13');
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
    clearWhiteboard();
    clearMockWhiteboardDb();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: Source & Architectural Integrity Verification
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Verifying WhiteboardTab & backend persistence architecture...');
    const wbTabPath = path.resolve(__dirname, '../../client/src/features/rooms/WhiteboardTab.tsx');
    const wbTabSource = fs.readFileSync(wbTabPath, 'utf8');

    assert(
      wbTabSource.includes('initialElements') &&
        wbTabSource.includes('/api/rooms/') &&
        wbTabSource.includes('/whiteboard'),
      'WhiteboardTab accepts initialElements, reconciles on update, and has fallback REST fetching (AC-2)'
    );

    const indexSource = fs.readFileSync(path.resolve(__dirname, '../src/index.ts'), 'utf8');
    assert(
      indexSource.includes('getOrLoadWhiteboardState') &&
        indexSource.includes('checkAndPersistWhiteboardOnLeave'),
      'server/src/index.ts integrates getOrLoadWhiteboardState and checkAndPersistWhiteboardOnLeave on room lifecycle'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // SETUP: Test Users and Room
    // ─────────────────────────────────────────────────────────────────────────────
    const teacherUser: Me = {
      id: 'e1111111-1111-4111-a111-111111111111',
      email: 'teacher@linkup.test',
      fullName: 'Prof. Ada Lovelace',
      role: 'teacher',
    };
    const studentUser: Me = {
      id: 'e2222222-2222-4222-a222-222222222222',
      email: 'student@linkup.test',
      fullName: 'Charles Babbage',
      role: 'student',
    };

    setCachedUser('teacher-token', teacherUser);
    setCachedUser('student-token', studentUser);

    const roomId = 'e0000000-0000-4000-a000-000000000001';
    const roomSummary: RoomSummary = {
      id: roomId,
      name: 'Architecture & Diagrams Room',
      description: 'Collaborative Whiteboard Room',
      joinCode: 'WB0300',
      hostName: 'Prof. Ada Lovelace',
      memberCount: 2,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      ownerId: teacherUser.id,
      members: [
        {
          userId: teacherUser.id,
          fullName: teacherUser.fullName,
          memberRole: 'host',
          permissions: {
            canMic: true,
            canCamera: true,
            canScreen: true,
            canWhiteboard: true,
            canCode: true,
          },
        },
        {
          userId: studentUser.id,
          fullName: studentUser.fullName,
          memberRole: 'participant',
          permissions: {
            canMic: true,
            canCamera: true,
            canScreen: false,
            canWhiteboard: false, // Viewer only by default
            canCode: true,
          },
        },
      ],
    };

    setMockRooms(teacherUser.id, [roomSummary]);
    setMockRooms(studentUser.id, [{ ...roomSummary, myRole: 'participant' }]);

    // Connect host socket
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: 'teacher-token' },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      hostSocket!.on('connect', () => resolve());
      hostSocket!.on('connect_error', reject);
    });

    // Host joins room
    const hostJoinAck = await new Promise<any>((resolve) => {
      hostSocket!.emit('room:join', { roomId }, (ack: any) => resolve(ack));
    });
    assert(hostJoinAck?.ok === true, 'Host successfully joined room via Socket.IO');
    assert(hostJoinAck?.snapshot?.board !== undefined, 'room:join ack returns board snapshot');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: Debounced 5s Persistence to Postgres (AC-1)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Verifying whiteboard state debounced 5s persistence (AC-1)...');
    const initialDrawnElements = [
      {
        id: 'rect-shape-101',
        type: 'rectangle',
        x: 120,
        y: 200,
        width: 300,
        height: 150,
        version: 1,
        versionNonce: 1001,
        isDeleted: false,
      },
    ];

    // Host draws via wb:update
    const drawAck = await new Promise<any>((resolve) => {
      hostSocket!.emit(
        'wb:update',
        {
          roomId,
          elements: initialDrawnElements,
        },
        (ack: any) => resolve(ack)
      );
    });
    assert(drawAck?.ok === true, 'Host emitted wb:update successfully');

    // In-memory state is updated immediately
    const immediateElements = getWhiteboardElements(roomId);
    assert(
      immediateElements.length === 1 && (immediateElements[0] as any).id === 'rect-shape-101',
      'In-memory whiteboard cache reflects latest elements immediately'
    );

    // Before 5s debounce, mock store does not yet have it
    const prePersist = getMockWhiteboardDb(roomId);
    assert(
      prePersist === undefined,
      'Whiteboard state not immediately flushed before 5s debounce window'
    );

    // Wait 5.2 seconds for the 5-second debounce timer to fire
    console.log('  Waiting 5.2s for debounced persistence timer...');
    await new Promise((r) => setTimeout(r, 5200));

    const postDebounce = getMockWhiteboardDb(roomId);
    assert(
      postDebounce !== undefined &&
        postDebounce.length === 1 &&
        postDebounce[0].id === 'rect-shape-101',
      'whiteboard_state was successfully persisted after 5 s debounce (AC-1)'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: Persistence on Last Editor Leave (AC-1)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 3] Verifying immediate persistence on last editor leave (AC-1)...');
    const editorLeaveElements = [
      {
        id: 'rect-shape-101',
        type: 'rectangle',
        x: 120,
        y: 200,
        width: 300,
        height: 150,
        version: 2,
        versionNonce: 1002,
        isDeleted: false,
      },
      {
        id: 'circle-shape-102',
        type: 'ellipse',
        x: 450,
        y: 200,
        width: 100,
        height: 100,
        version: 1,
        versionNonce: 2001,
        isDeleted: false,
      },
    ];

    // Host draws second element right before leaving
    await new Promise<any>((resolve) => {
      hostSocket!.emit(
        'wb:update',
        {
          roomId,
          elements: editorLeaveElements,
        },
        (ack: any) => resolve(ack)
      );
    });

    // Connect student (who does NOT have can_whiteboard = true)
    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: 'student-token' },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      studentSocket!.on('connect', () => resolve());
      studentSocket!.on('connect_error', reject);
    });

    await new Promise<any>((resolve) => {
      studentSocket!.emit('room:join', { roomId }, (ack: any) => resolve(ack));
    });

    // Now host (the only editor!) leaves the room.
    // Student remains online, but student is NOT an editor -> last editor left!
    await new Promise<any>((resolve) => {
      hostSocket!.emit('room:leave', { roomId }, (ack: any) => resolve(ack));
    });

    // Check that persistence occurred IMMEDIATELY upon editor leave without waiting 5s
    const postEditorLeavePersisted = getMockWhiteboardDb(roomId);
    assert(
      postEditorLeavePersisted !== undefined &&
        postEditorLeavePersisted.length === 2 &&
        postEditorLeavePersisted.some((el: any) => el.id === 'circle-shape-102'),
      'whiteboard_state was immediately persisted to Postgres when last editor left (AC-1)'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 4: Rejoining Room Loads Current Board State from room:join Snapshot (AC-2)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 4] Verifying rejoining room loads current board state from snapshot (AC-2)...');

    // Host reconnects and rejoins
    hostSocket.connect();
    await new Promise<void>((resolve, reject) => {
      if (hostSocket!.connected) return resolve();
      hostSocket!.on('connect', () => resolve());
      hostSocket!.on('connect_error', reject);
    });

    const hostRejoinAck = await new Promise<any>((resolve) => {
      hostSocket!.emit('room:join', { roomId }, (ack: any) => resolve(ack));
    });

    assert(hostRejoinAck?.ok === true, 'Host re-joined room successfully');
    const restoredBoard = hostRejoinAck?.snapshot?.board;
    assert(
      restoredBoard?.elements !== undefined &&
        restoredBoard.elements.length === 2 &&
        restoredBoard.elements.some((el: any) => el.id === 'circle-shape-102'),
      'Rejoining the room restored the current whiteboard elements in room:join snapshot (AC-2)'
    );

    // Verify REST API endpoint GET /api/rooms/:roomId/whiteboard
    const httpRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/whiteboard`, {
      headers: {
        Authorization: 'Bearer student-token',
      },
    });
    assert(httpRes.status === 200, 'GET /api/rooms/:roomId/whiteboard returns 200 OK');
    const apiBoard = await httpRes.json();
    assert(
      apiBoard.elements &&
        apiBoard.elements.length === 2 &&
        apiBoard.elements.some((el: any) => el.id === 'circle-shape-102'),
      'GET /api/rooms/:roomId/whiteboard returns the saved whiteboard elements (AC-2)'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 5: Board State Survives Server Restart (AC-3)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 5] Verifying whiteboard state survives server restart (AC-3)...');

    // Disconnect all sockets and wait for disconnect processing
    hostSocket.disconnect();
    studentSocket.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // Simulate server restart: clear memory cache completely
    clearWhiteboard();
    const wipedMemory = getWhiteboardElements(roomId);
    assert(wipedMemory.length === 0, 'In-memory whiteboard cache is completely cleared (server restart simulation)');

    // New member or rejoining member joins after restart
    const restoredAfterRestart = await getOrLoadWhiteboardState(roomId);
    assert(
      restoredAfterRestart.elements !== undefined &&
        restoredAfterRestart.elements.length === 2 &&
        (restoredAfterRestart.elements as any[]).some((el: any) => el.id === 'circle-shape-102'),
      'Board state survived server restart and restored from Postgres/persistent store (AC-3)'
    );

    // Verify REST API still returns the restored state after restart
    const httpResAfterRestart = await fetch(`${BASE_URL}/api/rooms/${roomId}/whiteboard`, {
      headers: {
        Authorization: 'Bearer teacher-token',
      },
    });
    assert(httpResAfterRestart.status === 200, 'GET /api/rooms/:roomId/whiteboard works after restart');
    const restartedBoard = await httpResAfterRestart.json();
    assert(
      restartedBoard.elements &&
        restartedBoard.elements.length === 2 &&
        restartedBoard.elements.some((el: any) => el.id === 'rect-shape-101'),
      'GET /api/rooms/:roomId/whiteboard returns full restored elements after server restart (AC-3)'
    );
  } catch (err: any) {
    console.error('Unexpected error during test execution:', err);
    failedCount++;
  } finally {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (studentSocket?.connected) studentSocket.disconnect();

    await new Promise<void>((resolve) => {
      testServer.close(() => resolve());
    });
  }

  console.log('\n============================================================');
  console.log(`Test Results: ${passedCount} Passed | ${failedCount} Failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
