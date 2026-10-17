/**
 * Automated Verification Script for US-ATT-01: Auto Record Join and Leave
 * Module: Attendance | Priority: P0 | Traces to: FR-6.1
 *
 * Acceptance Criteria Verified:
 * 1. Emitting live:joined creates or reuses an open attendance record with joined_at = now().
 * 2. Emitting live:left or disconnecting starts a 15-second grace timer; if the user does not reconnect, left_at = now() is set.
 * 3. Reconnecting within 15 seconds cancels the timer and reuses the same record.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { clearMockSessions } from '../src/lib/sessions';
import {
  getMockAttendance,
  clearMockAttendance,
  hasActiveGraceTimer,
  setAttendanceGracePeriodMs,
  resetAttendanceGracePeriodMs,
} from '../src/lib/attendance';
import { clearPresence } from '../src/realtime/presence';
import { Me, Session, RoomSummary } from '@linkup/shared';

const TEST_PORT = 3131;
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
  console.log('🚀 Running US-ATT-01: Auto Record Join and Leave Tests');
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
  let studentSocket2: ClientSocketType | null = null;
  let studentTab2Socket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockSessions();
    clearMockAttendance();
    clearPresence();

    const roomId = 'room-att-01-test';
    const hostToken = 'token-host-att-01';
    const studentToken = 'token-student-att-01';

    const hostUser: Me = {
      id: 'user-host-att-01',
      fullName: 'Prof. Attendance Host',
      role: 'teacher',
      email: 'host.att@test.com',
    };

    const studentUser: Me = {
      id: 'user-student-att-01',
      fullName: 'Alice Student',
      role: 'student',
      email: 'alice.student@test.com',
    };

    setCachedUser(hostToken, hostUser);
    setCachedUser(studentToken, studentUser);

    const roomSummary: RoomSummary = {
      id: roomId,
      name: 'Attendance Verification Classroom',
      description: 'Testing US-ATT-01 attendance join and leave logic',
      joinCode: 'ATT001',
      hostName: hostUser.fullName,
      memberCount: 2,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      members: [
        {
          userId: hostUser.id,
          fullName: hostUser.fullName,
          userRole: 'teacher',
          memberRole: 'host',
          permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
          joinedAt: new Date().toISOString(),
        },
        {
          userId: studentUser.id,
          fullName: studentUser.fullName,
          userRole: 'student',
          memberRole: 'participant',
          permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: false, canCode: false },
          joinedAt: new Date().toISOString(),
        },
      ],
    };

    setMockRooms(hostUser.id, [roomSummary]);
    setMockRooms(studentUser.id, [{ ...roomSummary, myRole: 'participant' }]);

    // ── Setup: Host starts live session ──
    console.log('\x1b[34m[Setup]\x1b[0m Host starts a live session in room...\n');
    const startRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });

    const activeSession: Session = await startRes.json();
    assert(startRes.status === 201, 'Host started live session with 201 Created');
    assert(Boolean(activeSession?.id), `Active session initialized (ID: ${activeSession?.id})`);

    // Connect sockets
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: hostToken },
      transports: ['websocket'],
    });

    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) => hostSocket!.on('connect', resolve)),
      new Promise<void>((resolve) => studentSocket!.on('connect', resolve)),
    ]);

    assert(hostSocket.connected && studentSocket.connected, 'Host and student sockets connected to server');

    // Join room channels
    await Promise.all([
      new Promise<void>((resolve) => hostSocket!.emit('room:join', { roomId }, () => resolve())),
      new Promise<void>((resolve) => studentSocket!.emit('room:join', { roomId }, () => resolve())),
    ]);

    // ════════════════════════════════════════════════════════════════
    // CRITERION 1: Emitting live:joined creates or reuses open record
    // ════════════════════════════════════════════════════════════════
    console.log('\n\x1b[34m[Criterion 1]\x1b[0m Emitting live:joined creates or reuses an open attendance record with joined_at = now()...\n');

    const joinBeforeTime = Date.now();
    let ackResult: any = null;
    await new Promise<void>((resolve) => {
      studentSocket!.emit('live:joined', { roomId }, (ack: any) => {
        ackResult = ack;
        resolve();
      });
    });

    assert(ackResult?.ok === true, 'live:joined acknowledged successfully by server');

    const attendanceAfterFirstJoin = getMockAttendance();
    const studentRecords1 = attendanceAfterFirstJoin.filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );

    assert(studentRecords1.length === 1, 'Exactly one attendance record created for student');
    assert(studentRecords1[0]?.leftAt === null, 'Attendance record is open (leftAt is null)');
    assert(Boolean(studentRecords1[0]?.joinedAt), 'Attendance record has joinedAt timestamp');

    const joinedAtTime = new Date(studentRecords1[0]?.joinedAt).getTime();
    assert(
      joinedAtTime >= joinBeforeTime - 1000 && joinedAtTime <= Date.now() + 1000,
      'joined_at timestamp corresponds to current time (now())'
    );

    const firstRecordId = studentRecords1[0]?.id;

    // Test reusing open record: Emitting live:joined a second time
    console.log('  Testing reuse on duplicate live:joined emission...');
    let secondAckResult: any = null;
    await new Promise<void>((resolve) => {
      studentSocket!.emit('live:joined', { roomId }, (ack: any) => {
        secondAckResult = ack;
        resolve();
      });
    });

    assert(secondAckResult?.ok === true, 'Duplicate live:joined acknowledged with ok: true');
    const attendanceAfterDuplicateJoin = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );

    assert(attendanceAfterDuplicateJoin.length === 1, 'Still exactly one attendance record (reused, not duplicated)');
    assert(attendanceAfterDuplicateJoin[0]?.id === firstRecordId, 'Reused open attendance record retains identical ID');
    assert(attendanceAfterDuplicateJoin[0]?.leftAt === null, 'Reused record remains open');

    // ════════════════════════════════════════════════════════════════
    // CRITERION 2: Emitting live:left starts 15s grace timer; if no reconnect, left_at = now()
    // ════════════════════════════════════════════════════════════════
    console.log('\n\x1b[34m[Criterion 2]\x1b[0m Emitting live:left starts grace timer; closes record with left_at = now() on expiry...\n');

    // Use a short grace period (300ms) for fast automated verification
    setAttendanceGracePeriodMs(300);

    // Student emits live:left
    let leaveAck: any = null;
    await new Promise<void>((resolve) => {
      studentSocket!.emit('live:left', { roomId }, (ack: any) => {
        leaveAck = ack;
        resolve();
      });
    });

    assert(leaveAck?.ok === true, 'live:left event acknowledged successfully');

    // Verify 15-second grace timer is running
    const timerRunning = hasActiveGraceTimer(activeSession.id, studentUser.id);
    assert(timerRunning, 'Server started grace timer for student after emitting live:left');

    // Verify record is STILL OPEN during grace period
    const recordsDuringGrace = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );
    assert(recordsDuringGrace[0]?.leftAt === null, 'Attendance record remains open during grace period');

    // Wait for grace period to expire
    console.log('  Waiting 450ms for 300ms grace period to expire...');
    await new Promise((r) => setTimeout(r, 450));

    // Verify grace timer has completed and deleted
    const timerAfterExpiry = hasActiveGraceTimer(activeSession.id, studentUser.id);
    assert(!timerAfterExpiry, 'Grace timer ended after expiry');

    // Verify record is closed with left_at set
    const recordsAfterExpiry = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );
    assert(recordsAfterExpiry.length === 1, 'Record persists in attendance log');
    assert(recordsAfterExpiry[0]?.leftAt !== null, `Record closed with left_at timestamp: ${recordsAfterExpiry[0]?.leftAt}`);

    const leftAtTime = new Date(recordsAfterExpiry[0]?.leftAt!).getTime();
    assert(
      leftAtTime >= joinedAtTime && leftAtTime <= Date.now() + 1000,
      'left_at is set to now() at grace expiration and >= joined_at'
    );

    // ════════════════════════════════════════════════════════════════
    // CRITERION 3: Reconnecting within 15 seconds cancels timer and reuses same record
    // ════════════════════════════════════════════════════════════════
    console.log('\n\x1b[34m[Criterion 3]\x1b[0m Reconnecting within 15 seconds cancels timer and reuses open record...\n');

    // Reset grace period to standard 15 seconds (15000ms)
    resetAttendanceGracePeriodMs();

    // Student rejoins live call: creates a new open record since previous was closed
    await new Promise<void>((resolve) => {
      studentSocket!.emit('live:joined', { roomId }, () => resolve());
    });

    const recordsAfterRejoin = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );
    assert(recordsAfterRejoin.length === 2, 'New open attendance record created for rejoin after previous record closed');
    const secondOpenRecord = recordsAfterRejoin.find((a) => a.leftAt === null);
    assert(Boolean(secondOpenRecord), 'Active open record found for new session join');
    const secondRecordId = secondOpenRecord!.id;

    // Student leaves call: starts 15s grace timer
    await new Promise<void>((resolve) => {
      studentSocket!.emit('live:left', { roomId }, () => resolve());
    });

    assert(hasActiveGraceTimer(activeSession.id, studentUser.id), '15-second grace timer started upon live:left');

    // Student immediately rejoins within grace period (e.g. within 50ms)
    console.log('  Student rejoins within 15s grace period...');
    await new Promise<void>((resolve) => {
      studentSocket!.emit('live:joined', { roomId }, () => resolve());
    });

    // Verify timer was cancelled
    assert(!hasActiveGraceTimer(activeSession.id, studentUser.id), 'Grace timer was cancelled upon reconnect within 15 seconds');

    // Verify record was reused (NOT a third record, still secondRecordId, still open)
    const recordsAfterGraceReconnect = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );
    assert(
      recordsAfterGraceReconnect.length === 2,
      `Exactly 2 records exist (reused open record instead of creating 3rd, found: ${recordsAfterGraceReconnect.length})`
    );
    const activeOpen = recordsAfterGraceReconnect.find((a) => a.leftAt === null);
    assert(activeOpen?.id === secondRecordId, `Reused record has identical ID (${secondRecordId})`);
    assert(activeOpen?.leftAt === null, 'Reused attendance record remains open');

    // ════════════════════════════════════════════════════════════════
    // CRITERION 2B: Disconnecting starts 15-second grace timer; if no reconnect, left_at = now() is set
    // ════════════════════════════════════════════════════════════════
    console.log('\n\x1b[34m[Criterion 2B]\x1b[0m Disconnecting socket starts grace timer; closes record with left_at = now() on expiry...\n');

    setAttendanceGracePeriodMs(300);

    // Simulate abrupt network drop / tab close
    studentSocket!.disconnect();
    console.log('  Student socket abruptly disconnected.');

    // Wait a brief moment for server to process disconnect
    await new Promise((r) => setTimeout(r, 100));

    assert(hasActiveGraceTimer(activeSession.id, studentUser.id), 'Server started grace timer on socket disconnect');

    // Wait for grace period to expire
    console.log('  Waiting 450ms for disconnect grace period to expire...');
    await new Promise((r) => setTimeout(r, 450));

    const recordsAfterDisconnectExpiry = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );
    const closedRecord2 = recordsAfterDisconnectExpiry.find((a) => a.id === secondRecordId);
    assert(closedRecord2?.leftAt !== null, `Attendance record successfully closed with left_at: ${closedRecord2?.leftAt}`);

    // ════════════════════════════════════════════════════════════════
    // CRITERION 3B: Reconnecting after disconnect within 15 seconds cancels timer & reuses record
    // ════════════════════════════════════════════════════════════════
    console.log('\n\x1b[34m[Criterion 3B]\x1b[0m Reconnecting new socket within grace period cancels timer & reuses open record...\n');

    resetAttendanceGracePeriodMs();

    // Reconnect socket and start a fresh join
    studentSocket2 = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => studentSocket2!.on('connect', resolve));
    await new Promise<void>((resolve) => studentSocket2!.emit('room:join', { roomId }, () => resolve()));
    await new Promise<void>((resolve) => studentSocket2!.emit('live:joined', { roomId }, () => resolve()));

    const recordsAfterThirdJoin = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );
    const thirdRecord = recordsAfterThirdJoin.find((a) => a.leftAt === null);
    assert(Boolean(thirdRecord), 'Third open record created after previous 2 were properly closed');
    const thirdRecordId = thirdRecord!.id;

    // Disconnect studentSocket2
    studentSocket2.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    assert(hasActiveGraceTimer(activeSession.id, studentUser.id), 'Grace timer active following socket disconnect');

    // Reconnect with a new socket within 15s grace period
    const studentSocket3 = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });
    await new Promise<void>((resolve) => studentSocket3.on('connect', resolve));
    await new Promise<void>((resolve) => studentSocket3.emit('room:join', { roomId }, () => resolve()));
    await new Promise<void>((resolve) => studentSocket3.emit('live:joined', { roomId }, () => resolve()));

    assert(!hasActiveGraceTimer(activeSession.id, studentUser.id), 'Grace timer cancelled on socket reconnect within 15s');

    const recordsAfterSocketReconnect = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );
    const openAfterReconnect = recordsAfterSocketReconnect.find((a) => a.leftAt === null);
    assert(openAfterReconnect?.id === thirdRecordId, `Reconnected socket reuses third record ID (${thirdRecordId})`);
    assert(openAfterReconnect?.leftAt === null, 'Reused record remains open');

    // ════════════════════════════════════════════════════════════════
    // MULTI-TAB SUPPORT (US-ATT-03): Multiple sockets for same user
    // ════════════════════════════════════════════════════════════════
    console.log('\n\x1b[34m[Multi-Tab]\x1b[0m Multi-tab join reuses record; grace timer starts only when ALL tabs leave...\n');

    // Open second tab socket for student
    studentTab2Socket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });
    await new Promise<void>((resolve) => studentTab2Socket!.on('connect', resolve));
    await new Promise<void>((resolve) => studentTab2Socket!.emit('room:join', { roomId }, () => resolve()));
    await new Promise<void>((resolve) => studentTab2Socket!.emit('live:joined', { roomId }, () => resolve()));

    const recordsMultiTab = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );
    assert(
      recordsMultiTab.filter((a) => a.leftAt === null).length === 1,
      'Opening second tab reuses the single open attendance record (no duplicate record)'
    );

    // Tab 1 leaves live call
    await new Promise<void>((resolve) => {
      studentSocket3.emit('live:left', { roomId }, () => resolve());
    });

    assert(
      !hasActiveGraceTimer(activeSession.id, studentUser.id),
      'Grace timer does NOT start when Tab 1 leaves while Tab 2 is still in live call'
    );

    // Tab 2 leaves live call -> now timer starts
    await new Promise<void>((resolve) => {
      studentTab2Socket!.emit('live:left', { roomId }, () => resolve());
    });

    assert(
      hasActiveGraceTimer(activeSession.id, studentUser.id),
      'Grace timer starts when last remaining tab leaves live call'
    );

    studentSocket3.disconnect();
    studentTab2Socket.disconnect();
  } catch (err: any) {
    console.error('Unexpected test error:', err);
    failedCount++;
  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (studentSocket) studentSocket.disconnect();
    if (studentSocket2) studentSocket2.disconnect();
    if (studentTab2Socket) studentTab2Socket.disconnect();

    testServer.close();
    resetAttendanceGracePeriodMs();

    console.log('\n============================================================');
    console.log(`Summary: \x1b[32m${passedCount} Passed\x1b[0m, \x1b[31m${failedCount} Failed\x1b[0m`);
    console.log('============================================================\n');

    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runTests();
