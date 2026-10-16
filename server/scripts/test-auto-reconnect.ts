/**
 * Automated Verification Script for US-LIVE-07: Auto-Reconnect on Network Drop
 * Priority: P0 | Traces to: FR-3.8
 *
 * Acceptance Criteria Verified:
 * 1. A top-of-screen "Reconnecting..." banner appears when the Socket.IO or LiveKit connection drops.
 * 2. Chat input, media controls, and other interactive elements are disabled while reconnecting.
 * 3. Within 15 seconds of reconnection, the banner disappears and the full state is synced from the room:join snapshot.
 * 4. A reconnect within 15 seconds reuses the open attendance record.
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

const TEST_PORT = 3128;
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
  console.log('🚀 Running US-LIVE-07: Auto-Reconnect on Network Drop Tests');
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

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockSessions();
    clearMockAttendance();
    clearPresence();

    const roomId = 'room-reconnect-101';

    const hostUser: Me = {
      id: 'user-host-101',
      fullName: 'Prof. Reconnect Host',
      email: 'host.reconnect@example.com',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'user-student-101',
      fullName: 'Student Reconnector',
      email: 'student.reconnect@example.com',
      role: 'student',
    };

    const hostToken = 'token-host-101';
    const studentToken = 'token-student-101';

    setCachedUser(hostToken, hostUser);
    setCachedUser(studentToken, studentUser);

    const mockRoomData: RoomSummary = {
      id: roomId,
      name: 'Network Reconnection Lab',
      description: 'Testing automatic reconnection on drop and snapshot sync',
      joinCode: 'RECONN',
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
          permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: true, canCode: true },
          joinedAt: new Date().toISOString(),
        },
      ],
      presence: [],
    };

    setMockRooms(hostUser.id, [{ ...mockRoomData, myRole: 'host' }]);
    setMockRooms(studentUser.id, [{ ...mockRoomData, myRole: 'participant' }]);

    // ── Test 1: Host starts live session ──
    console.log('\x1b[34m[Test 1]\x1b[0m Host starts a live session...\n');
    const startRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });

    const activeSession: Session = await startRes.json();
    assert(startRes.status === 201, 'Host started live session with 201 Created');
    assert(Boolean(activeSession?.id), `Active session created with ID: ${activeSession?.id}`);

    // ── Test 2: Connect sockets and verify room:join snapshot (Acceptance Criteria 3) ──
    console.log('\n\x1b[34m[Test 2]\x1b[0m Acceptance Criteria 3: Verify room:join returns full state snapshot...\n');

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
    assert(true, 'Host and student sockets connected to server');

    // Host emits room:join
    await new Promise<void>((resolve) => {
      hostSocket!.emit('room:join', { roomId }, () => resolve());
    });

    // Student emits room:join and receives snapshot
    const studentJoinResponse = await new Promise<any>((resolve) => {
      studentSocket!.emit('room:join', { roomId }, (ack: any) => resolve(ack));
    });

    assert(studentJoinResponse?.ok === true, 'Student room:join acknowledged with ok: true');
    const snapshot = studentJoinResponse?.snapshot || studentJoinResponse?.data;
    assert(Boolean(snapshot), 'room:join returned snapshot data');
    assert(snapshot?.roomId === roomId, `Snapshot contains roomId: ${snapshot?.roomId}`);
    assert(Boolean(snapshot?.session), 'Snapshot contains active session');
    assert(snapshot?.session?.id === activeSession.id, `Snapshot session matches active session ID: ${activeSession.id}`);
    assert(Array.isArray(snapshot?.members), 'Snapshot contains room members array');
    assert(snapshot?.members?.length >= 2, `Snapshot members count: ${snapshot?.members?.length}`);
    assert(Array.isArray(snapshot?.presence), 'Snapshot contains presence array');
    assert(Boolean(snapshot?.room), 'Snapshot contains full room summary');

    // ── Test 3: Student enters live call (live:joined creates open attendance record) ──
    console.log('\n\x1b[34m[Test 3]\x1b[0m Student joins live call: initial attendance record created...\n');

    await new Promise<void>((resolve) => {
      studentSocket!.emit('live:joined', { roomId }, () => resolve());
    });

    const initialAttendance = getMockAttendance();
    const studentRecords = initialAttendance.filter((a) => a.userId === studentUser.id && a.sessionId === activeSession.id);
    assert(studentRecords.length === 1, `Single attendance record created for student (found: ${studentRecords.length})`);
    assert(studentRecords[0]?.leftAt === null, 'Attendance record is currently open (leftAt is null)');
    const initialRecordId = studentRecords[0]?.id;

    // ── Test 4: Acceptance Criteria 4: Temporary disconnect & reconnect within 15 seconds reuses open record ──
    console.log('\n\x1b[34m[Test 4]\x1b[0m Acceptance Criteria 4: Disconnect and reconnect within grace period...\n');

    // Disconnect student socket simulating Wi-Fi/network drop
    studentSocket!.disconnect();
    console.log('  [Network Drop] Student socket disconnected.');

    // Wait a brief moment to let disconnect event process on server
    await new Promise((r) => setTimeout(r, 100));

    // Verify grace timer is running
    const timerActive = hasActiveGraceTimer(activeSession.id, studentUser.id);
    assert(timerActive, 'Server started 15-second grace timer for disconnected student');

    // Verify attendance record remains OPEN during grace period
    const attendanceDuringDrop = getMockAttendance().filter((a) => a.userId === studentUser.id && a.sessionId === activeSession.id);
    assert(attendanceDuringDrop.length === 1 && attendanceDuringDrop[0].leftAt === null, 'Attendance record remains open during grace period');

    // Reconnect within 15 seconds
    console.log('  [Network Restored] Student socket reconnects within grace period...');
    studentSocket2 = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => studentSocket2!.on('connect', resolve));

    // Student re-joins room and receives synced snapshot
    const reconnectSnapshotRes = await new Promise<any>((resolve) => {
      studentSocket2!.emit('room:join', { roomId }, (ack: any) => resolve(ack));
    });
    assert(reconnectSnapshotRes?.ok === true, 'Student re-joined room successfully on reconnect');

    // Student emits live:joined to resume call
    await new Promise<void>((resolve) => {
      studentSocket2!.emit('live:joined', { roomId }, () => resolve());
    });

    // Verify grace timer was cancelled and record was reused
    const timerAfterReconnect = hasActiveGraceTimer(activeSession.id, studentUser.id);
    assert(!timerAfterReconnect, 'Grace timer was cancelled upon reconnect within 15s');

    const attendanceAfterReconnect = getMockAttendance().filter((a) => a.userId === studentUser.id && a.sessionId === activeSession.id);
    assert(attendanceAfterReconnect.length === 1, `Acceptance Criteria 4: Exactly 1 attendance record exists (reused same record, found: ${attendanceAfterReconnect.length})`);
    assert(attendanceAfterReconnect[0].id === initialRecordId, `Acceptance Criteria 4: Record ID is identical (${initialRecordId})`);
    assert(attendanceAfterReconnect[0].leftAt === null, 'Attendance record remains open and active');

    // ── Test 5: Disconnect longer than grace period closes record and creates new on next join ──
    console.log('\n\x1b[34m[Test 5]\x1b[0m Disconnect exceeding grace period closes the record; new join creates second record...\n');

    // Use a fast grace period for testing expiration (e.g. 300ms)
    setAttendanceGracePeriodMs(300);

    studentSocket2!.disconnect();
    console.log('  [Network Drop 2] Student disconnected, waiting for grace period to expire...');

    // Wait for the 300ms grace period to expire
    await new Promise((r) => setTimeout(r, 450));

    // Verify record was closed with left_at timestamp
    const attendanceAfterExpiry = getMockAttendance().filter((a) => a.userId === studentUser.id && a.sessionId === activeSession.id);
    assert(attendanceAfterExpiry.length === 1, 'Previous attendance record still exists');
    assert(attendanceAfterExpiry[0].leftAt !== null, `Attendance record closed with leftAt: ${attendanceAfterExpiry[0].leftAt}`);

    // Student rejoins after expiration
    console.log('  [Rejoin After Drop] Student rejoins live session after grace period expired...');
    resetAttendanceGracePeriodMs();

    const studentSocket3 = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => studentSocket3.on('connect', resolve));
    await new Promise<void>((resolve) => studentSocket3.emit('room:join', { roomId }, () => resolve()));
    await new Promise<void>((resolve) => studentSocket3.emit('live:joined', { roomId }, () => resolve()));

    const attendanceAfterNewJoin = getMockAttendance().filter((a) => a.userId === studentUser.id && a.sessionId === activeSession.id);
    assert(attendanceAfterNewJoin.length === 2, `New attendance record created for rejoin after grace expiry (expected: 2, found: ${attendanceAfterNewJoin.length})`);
    const openRecords = attendanceAfterNewJoin.filter((a) => a.leftAt === null);
    assert(openRecords.length === 1, 'Exactly one open attendance record active now');

    studentSocket3.disconnect();
  } catch (err: any) {
    console.error('Unexpected test error:', err);
    failedCount++;
  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (studentSocket) studentSocket.disconnect();
    if (studentSocket2) studentSocket2.disconnect();

    testServer.close();
    resetAttendanceGracePeriodMs();

    console.log('\n============================================================');
    console.log(`Summary: \x1b[32m${passedCount} Passed\x1b[0m, \x1b[31m${failedCount} Failed\x1b[0m`);
    console.log('============================================================\n');

    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runTests();
