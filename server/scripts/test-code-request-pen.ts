/**
 * Automated Verification Script for US-CODE-08: Request the Pen (P1)
 * Module: Code Workspace
 * Priority: P1 | Traces to: FR-5.9
 *
 * Acceptance Criteria Verified:
 * 1. A "Request Edit" button is shown in the Code tab for participants with can_code who do not hold the pen.
 * 2. Clicking emits code:request-pen; the server sends code:pen-requested to the host's sockets.
 * 3. The host sees a badge indicating the student's request.
 * 4. Error enforcement: Participants without can_code receive FORBIDDEN.
 * 5. Error enforcement: Current pen holder emitting request-pen receives ALREADY_PEN_HOLDER.
 * 6. Pen grant clears pending request.
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
  clearCodeWorkspace,
  setPenHolder,
  getCodeState,
  getPenHolder,
  codeService,
  getPenRequests,
} from '../src/realtime/codeWorkspace';
import { Me, RoomSummary, Member } from '@linkup/shared';

const TEST_PORT = 3146;
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
  console.log('🚀 Running US-CODE-08: Request the Pen (P1)');
  console.log('   Module: Code Workspace | Traces to: FR-5.9');
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
  let noCodeStudentSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearPresence();
    clearCodeWorkspace();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: Static / Component Verification of US-CODE-08 in CodeTab.tsx & server
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Verifying CodeTab & server implementation for US-CODE-08...');
    const codeTabPath = path.resolve(__dirname, '../../client/src/features/rooms/CodeTab.tsx');
    const codeTabSource = fs.readFileSync(codeTabPath, 'utf8');

    assert(
      codeTabSource.includes('US-CODE-08') && codeTabSource.includes('FR-5.9'),
      'CodeTab references US-CODE-08 and FR-5.9 in documentation header'
    );

    assert(
      codeTabSource.includes('id="code-request-edit-btn"') &&
      codeTabSource.includes('data-testid="code-request-edit-btn"') &&
      codeTabSource.includes('handleRequestPen'),
      'CodeTab includes "Request Edit" button with id="code-request-edit-btn" (AC-1)'
    );

    assert(
      codeTabSource.includes('!isUserHost && userHasCodePermission && !isPenHolder'),
      'CodeTab only shows "Request Edit" for non-host participants with can_code who do not hold pen (AC-1)'
    );

    assert(
      codeTabSource.includes('id="code-pen-request-badge"') &&
      codeTabSource.includes('data-testid="code-pen-request-badge"') &&
      codeTabSource.includes('activePenRequests'),
      'CodeTab includes badge id="code-pen-request-badge" indicating student edit request to host (AC-3)'
    );

    assert(
      codeTabSource.includes("'code:request-pen'") &&
      codeTabSource.includes('handleRequestPen'),
      'CodeTab emits code:request-pen upon clicking Request Edit button (AC-2)'
    );

    const roomPagePath = path.resolve(__dirname, '../../client/src/features/rooms/RoomPage.tsx');
    const roomPageSource = fs.readFileSync(roomPagePath, 'utf8');
    assert(
      roomPageSource.includes('room-tab-code-badge') &&
      roomPageSource.includes('code:pen-requested'),
      'RoomPage includes notification badge indicator on Code tab button when student requests edit (AC-3)'
    );

    const serverIndexPath = path.resolve(__dirname, '../src/index.ts');
    const serverIndexSource = fs.readFileSync(serverIndexPath, 'utf8');

    assert(
      serverIndexSource.includes("socket.on('code:request-pen'") &&
      serverIndexSource.includes('code:pen-requested'),
      'Server handles code:request-pen and emits code:pen-requested to host sockets (AC-2)'
    );

    const codeWorkspacePath = path.resolve(__dirname, '../src/realtime/codeWorkspace.ts');
    const codeWorkspaceSource = fs.readFileSync(codeWorkspacePath, 'utf8');

    assert(
      codeWorkspaceSource.includes('addPenRequest') &&
      codeWorkspaceSource.includes('removePenRequest') &&
      codeWorkspaceSource.includes('getPenRequests'),
      'codeWorkspace exports pen request tracking methods on codeService'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // Setup Mock Data & Rooms for Real-time Verification
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Setup] Initializing mock room and users for real-time tests...');
    const teacherUser: Me = {
      id: 'teacher-code-08',
      email: 'teacher8@linkup.test',
      fullName: 'Prof. Turing',
      role: 'teacher',
    };

    const studentWithCode: Me = {
      id: 'student-ada-08',
      email: 'ada8@linkup.test',
      fullName: 'Ada Lovelace',
      role: 'student',
    };

    const studentWithoutCode: Me = {
      id: 'student-charles-08',
      email: 'charles8@linkup.test',
      fullName: 'Charles Babbage',
      role: 'student',
    };

    const teacherToken = 'token-teacher-08';
    const adaToken = 'token-ada-08';
    const charlesToken = 'token-charles-08';

    setCachedUser(teacherToken, teacherUser);
    setCachedUser(adaToken, studentWithCode);
    setCachedUser(charlesToken, studentWithoutCode);

    const roomId = 'room-code-test-08';
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
        userId: studentWithCode.id,
        fullName: studentWithCode.fullName,
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
      {
        userId: studentWithoutCode.id,
        fullName: studentWithoutCode.fullName,
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: false },
        joinedAt: new Date().toISOString(),
      },
    ];

    const hostRoom: RoomSummary = {
      id: roomId,
      name: 'Algorithm Design Lab',
      description: 'US-CODE-08 automated test room',
      joinCode: 'PEN008',
      hostName: teacherUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      members: roomMembers,
    };

    const studentRoomAda: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    const studentRoomCharles: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    setMockRooms(teacherUser.id, [hostRoom]);
    setMockRooms(studentWithCode.id, [studentRoomAda]);
    setMockRooms(studentWithoutCode.id, [studentRoomCharles]);

    // Connect Sockets
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: teacherToken },
      transports: ['websocket'],
    });

    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: adaToken },
      transports: ['websocket'],
    });

    noCodeStudentSocket = ClientSocket(BASE_URL, {
      auth: { token: charlesToken },
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
      noCodeStudentSocket!.on('connect', onConn);
    });

    await new Promise<void>((resolve) => {
      let joined = 0;
      const onJoined = () => {
        joined++;
        if (joined === 3) resolve();
      };
      hostSocket!.emit('room:join', { roomId }, onJoined);
      studentSocket!.emit('room:join', { roomId }, onJoined);
      noCodeStudentSocket!.emit('room:join', { roomId }, onJoined);
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: Student with can_code emits code:request-pen -> Host receives code:pen-requested
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Student with can_code requests edit pen...');

    const penRequestedPromise = new Promise<{ roomId: string; userId: string; userName?: string }>((resolve) => {
      hostSocket!.once('code:pen-requested', (payload) => {
        resolve(payload);
      });
    });

    const studentAck = await new Promise<any>((resolve) => {
      studentSocket!.emit('code:request-pen', { roomId }, (res: any) => {
        resolve(res);
      });
    });

    assert(studentAck?.ok === true, 'studentSocket receives ok: true acknowledgement from code:request-pen');

    const receivedPayload = await penRequestedPromise;
    assert(
      receivedPayload.roomId === roomId && receivedPayload.userId === studentWithCode.id,
      `Host socket received code:pen-requested with matching roomId and userId (${receivedPayload.userId}) (AC-2)`
    );

    assert(
      receivedPayload.userName === studentWithCode.fullName,
      `Payload includes student's fullName (${receivedPayload.userName}) for host badge display`
    );

    const pendingRequests = getPenRequests(roomId);
    assert(
      pendingRequests.includes(studentWithCode.id),
      'Server-side codeService tracks student in getPenRequests list'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: Student without can_code cannot request pen (FORBIDDEN)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 3] Verifying permission enforcement: student without can_code rejected...');

    const forbiddenAck = await new Promise<any>((resolve) => {
      noCodeStudentSocket!.emit('code:request-pen', { roomId }, (res: any) => {
        resolve(res);
      });
    });

    assert(
      forbiddenAck?.ok === false && forbiddenAck?.error?.code === 'FORBIDDEN',
      'Student without can_code receives error code FORBIDDEN from server'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 4: Existing pen holder cannot request pen (ALREADY_PEN_HOLDER)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 4] Verifying current pen holder cannot request pen...');

    // Host currently holds the pen
    const hostRequestAck = await new Promise<any>((resolve) => {
      hostSocket!.emit('code:request-pen', { roomId }, (res: any) => {
        resolve(res);
      });
    });

    assert(
      hostRequestAck?.ok === false && hostRequestAck?.error?.code === 'ALREADY_PEN_HOLDER',
      'Pen holder attempting to request pen receives ALREADY_PEN_HOLDER'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 5: Missing or invalid roomId returns VALIDATION error
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 5] Verifying validation error on missing roomId...');

    const validationAck = await new Promise<any>((resolve) => {
      studentSocket!.emit('code:request-pen', {}, (res: any) => {
        resolve(res);
      });
    });

    assert(
      validationAck?.ok === false && validationAck?.error?.code === 'VALIDATION',
      'Payload without roomId returns VALIDATION error'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 6: Host grants pen to student -> Request is cleared
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 6] Host assigns pen to student Ada Lovelace -> request cleared...');

    const penAssignedPromise = new Promise<{ roomId: string; holderId: string }>((resolve) => {
      studentSocket!.once('code:pen', (payload) => {
        resolve(payload);
      });
    });

    const grantAck = await new Promise<any>((resolve) => {
      hostSocket!.emit('code:pen', { roomId, holderId: studentWithCode.id }, (res: any) => {
        resolve(res);
      });
    });

    assert(grantAck?.ok === true, 'Host successfully assigned pen to student Ada Lovelace');

    const penEvent = await penAssignedPromise;
    assert(
      penEvent.holderId === studentWithCode.id,
      'code:pen event received with Ada Lovelace as new pen holder'
    );

    const remainingRequests = getPenRequests(roomId);
    assert(
      !remainingRequests.includes(studentWithCode.id),
      'Student request is cleared from getPenRequests upon receiving pen'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 7: Ada Lovelace (now pen holder) gets ALREADY_PEN_HOLDER
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 7] Verifying Ada Lovelace (new pen holder) cannot request pen...');

    const adaNowHolderAck = await new Promise<any>((resolve) => {
      studentSocket!.emit('code:request-pen', { roomId }, (res: any) => {
        resolve(res);
      });
    });

    assert(
      adaNowHolderAck?.ok === false && adaNowHolderAck?.error?.code === 'ALREADY_PEN_HOLDER',
      'Ada Lovelace as active pen holder receives ALREADY_PEN_HOLDER'
    );

  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (studentSocket) studentSocket.disconnect();
    if (noCodeStudentSocket) noCodeStudentSocket.disconnect();

    await new Promise<void>((resolve) => {
      testServer.close(() => resolve());
    });
  }

  console.log('\n============================================================');
  console.log(`📊 Test Results: \x1b[32m${passedCount} Passed\x1b[0m, \x1b[31m${failedCount} Failed\x1b[0m`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
