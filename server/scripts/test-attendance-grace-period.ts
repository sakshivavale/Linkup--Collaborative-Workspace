/**
 * Automated Verification Script for US-ATT-02: Reconnect Grace Period
 * Module: Attendance | Priority: P0 | Traces to: FR-6.2
 *
 * Acceptance Criteria Verified:
 * 1. A disconnect and reconnect within 15 seconds reuses the single open attendance record.
 * 2. A disconnect longer than 15 seconds closes the record and creates a new one on reconnect.
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

const TEST_PORT = 3132;
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
  console.log('🚀 Running US-ATT-02: Reconnect Grace Period Tests');
  console.log('   Module: Attendance | Priority: P0 | Traces to: FR-6.2');
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
  let reconnectedSocket1: ClientSocketType | null = null;
  let reconnectedSocket2: ClientSocketType | null = null;
  let reconnectedSocket3: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockSessions();
    clearMockAttendance();
    clearPresence();

    const roomId = 'room-att-02-grace-test';
    const hostToken = 'token-host-att-02';
    const studentToken = 'token-student-att-02';

    const hostUser: Me = {
      id: 'user-host-att-02',
      fullName: 'Dr. Grace Tracker',
      role: 'teacher',
      email: 'grace.host@test.com',
    };

    const studentUser: Me = {
      id: 'user-student-att-02',
      fullName: 'Bob Reconnect',
      role: 'student',
      email: 'bob.student@test.com',
    };

    setCachedUser(hostToken, hostUser);
    setCachedUser(studentToken, studentUser);

    const roomSummary: RoomSummary = {
      id: roomId,
      name: 'Attendance Grace Period Lab',
      description: 'Testing US-ATT-02 Reconnect Grace Period Logic',
      joinCode: 'ATT002',
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

    // Connect host & student sockets
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

    await Promise.all([
      new Promise<void>((resolve) => hostSocket!.emit('room:join', { roomId }, () => resolve())),
      new Promise<void>((resolve) => studentSocket!.emit('room:join', { roomId }, () => resolve())),
    ]);

    // Student enters live call
    await new Promise<void>((resolve) => {
      studentSocket!.emit('live:joined', { roomId }, () => resolve());
    });

    const initialAttendance = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );
    assert(initialAttendance.length === 1, 'Initial attendance record created on live:joined');
    assert(initialAttendance[0]?.leftAt === null, 'Initial attendance record is open (leftAt: null)');
    const initialRecordId = initialAttendance[0]?.id;
    const initialJoinedAt = initialAttendance[0]?.joinedAt;

    // ════════════════════════════════════════════════════════════════
    // ACCEPTANCE CRITERION 1:
    // A disconnect and reconnect within 15 seconds reuses the single open attendance record
    // ════════════════════════════════════════════════════════════════
    console.log('\n\x1b[34m[Acceptance Criterion 1]\x1b[0m Disconnect and reconnect within 15 seconds reuses open record...\n');

    // Configure standard 15-second grace period
    resetAttendanceGracePeriodMs();

    // 1.1 Simulate sudden network drop: Student socket disconnects
    console.log('  1.1 Simulating sudden network drop: student socket disconnects...');
    studentSocket.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // Verify 15s grace timer is active
    const timerActiveAfterDrop = hasActiveGraceTimer(activeSession.id, studentUser.id);
    assert(timerActiveAfterDrop, '15-second grace timer is active on server following network disconnect');

    // Verify record is NOT closed during grace period
    const recordsDuringDrop = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );
    assert(recordsDuringDrop.length === 1, 'Still exactly 1 record during disconnect grace period');
    assert(recordsDuringDrop[0]?.leftAt === null, 'Attendance record remains OPEN (leftAt is null) during grace period');
    assert(recordsDuringDrop[0]?.id === initialRecordId, 'Attendance record ID unchanged during grace period');

    // 1.2 Student reconnects after brief drop (within 15 seconds)
    console.log('  1.2 Student reconnects via new socket within 15s grace window...');
    reconnectedSocket1 = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => reconnectedSocket1!.on('connect', resolve));
    await new Promise<void>((resolve) => reconnectedSocket1!.emit('room:join', { roomId }, () => resolve()));
    await new Promise<void>((resolve) => reconnectedSocket1!.emit('live:joined', { roomId }, () => resolve()));

    // Verify grace timer was cancelled upon reconnect
    const timerAfterReconnect = hasActiveGraceTimer(activeSession.id, studentUser.id);
    assert(!timerAfterReconnect, 'Grace timer was cancelled immediately upon reconnect within 15s window');

    // Verify record was reused: NO duplicate attendance entry created!
    const recordsAfterReconnect = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );
    assert(
      recordsAfterReconnect.length === 1,
      `Exactly 1 attendance record exists (reused single record, expected 1, found ${recordsAfterReconnect.length})`
    );
    assert(recordsAfterReconnect[0]?.id === initialRecordId, 'Attendance record ID matches original initial record');
    assert(recordsAfterReconnect[0]?.joinedAt === initialJoinedAt, 'Attendance record joinedAt timestamp is preserved unbroken');
    assert(recordsAfterReconnect[0]?.leftAt === null, 'Attendance record remains open (leftAt: null)');

    // 1.3 Rapid consecutive reconnects: Disconnect & reconnect again within 15 seconds
    console.log('  1.3 Testing second rapid network drop and reconnect within grace window...');
    reconnectedSocket1.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    assert(hasActiveGraceTimer(activeSession.id, studentUser.id), 'Grace timer restarted on second disconnect');

    reconnectedSocket2 = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });
    await new Promise<void>((resolve) => reconnectedSocket2!.on('connect', resolve));
    await new Promise<void>((resolve) => reconnectedSocket2!.emit('room:join', { roomId }, () => resolve()));
    await new Promise<void>((resolve) => reconnectedSocket2!.emit('live:joined', { roomId }, () => resolve()));

    assert(!hasActiveGraceTimer(activeSession.id, studentUser.id), 'Grace timer cancelled on second reconnect');
    const recordsAfterSecondReconnect = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );
    assert(recordsAfterSecondReconnect.length === 1, 'Still exactly 1 single open record after second reconnect');
    assert(recordsAfterSecondReconnect[0]?.id === initialRecordId, 'Record ID still identical to initial join');

    // ════════════════════════════════════════════════════════════════
    // ACCEPTANCE CRITERION 2:
    // A disconnect longer than 15 seconds closes the record and creates a new one on reconnect
    // ════════════════════════════════════════════════════════════════
    console.log('\n\x1b[34m[Acceptance Criterion 2]\x1b[0m Disconnect longer than 15s closes record & creates new one on reconnect...\n');

    // To test expiration without long delays, set grace period to 400ms for fast verification
    const TEST_GRACE_MS = 400;
    setAttendanceGracePeriodMs(TEST_GRACE_MS);

    console.log(`  2.1 Student disconnects with test grace period of ${TEST_GRACE_MS}ms...`);
    reconnectedSocket2.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    assert(hasActiveGraceTimer(activeSession.id, studentUser.id), 'Grace timer active after disconnect');

    // Wait for disconnect duration > grace period (e.g. 550ms > 400ms)
    console.log(`  2.2 Waiting 550ms (> ${TEST_GRACE_MS}ms) for grace period to expire...`);
    await new Promise((r) => setTimeout(r, 550));

    // Verify grace timer has completed and closed
    const timerAfterLongWait = hasActiveGraceTimer(activeSession.id, studentUser.id);
    assert(!timerAfterLongWait, 'Grace timer has completed and expired after duration > grace period');

    // Verify first attendance record has been closed with left_at timestamp
    const recordsAfterExpiry = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );
    assert(recordsAfterExpiry.length === 1, 'Still 1 record prior to reconnect');
    const closedRecord1 = recordsAfterExpiry[0];
    assert(closedRecord1?.leftAt !== null, `Original record #1 successfully CLOSED with leftAt: ${closedRecord1?.leftAt}`);
    assert(Boolean(closedRecord1?.leftAt), 'Original record #1 has valid leftAt timestamp set');

    const closedLeftTime = new Date(closedRecord1?.leftAt!).getTime();
    const joinedTime = new Date(closedRecord1?.joinedAt!).getTime();
    assert(closedLeftTime >= joinedTime, 'Record #1 leftAt is chronologically after joinedAt');

    // 2.3 Student reconnects AFTER grace period expired (> 15 seconds)
    console.log('  2.3 Student reconnects after grace period expired: must create a NEW attendance record...');
    reconnectedSocket3 = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => reconnectedSocket3!.on('connect', resolve));
    await new Promise<void>((resolve) => reconnectedSocket3!.emit('room:join', { roomId }, () => resolve()));

    let thirdJoinAck: any = null;
    await new Promise<void>((resolve) => {
      reconnectedSocket3!.emit('live:joined', { roomId }, (ack: any) => {
        thirdJoinAck = ack;
        resolve();
      });
    });

    assert(thirdJoinAck?.ok === true, 'live:joined acknowledged on reconnect');

    // Verify that a NEW record was created and previous record remains closed
    const recordsAfterLongReconnect = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );

    assert(
      recordsAfterLongReconnect.length === 2,
      `Exactly 2 records now exist (new record created, previous record kept closed, found: ${recordsAfterLongReconnect.length})`
    );

    const oldRecord = recordsAfterLongReconnect.find((a) => a.id === initialRecordId);
    assert(oldRecord?.leftAt !== null, 'Record #1 remains permanently closed');
    assert(oldRecord?.leftAt === closedRecord1?.leftAt, 'Record #1 leftAt timestamp remains intact');

    const newRecord = recordsAfterLongReconnect.find((a) => a.id !== initialRecordId);
    assert(Boolean(newRecord), 'New attendance record #2 successfully created on reconnect');
    assert(newRecord?.leftAt === null, 'New record #2 is currently open (leftAt: null)');
    assert(newRecord?.id !== initialRecordId, `New record #2 has fresh distinct ID (${newRecord?.id} !== ${initialRecordId})`);

    const newJoinedTime = new Date(newRecord?.joinedAt!).getTime();
    assert(newJoinedTime >= closedLeftTime, 'Record #2 joinedAt is chronologically after Record #1 leftAt');

    // ════════════════════════════════════════════════════════════════
    // ACCEPTANCE CRITERION 1B (with live:left event):
    // live:left followed by reconnect within grace period reuses record #2
    // ════════════════════════════════════════════════════════════════
    console.log('\n\x1b[34m[Acceptance Criterion 1B]\x1b[0m live:left and reconnect within grace period reuses record #2...\n');

    resetAttendanceGracePeriodMs();

    // Student clicks leave call
    await new Promise<void>((resolve) => {
      reconnectedSocket3!.emit('live:left', { roomId }, () => resolve());
    });

    assert(hasActiveGraceTimer(activeSession.id, studentUser.id), 'Grace timer active following live:left');

    // Student rejoins within grace window
    await new Promise<void>((resolve) => {
      reconnectedSocket3!.emit('live:joined', { roomId }, () => resolve());
    });

    assert(!hasActiveGraceTimer(activeSession.id, studentUser.id), 'Grace timer cancelled on rejoin');

    const recordsFinal = getMockAttendance().filter(
      (a) => a.userId === studentUser.id && a.sessionId === activeSession.id
    );
    assert(recordsFinal.length === 2, 'Still exactly 2 records total (record #2 reused, not a 3rd record)');
    const activeFinal = recordsFinal.find((a) => a.leftAt === null);
    assert(activeFinal?.id === newRecord?.id, 'Open record ID matches record #2');
  } catch (err: any) {
    console.error('Unexpected test error:', err);
    failedCount++;
  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (studentSocket) studentSocket.disconnect();
    if (reconnectedSocket1) reconnectedSocket1.disconnect();
    if (reconnectedSocket2) reconnectedSocket2.disconnect();
    if (reconnectedSocket3) reconnectedSocket3.disconnect();

    testServer.close();
    resetAttendanceGracePeriodMs();

    console.log('\n============================================================');
    console.log(`Summary: \x1b[32m${passedCount} Passed\x1b[0m, \x1b[31m${failedCount} Failed\x1b[0m`);
    console.log('============================================================\n');

    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runTests();
