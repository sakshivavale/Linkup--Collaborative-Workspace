/**
 * Automated Verification Script for US-ATT-05: End Session Closes All Records
 * Module: Attendance | Priority: P0 | Traces to: FR-6.5
 *
 * Acceptance Criteria Verified:
 * 1. POST /rooms/:roomId/sessions/:sessionId/end calls close_session_attendance(sessionId, ended_at).
 * 2. All records with left_at IS NULL for that session are updated.
 * 3. On server boot, open records for already-ended sessions are also closed (crash recovery).
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import {
  clearMockSessions,
  setMockSession,
  close_session_attendance,
  closeDanglingAttendanceRecords,
} from '../src/lib/sessions';
import {
  getMockAttendance,
  clearMockAttendance,
  addMockAttendance,
  hasActiveGraceTimer,
  getGraceTimersCount,
  setAttendanceGracePeriodMs,
  resetAttendanceGracePeriodMs,
} from '../src/lib/attendance';
import { clearPresence } from '../src/realtime/presence';
import { Me, Session, RoomSummary } from '@linkup/shared';

const TEST_PORT = 3135;
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
  console.log('🚀 Running US-ATT-05: End Session Closes All Records Tests');
  console.log('   Module: Attendance | Priority: P0 | Traces to: FR-6.5');
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
    clearMockSessions();
    clearMockAttendance();
    clearPresence();
    resetAttendanceGracePeriodMs();

    const roomId = 'room-att-05-test';
    const hostToken = 'token-host-att-05';
    const student1Token = 'token-student1-att-05';
    const student2Token = 'token-student2-att-05';
    const outsiderToken = 'token-outsider-att-05';

    const hostUser: Me = {
      id: 'user-host-att-05',
      fullName: 'Prof. EndSession Attendance Host',
      role: 'teacher',
      email: 'host.att05@test.com',
    };

    const student1User: Me = {
      id: 'user-student1-att-05',
      fullName: 'Alice InClass',
      role: 'student',
      email: 'alice.att05@test.com',
    };

    const student2User: Me = {
      id: 'user-student2-att-05',
      fullName: 'Bob GracePeriod',
      role: 'student',
      email: 'bob.att05@test.com',
    };

    const outsiderUser: Me = {
      id: 'user-outsider-att-05',
      fullName: 'Eve Outsider',
      role: 'student',
      email: 'eve.att05@test.com',
    };

    setCachedUser(hostToken, hostUser, 60000);
    setCachedUser(student1Token, student1User, 60000);
    setCachedUser(student2Token, student2User, 60000);
    setCachedUser(outsiderToken, outsiderUser, 60000);

    const roomSummary: RoomSummary = {
      id: roomId,
      name: 'Attendance End Session Verification Classroom',
      description: 'Testing US-ATT-05 end session attendance closure and crash recovery',
      joinCode: 'ATT005',
      hostName: hostUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
    };

    setMockRooms(hostUser.id, [roomSummary]);
    setMockRooms(student1User.id, [{ ...roomSummary, myRole: 'participant' }]);
    setMockRooms(student2User.id, [{ ...roomSummary, myRole: 'participant' }]);

    console.log('[Setup 1] Host starts live session via POST /api/rooms/:roomId/sessions...');
    const startRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });

    const activeSession: Session = await startRes.json();
    assert(startRes.status === 201, 'Host started live session with 201 Created');
    assert(Boolean(activeSession?.id), `Active session initialized with ID: ${activeSession?.id}`);

    // Connect client sockets
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
      new Promise<void>((res) => hostSocket!.on('connect', () => res())),
      new Promise<void>((res) => student1Socket!.on('connect', () => res())),
      new Promise<void>((res) => student2Socket!.on('connect', () => res())),
    ]);
    assert(true, 'Host and student sockets connected to server');

    await Promise.all([
      new Promise<void>((res) => hostSocket!.emit('room:join', { roomId }, () => res())),
      new Promise<void>((res) => student1Socket!.emit('room:join', { roomId }, () => res())),
      new Promise<void>((res) => student2Socket!.emit('room:join', { roomId }, () => res())),
    ]);

    // Student 1 joins live
    await new Promise<void>((res) => {
      student1Socket!.emit('live:joined', { roomId }, (ack: any) => {
        assert(ack?.ok === true, 'Student 1 joined live call');
        res();
      });
    });

    // Student 2 joins live
    await new Promise<void>((res) => {
      student2Socket!.emit('live:joined', { roomId }, (ack: any) => {
        assert(ack?.ok === true, 'Student 2 joined live call');
        res();
      });
    });

    // Add a historical student 3 who joined and already left normally (closed record)
    const earlierLeftAt = new Date(Date.now() - 60000).toISOString();
    const earlierJoinedAt = new Date(Date.now() - 120000).toISOString();
    addMockAttendance({
      id: 9991,
      sessionId: activeSession.id,
      roomId,
      userId: 'user-student3-historical',
      joinedAt: earlierJoinedAt,
      leftAt: earlierLeftAt,
    });

    // Verify current state before session end: 2 open records, 1 closed record
    let attendance = getMockAttendance();
    const openBefore = attendance.filter((a) => a.sessionId === activeSession.id && a.leftAt === null);
    assert(openBefore.length === 2, `Exactly 2 records are open before ending session (found: ${openBefore.length})`);

    // Student 2 leaves live call right before session end -> starts 15s grace timer
    console.log('\n[Setup 2] Student 2 leaves live call to trigger 15-second grace period...');
    await new Promise<void>((res) => {
      student2Socket!.emit('live:left', { roomId }, () => res());
    });
    assert(hasActiveGraceTimer(activeSession.id, student2User.id), 'Student 2 has an active grace timer running');

    // Test Authorization checks for ending session
    console.log('\n[Authorization Checks] Verifying endpoint guards...');
    const unauthRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${activeSession.id}/end`, {
      method: 'POST',
    });
    assert(unauthRes.status === 401, 'Unauthenticated request to end session rejected with 401 UNAUTHENTICATED');

    const studentEndRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${activeSession.id}/end`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${student1Token}` },
    });
    assert(studentEndRes.status === 403, 'Non-host student cannot end session (403 HOST_ONLY)');

    const outsiderEndRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${activeSession.id}/end`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    assert(outsiderEndRes.status === 403, 'Outsider non-member cannot end session (403 FORBIDDEN)');

    // Listen for session:ended event on student socket
    const sessionEndedPromise = new Promise<{ roomId: string; sessionId: string }>((res, rej) => {
      const t = setTimeout(() => rej(new Error('Timed out waiting for session:ended')), 5000);
      student1Socket!.on('session:ended', (payload: any) => {
        clearTimeout(t);
        res(payload);
      });
    });

    // Acceptance Criterion 1: Host ends the session via POST /rooms/:roomId/sessions/:sessionId/end
    console.log('\n[Acceptance Criterion 1] Host ends session via POST /rooms/:roomId/sessions/:sessionId/end...');
    const endRes = await fetch(`${BASE_URL}/rooms/${roomId}/sessions/${activeSession.id}/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });

    const endedSession: Session = await endRes.json();
    assert(endRes.status === 200, 'POST /rooms/:roomId/sessions/:sessionId/end returns 200 OK');
    assert(endedSession.id === activeSession.id, 'Response session id matches the ended session');
    assert(Boolean(endedSession.endedAt), `endedAt is populated with ISO timestamp: ${endedSession.endedAt}`);

    const receivedEvent = await sessionEndedPromise;
    assert(receivedEvent.sessionId === activeSession.id, 'All participants receive session:ended socket event');

    // Acceptance Criterion 2: All records with left_at IS NULL for that session are updated
    console.log('\n[Acceptance Criterion 2] Verifying all open attendance records are closed with left_at = ended_at...');
    attendance = getMockAttendance();

    const openAfter = attendance.filter((a) => a.sessionId === activeSession.id && a.leftAt === null);
    assert(openAfter.length === 0, 'No attendance records are left open (leftAt IS NULL count = 0)');

    const student1Record = attendance.find(
      (a) => a.sessionId === activeSession.id && a.userId === student1User.id
    );
    assert(Boolean(student1Record?.leftAt), 'Student 1 active record was closed');
    assert(student1Record?.leftAt === endedSession.endedAt, `Student 1 leftAt matches endedAt (${student1Record?.leftAt})`);

    const student2Record = attendance.find(
      (a) => a.sessionId === activeSession.id && a.userId === student2User.id
    );
    assert(Boolean(student2Record?.leftAt), 'Student 2 (in grace period) record was closed immediately');
    assert(student2Record?.leftAt === endedSession.endedAt, `Student 2 leftAt matches endedAt (${student2Record?.leftAt})`);
    assert(!hasActiveGraceTimer(activeSession.id, student2User.id), 'Pending grace timer for student 2 was cancelled');

    const historicalRecord = attendance.find(
      (a) => a.sessionId === activeSession.id && a.userId === 'user-student3-historical'
    );
    assert(
      historicalRecord?.leftAt === earlierLeftAt,
      `Previously closed record was preserved and not overwritten (${historicalRecord?.leftAt} === ${earlierLeftAt})`
    );

    // Verify GET /api/rooms/:roomId/sessions/active returns null after end
    const activeRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/active`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    const activeBody = await activeRes.json();
    assert(activeBody.session === null, 'Active session is null after ending session');

    // Acceptance Criterion 3: Server boot crash recovery
    console.log('\n[Acceptance Criterion 3] Verifying server boot crash recovery for already-ended sessions...');

    // Simulate crash recovery: An earlier session was ended, but server crashed before records closed
    const crashedSessionId = 'session-crashed-recovery-test';
    const crashedEndedAt = '2026-10-17T15:00:00.000Z';
    setMockSession(crashedSessionId, {
      id: crashedSessionId,
      roomId: 'room-crash-test',
      startedAt: '2026-10-17T14:00:00.000Z',
      endedAt: crashedEndedAt,
      startedBy: hostUser.id,
    });

    // Dangling open record for crashed session
    addMockAttendance({
      id: 9992,
      sessionId: crashedSessionId,
      roomId: 'room-crash-test',
      userId: 'user-crashed-student-1',
      joinedAt: '2026-10-17T14:10:00.000Z',
      leftAt: null, // Left open due to simulated crash
    });

    // Another open record for an ongoing, still active session
    const activeOngoingSessionId = 'session-ongoing-active';
    setMockSession(activeOngoingSessionId, {
      id: activeOngoingSessionId,
      roomId: 'room-ongoing-test',
      startedAt: '2026-10-17T16:00:00.000Z',
      endedAt: null,
      startedBy: hostUser.id,
    });
    addMockAttendance({
      id: 9993,
      sessionId: activeOngoingSessionId,
      roomId: 'room-ongoing-test',
      userId: 'user-active-student',
      joinedAt: '2026-10-17T16:05:00.000Z',
      leftAt: null,
    });

    // Verify dangling record exists prior to recovery
    let danglingBefore = getMockAttendance().find((a) => a.id === 9992);
    assert(danglingBefore?.leftAt === null, 'Dangling record with leftAt: null exists prior to boot recovery');

    // Execute server boot recovery routine
    await closeDanglingAttendanceRecords();

    // Verify dangling record for ended session was closed with the session's endedAt
    const danglingAfter = getMockAttendance().find((a) => a.id === 9992);
    assert(danglingAfter?.leftAt !== null, 'Dangling record is no longer open');
    assert(
      danglingAfter?.leftAt === crashedEndedAt,
      `Dangling record leftAt closed with crashed session endedAt (${danglingAfter?.leftAt} === ${crashedEndedAt})`
    );

    // Verify active session record was NOT touched by crash recovery
    const ongoingRecord = getMockAttendance().find((a) => a.id === 9993);
    assert(ongoingRecord?.leftAt === null, 'Record for active ongoing session remains open and untouched');

    // Test direct export: close_session_attendance(sessionId, endedAt)
    console.log('\n[Export Verification] Testing close_session_attendance(sessionId, endedAt) direct invocation...');
    const directSessionId = 'session-direct-close-test';
    const directEndedAt = new Date().toISOString();
    addMockAttendance({
      id: 9994,
      sessionId: directSessionId,
      roomId: 'room-direct-test',
      userId: 'user-direct-student',
      joinedAt: new Date(Date.now() - 30000).toISOString(),
      leftAt: null,
    });

    await close_session_attendance(directSessionId, directEndedAt);
    const directRecord = getMockAttendance().find((a) => a.id === 9994);
    assert(directRecord?.leftAt === directEndedAt, 'close_session_attendance closed record with given ended_at');

  } catch (err: any) {
    console.error('Test execution error:', err);
    failedCount++;
  } finally {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (student1Socket?.connected) student1Socket.disconnect();
    if (student2Socket?.connected) student2Socket.disconnect();
    testServer.close();
  }

  console.log('\n============================================================');
  console.log(`Summary: ${passedCount} Passed, ${failedCount} Failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests();
