/**
 * Automated Verification Script for US-CODE-02: Give the Pen to a Student (Host)
 * Module: Code Workspace
 * Priority: P0 | Traces to: FR-5.3
 *
 * Acceptance Criteria Verified:
 * 1. A "Give Pen" dropdown lists all participants with can_code = true; a "Take Back" button is shown when a student holds the pen.
 * 2. Clicking assigns the pen: the server emits code:pen { holderId } to all room members; the student's editor becomes writable; the host's editor becomes read-only.
 * 3. A student without can_code is not listed in the dropdown.
 * 4. Only the host can assign the pen; a participant cannot self-assign.
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
import { clearCodeWorkspace, setPenHolder, getCodeState, getPenHolder } from '../src/realtime/codeWorkspace';
import { Me, RoomSummary, CodeState, Member } from '@linkup/shared';

const TEST_PORT = 3144;
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
  console.log('🚀 Running US-CODE-02: Give the Pen to a Student Automated Tests');
  console.log('   Priority: P0 | Traces to: FR-5.3');
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

  try {
    clearTokenCache();
    clearMockRooms();
    clearPresence();
    clearCodeWorkspace();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: Static / Component Verification of Give Pen dropdown & Take Back button
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Verifying CodeTab contains Give Pen dropdown and Take Back button (AC-1, AC-3)...');
    const codeTabPath = path.resolve(__dirname, '../../client/src/features/rooms/CodeTab.tsx');
    const codeTabSource = fs.readFileSync(codeTabPath, 'utf8');

    assert(
      codeTabSource.includes('id="code-give-pen-select"') && codeTabSource.includes('data-testid="code-give-pen-select"'),
      'Give Pen select dropdown has id="code-give-pen-select" and data-testid="code-give-pen-select"'
    );

    assert(
      codeTabSource.includes('id="code-take-back-btn"') && codeTabSource.includes('data-testid="code-take-back-btn"'),
      'Take Back button has id="code-take-back-btn" and data-testid="code-take-back-btn"'
    );

    assert(
      codeTabSource.includes('eligibleStudents') &&
      codeTabSource.includes('Boolean(m.permissions?.canCode)') &&
      codeTabSource.includes('isHostMember'),
      'CodeTab filters eligibleStudents to exclude host and only include members with can_code = true (AC-3)'
    );

    assert(
      codeTabSource.includes('isUserHost') && codeTabSource.includes('id="code-pen-host-controls"'),
      'Host pen controls (Give Pen & Take Back) are guarded by isUserHost check (AC-4)'
    );

    assert(
      codeTabSource.includes('studentHoldsPen') && codeTabSource.includes('handleTakeBackPen'),
      'Take Back button is shown when a student holds the pen and triggers handleTakeBackPen (AC-1)'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // Setup Mock Data & Rooms for Real-time Verification
    // ─────────────────────────────────────────────────────────────────────────────
    const teacherUser: Me = {
      id: 'teacher-code-02',
      email: 'teacher2@linkup.test',
      fullName: 'Prof. Turing',
      role: 'teacher',
      avatarUrl: null,
      bio: null,
      phone: null,
      organization: 'Linkup Univ',
    };

    const studentPermitted: Me = {
      id: 'student-priya-02',
      email: 'priya2@linkup.test',
      fullName: 'Priya Patel',
      role: 'student',
      avatarUrl: null,
      bio: null,
      phone: null,
      organization: 'Linkup Univ',
    };

    const studentRestricted: Me = {
      id: 'student-rahul-02',
      email: 'rahul2@linkup.test',
      fullName: 'Rahul Verma',
      role: 'student',
      avatarUrl: null,
      bio: null,
      phone: null,
      organization: 'Linkup Univ',
    };

    const teacherToken = 'token-teacher-02';
    const studentPermittedToken = 'token-student-priya-02';
    const studentRestrictedToken = 'token-student-rahul-02';

    setCachedUser(teacherToken, teacherUser);
    setCachedUser(studentPermittedToken, studentPermitted);
    setCachedUser(studentRestrictedToken, studentRestricted);

    const roomId = 'room-code-test-02';
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
        userId: studentPermitted.id,
        fullName: studentPermitted.fullName,
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
      {
        userId: studentRestricted.id,
        fullName: studentRestricted.fullName,
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: false, canCode: false },
        joinedAt: new Date().toISOString(),
      },
    ];

    const hostRoom: RoomSummary = {
      id: roomId,
      name: 'Algorithms Lab',
      description: 'Shared editor pen testing',
      joinCode: 'PEN002',
      hostName: teacherUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      members: roomMembers,
    };

    const studentPermittedRoom: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    const studentRestrictedRoom: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    setMockRooms(teacherUser.id, [hostRoom]);
    setMockRooms(studentPermitted.id, [studentPermittedRoom]);
    setMockRooms(studentRestricted.id, [studentRestrictedRoom]);

    // Connect Sockets
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: teacherToken },
      transports: ['websocket'],
    });

    permittedStudentSocket = ClientSocket(BASE_URL, {
      auth: { token: studentPermittedToken },
      transports: ['websocket'],
    });

    restrictedStudentSocket = ClientSocket(BASE_URL, {
      auth: { token: studentRestrictedToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => {
      let connected = 0;
      const onConn = () => {
        connected++;
        if (connected === 3) resolve();
      };
      hostSocket!.on('connect', onConn);
      permittedStudentSocket!.on('connect', onConn);
      restrictedStudentSocket!.on('connect', onConn);
    });

    // Join room
    await new Promise<void>((resolve) => {
      hostSocket!.emit('room:join', { roomId }, () => resolve());
    });
    await new Promise<void>((resolve) => {
      permittedStudentSocket!.emit('room:join', { roomId }, () => resolve());
    });
    await new Promise<void>((resolve) => {
      restrictedStudentSocket!.emit('room:join', { roomId }, () => resolve());
    });

    // Verify initial holder is host
    assert(getPenHolder(roomId) === teacherUser.id, 'Initial pen holder is room host');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: AC-4 — Only the host can assign the pen; a participant cannot self-assign
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Verifying non-host participant cannot assign or self-assign pen (AC-4)...');

    const participantSelfAssignPromise = new Promise<any>((resolve) => {
      permittedStudentSocket!.once('error', (err) => resolve(err));
      permittedStudentSocket!.emit('code:pen', { roomId, holderId: studentPermitted.id }, (res: any) => {
        if (res?.error) resolve(res.error);
      });
    });

    const participantAssignError = await participantSelfAssignPromise;
    assert(
      participantAssignError?.code === 'HOST_ONLY',
      'Participant self-assign is rejected with error code HOST_ONLY (AC-4)'
    );
    assert(
      getPenHolder(roomId) === teacherUser.id,
      'Pen holder remains teacher after unauthorized participant assignment attempt'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: AC-3 — Target without can_code cannot be assigned the pen
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 3] Verifying host cannot assign pen to a student without can_code = true (AC-3)...');

    const restrictedAssignPromise = new Promise<any>((resolve) => {
      hostSocket!.once('error', (err) => resolve(err));
      hostSocket!.emit('code:pen', { roomId, holderId: studentRestricted.id }, (res: any) => {
        if (res?.error) resolve(res.error);
      });
    });

    const restrictedAssignError = await restrictedAssignPromise;
    assert(
      restrictedAssignError?.code === 'FORBIDDEN',
      'Assigning pen to student without can_code is rejected with FORBIDDEN error (AC-3)'
    );
    assert(
      getPenHolder(roomId) === teacherUser.id,
      'Pen holder remains teacher after failed restricted student assignment'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 4: AC-2 — Host assigns pen to student: server emits code:pen { holderId }
    //                 Student's editor becomes writable, host's editor becomes read-only
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 4] Verifying host assigns pen to permitted student (AC-2)...');

    const hostPenPromise = new Promise<any>((resolve) => hostSocket!.once('code:pen', (d) => resolve(d)));
    const permittedPenPromise = new Promise<any>((resolve) => permittedStudentSocket!.once('code:pen', (d) => resolve(d)));
    const restrictedPenPromise = new Promise<any>((resolve) => restrictedStudentSocket!.once('code:pen', (d) => resolve(d)));

    const assignAckPromise = new Promise<any>((resolve) => {
      hostSocket!.emit('code:pen', { roomId, holderId: studentPermitted.id }, (res: any) => resolve(res));
    });

    const assignAck = await assignAckPromise;
    assert(assignAck?.ok === true, 'Server acknowledges host code:pen assignment');

    const [hostPenEvent, permittedPenEvent, restrictedPenEvent] = await Promise.all([
      hostPenPromise,
      permittedPenPromise,
      restrictedPenPromise,
    ]);

    assert(
      hostPenEvent.holderId === studentPermitted.id,
      'Host receives code:pen broadcast with holderId = studentPermitted.id'
    );
    assert(
      permittedPenEvent.holderId === studentPermitted.id,
      'Permitted student receives code:pen broadcast with holderId = studentPermitted.id'
    );
    assert(
      restrictedPenEvent.holderId === studentPermitted.id,
      'All room members receive code:pen broadcast with holderId'
    );
    assert(
      getPenHolder(roomId) === studentPermitted.id,
      'Server state pen holder updated to studentPermitted.id'
    );

    // Verify student is now writable (can emit code:update)
    const updateFromStudentPromise = new Promise<any>((resolve) => {
      hostSocket!.once('code:state', (d) => resolve(d));
    });

    permittedStudentSocket!.emit('code:update', {
      roomId,
      content: 'def solve(): return 42\n',
      language: 'python',
    });

    const studentUpdateReceived = await updateFromStudentPromise;
    assert(
      studentUpdateReceived.content === 'def solve(): return 42\n',
      'Student editor is writable: student emitted code:update successfully received by host'
    );

    // Verify host is now read-only (code:update from host is dropped with NOT_PEN_HOLDER)
    const hostUpdateAttemptPromise = new Promise<any>((resolve) => {
      hostSocket!.once('error', (err) => resolve(err));
      hostSocket!.emit('code:update', {
        roomId,
        content: '# Host trying to edit while student holds pen',
        language: 'python',
      }, (res: any) => {
        if (res?.error) resolve(res.error);
      });
    });

    const hostUpdateError = await hostUpdateAttemptPromise;
    assert(
      hostUpdateError?.code === 'NOT_PEN_HOLDER',
      "Host's editor is read-only: server dropped host code:update with error NOT_PEN_HOLDER"
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 5: AC-1 & AC-2 — Host clicks "Take Back" button: pen returned to host
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 5] Verifying host takes back pen from student (AC-1)...');

    const hostTakeBackPenPromise = new Promise<any>((resolve) => hostSocket!.once('code:pen', (d) => resolve(d)));
    const studentTakeBackPenPromise = new Promise<any>((resolve) => permittedStudentSocket!.once('code:pen', (d) => resolve(d)));

    const takeBackAckPromise = new Promise<any>((resolve) => {
      // Host takes back pen (assigns to self / empty holderId)
      hostSocket!.emit('code:pen', { roomId, holderId: teacherUser.id }, (res: any) => resolve(res));
    });

    const takeBackAck = await takeBackAckPromise;
    assert(takeBackAck?.ok === true, 'Server acknowledges host take back pen');

    const [hostTakenEvent, studentTakenEvent] = await Promise.all([
      hostTakeBackPenPromise,
      studentTakeBackPenPromise,
    ]);

    assert(
      hostTakenEvent.holderId === teacherUser.id,
      'Host receives code:pen broadcast with holderId = host'
    );
    assert(
      studentTakenEvent.holderId === teacherUser.id,
      'Student receives code:pen broadcast with holderId = host'
    );
    assert(
      getPenHolder(roomId) === teacherUser.id,
      'Server pen holder is restored to host'
    );

    // Host can now edit again
    const hostResumeEditPromise = new Promise<any>((resolve) => {
      permittedStudentSocket!.once('code:state', (d) => resolve(d));
    });

    hostSocket!.emit('code:update', {
      roomId,
      content: '# Teacher resumed editing\n',
      language: 'python',
    });

    const hostResumeReceived = await hostResumeEditPromise;
    assert(
      hostResumeReceived.content === '# Teacher resumed editing\n',
      "Host's editor is writable again: code:update successfully broadcast to student"
    );

    // Student is now read-only again
    const studentSecondUpdateAttempt = new Promise<any>((resolve) => {
      permittedStudentSocket!.once('error', (err) => resolve(err));
      permittedStudentSocket!.emit('code:update', {
        roomId,
        content: 'def student_after_take_back(): pass',
        language: 'python',
      }, (res: any) => {
        if (res?.error) resolve(res.error);
      });
    });

    const studentSecondError = await studentSecondUpdateAttempt;
    assert(
      studentSecondError?.code === 'NOT_PEN_HOLDER',
      "Student editor returned to read-only: server dropped student code:update with NOT_PEN_HOLDER"
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 6: Disconnect Resilience — student disconnect automatically reverts pen to host
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 6] Verifying disconnecting pen-holding student resets pen to host...');

    // Host gives pen back to student
    await new Promise<void>((resolve) => {
      hostSocket!.emit('code:pen', { roomId, holderId: studentPermitted.id }, () => resolve());
    });
    assert(getPenHolder(roomId) === studentPermitted.id, 'Pen assigned to student before disconnect test');

    const hostPenRevertPromise = new Promise<any>((resolve) => {
      hostSocket!.once('code:pen', (d) => resolve(d));
    });

    // Student disconnects
    permittedStudentSocket!.disconnect();

    const revertEvent = await hostPenRevertPromise;
    assert(
      revertEvent.holderId === teacherUser.id,
      'Server automatically restored pen to room host upon pen-holder disconnect'
    );
    assert(
      getPenHolder(roomId) === teacherUser.id,
      'Pen holder in room state is restored to host after disconnect'
    );

  } catch (err: any) {
    console.error('Unexpected error during test execution:', err);
    assert(false, 'Unexpected test failure', err.message);
  } finally {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (permittedStudentSocket?.connected) permittedStudentSocket.disconnect();
    if (restrictedStudentSocket?.connected) restrictedStudentSocket.disconnect();

    await new Promise<void>((resolve) => testServer.close(() => resolve()));
    console.log('[Test Server] Closed');
  }

  console.log('\n============================================================');
  console.log(`Results: ${passedCount} passed, ${failedCount} failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests();
