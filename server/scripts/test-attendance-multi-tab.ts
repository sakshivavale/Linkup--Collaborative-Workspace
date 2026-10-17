/**
 * Automated Verification Script for US-ATT-03: Multi-Tab Handling
 * Module: Attendance | Priority: P0 | Traces to: FR-6.3
 *
 * Acceptance Criteria Verified:
 * 1. Each user is tracked by userId; multiple socket connections (tabs) are counted together in a liveSockets set.
 * 2. An attendance record closes only when all tabs for that user have left.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { clearMockSessions, addMockSession } from '../src/lib/sessions';
import {
  getMockAttendance,
  clearMockAttendance,
  hasActiveGraceTimer,
  getLiveSockets,
  getLiveSocketsCount,
  setAttendanceGracePeriodMs,
  resetAttendanceGracePeriodMs,
} from '../src/lib/attendance';
import { clearPresence, getRoomPresence } from '../src/realtime/presence';
import { Me, Session, RoomSummary, PresenceEntry } from '@linkup/shared';

const TEST_PORT = 3133;
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
  console.log('🚀 Running US-ATT-03: Multi-Tab Handling Tests');
  console.log('   Module: Attendance | Priority: P0 | Traces to: FR-6.3');
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
  let tab1Socket: ClientSocketType | null = null;
  let tab2Socket: ClientSocketType | null = null;
  let tab3Socket: ClientSocketType | null = null;
  let tab4Socket: ClientSocketType | null = null;
  let tab5Socket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockSessions();
    clearMockAttendance();
    clearPresence();
    resetAttendanceGracePeriodMs();

    const roomId = 'room-att-03-multi-tab';
    const hostToken = 'token-host-att-03';
    const studentToken = 'token-student-att-03';

    const hostUser: Me = {
      id: 'user-host-att-03',
      fullName: 'Prof. Multi Tab Host',
      role: 'teacher',
      email: 'host.multitab@test.com',
    };

    const studentUser: Me = {
      id: 'user-student-att-03',
      fullName: 'Alice MultiTab',
      role: 'student',
      email: 'alice.multitab@test.com',
    };

    setCachedUser(hostToken, hostUser);
    setCachedUser(studentToken, studentUser);

    const activeSession: Session = {
      id: 'session-att-03-test',
      roomId,
      startedAt: new Date().toISOString(),
      endedAt: null,
      livekitRoom: 'lk-room-att-03',
    };

    const roomSummary: RoomSummary = {
      id: roomId,
      name: 'Multi-Tab Attendance Lab',
      description: 'Testing US-ATT-03 Multi-Tab socket tracking and single presence',
      joinCode: 'TAB003',
      hostName: hostUser.fullName,
      memberCount: 2,
      myRole: 'host',
      activeSessionId: activeSession.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
    addMockSession(activeSession);

    // 1. Host connects and joins room
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: hostToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      hostSocket!.on('connect', () => {
        hostSocket!.emit('room:join', { roomId }, (res: any) => {
          if (res?.ok) resolve();
          else reject(new Error('Host room:join failed'));
        });
      });
      hostSocket!.on('connect_error', reject);
    });

    console.log('--- Test 1: User joins live call from Tab 1 (socket 1) ---');
    tab1Socket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => {
      tab1Socket!.on('connect', () => {
        tab1Socket!.emit('room:join', { roomId }, () => {
          tab1Socket!.emit('live:joined', { roomId }, (res: any) => {
            assert(res?.ok === true, 'Tab 1 live:joined acknowledged successfully');
            resolve();
          });
        });
      });
    });

    const liveSocketsTab1 = getLiveSockets(roomId, studentUser.id);
    assert(
      liveSocketsTab1 !== undefined && liveSocketsTab1.has(tab1Socket.id!),
      'liveSockets contains Tab 1 socket ID',
      `liveSockets: ${Array.from(liveSocketsTab1 || [])}`
    );
    assert(getLiveSocketsCount(roomId, studentUser.id) === 1, 'liveSockets count is 1 for user');

    let records = getMockAttendance();
    const userRecords1 = records.filter((r) => r.userId === studentUser.id);
    assert(userRecords1.length === 1, 'Exactly 1 attendance record created on Tab 1 join');
    assert(userRecords1[0]?.leftAt === null, 'Attendance record is open (leftAt: null)');

    let presenceList = getRoomPresence(roomId);
    const studentPresence1 = presenceList.find((p) => p.userId === studentUser.id);
    assert(studentPresence1 !== undefined && studentPresence1.inLive === true, 'User presence shows inLive: true');
    assert(
      presenceList.filter((p) => p.userId === studentUser.id).length === 1,
      'User has exactly 1 presence entry in room presence'
    );

    console.log('\n--- Test 2: Same user opens Tab 2 (socket 2) and joins live call ---');
    tab2Socket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => {
      tab2Socket!.on('connect', () => {
        tab2Socket!.emit('room:join', { roomId }, () => {
          tab2Socket!.emit('live:joined', { roomId }, (res: any) => {
            assert(res?.ok === true, 'Tab 2 live:joined acknowledged successfully');
            resolve();
          });
        });
      });
    });

    const liveSocketsTab2 = getLiveSockets(roomId, studentUser.id);
    assert(
      liveSocketsTab2 !== undefined &&
        liveSocketsTab2.has(tab1Socket.id!) &&
        liveSocketsTab2.has(tab2Socket.id!),
      'AC-1: Multiple socket connections (tabs) are counted together in liveSockets set',
      `liveSockets: ${Array.from(liveSocketsTab2 || [])}`
    );
    assert(getLiveSocketsCount(roomId, studentUser.id) === 2, 'liveSockets count is 2 for user across tabs');

    records = getMockAttendance();
    const userRecords2 = records.filter((r) => r.userId === studentUser.id);
    assert(
      userRecords2.length === 1,
      'AC-1: Attendance is counted as a single presence (NOT inflated by second tab)',
      `Total records found: ${userRecords2.length}`
    );
    assert(userRecords2[0]?.leftAt === null, 'Single attendance record remains open');

    presenceList = getRoomPresence(roomId);
    assert(
      presenceList.filter((p) => p.userId === studentUser.id).length === 1,
      'Room presence list retains exactly 1 entry for the multi-tab user'
    );

    console.log('\n--- Test 3: Same user opens Tab 3 (socket 3) and joins live call ---');
    tab3Socket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => {
      tab3Socket!.on('connect', () => {
        tab3Socket!.emit('room:join', { roomId }, () => {
          tab3Socket!.emit('live:joined', { roomId }, (res: any) => {
            assert(res?.ok === true, 'Tab 3 live:joined acknowledged successfully');
            resolve();
          });
        });
      });
    });

    assert(getLiveSocketsCount(roomId, studentUser.id) === 3, 'liveSockets count is 3 for user');
    records = getMockAttendance();
    assert(
      records.filter((r) => r.userId === studentUser.id).length === 1,
      'Attendance records still not inflated with 3 tabs open'
    );

    console.log('\n--- Test 4: Tab 1 leaves live call (live:left event) ---');
    await new Promise<void>((resolve) => {
      tab1Socket!.emit('live:left', { roomId }, (res: any) => {
        assert(res?.ok === true, 'Tab 1 live:left acknowledged');
        resolve();
      });
    });

    const liveSocketsAfterTab1 = getLiveSockets(roomId, studentUser.id);
    assert(
      liveSocketsAfterTab1 !== undefined &&
        !liveSocketsAfterTab1.has(tab1Socket.id!) &&
        liveSocketsAfterTab1.has(tab2Socket.id!) &&
        liveSocketsAfterTab1.has(tab3Socket.id!),
      'Tab 1 removed from liveSockets set, Tab 2 & 3 remain',
      `Remaining sockets: ${Array.from(liveSocketsAfterTab1 || [])}`
    );
    assert(getLiveSocketsCount(roomId, studentUser.id) === 2, 'liveSockets count decremented to 2');
    assert(
      !hasActiveGraceTimer(activeSession.id, studentUser.id),
      'AC-2: Grace timer is NOT started while user has other active tabs'
    );
    records = getMockAttendance();
    assert(
      records.find((r) => r.userId === studentUser.id)?.leftAt === null,
      'AC-2: Attendance record remains open because tabs 2 and 3 are still in the call'
    );

    presenceList = getRoomPresence(roomId);
    assert(
      presenceList.find((p) => p.userId === studentUser.id)?.inLive === true,
      'User presence is still inLive: true while other tabs are live'
    );

    console.log('\n--- Test 5: Tab 2 disconnects abruptly ---');
    tab2Socket.disconnect();
    // Allow brief async event processing
    await new Promise((resolve) => setTimeout(resolve, 60));

    const liveSocketsAfterTab2 = getLiveSockets(roomId, studentUser.id);
    assert(
      liveSocketsAfterTab2 !== undefined &&
        !liveSocketsAfterTab2.has(tab2Socket.id!) &&
        liveSocketsAfterTab2.has(tab3Socket.id!),
      'Tab 2 socket removed from liveSockets on disconnect; Tab 3 remains',
      `Remaining sockets: ${Array.from(liveSocketsAfterTab2 || [])}`
    );
    assert(getLiveSocketsCount(roomId, studentUser.id) === 1, 'liveSockets count is 1');
    assert(
      !hasActiveGraceTimer(activeSession.id, studentUser.id),
      'AC-2: Grace timer still not started while Tab 3 is open'
    );
    records = getMockAttendance();
    assert(
      records.find((r) => r.userId === studentUser.id)?.leftAt === null,
      'AC-2: Attendance record remains open'
    );

    console.log('\n--- Test 6: Non-live tab disconnect does not affect active live tab ---');
    // Tab 4 joins room channel only, NOT live call
    tab4Socket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => {
      tab4Socket!.on('connect', () => {
        tab4Socket!.emit('room:join', { roomId }, () => resolve());
      });
    });

    // Tab 4 disconnects
    tab4Socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert(
      !hasActiveGraceTimer(activeSession.id, studentUser.id),
      'Disconnecting non-live tab does not start grace timer or close record'
    );
    assert(getLiveSocketsCount(roomId, studentUser.id) === 1, 'Live socket Tab 3 still active');
    records = getMockAttendance();
    assert(
      records.find((r) => r.userId === studentUser.id)?.leftAt === null,
      'Attendance record remains open'
    );

    console.log('\n--- Test 7: Final active tab (Tab 3) leaves live call ---');
    setAttendanceGracePeriodMs(300); // Set short 300ms grace period for fast deterministic testing

    await new Promise<void>((resolve) => {
      tab3Socket!.emit('live:left', { roomId }, (res: any) => {
        assert(res?.ok === true, 'Tab 3 live:left acknowledged');
        resolve();
      });
    });

    assert(getLiveSocketsCount(roomId, studentUser.id) === 0, 'liveSockets count is now 0 (all tabs left)');
    assert(
      hasActiveGraceTimer(activeSession.id, studentUser.id),
      'AC-2: Grace timer starts only after ALL tabs for that user have left'
    );

    console.log('\n--- Test 8: Reconnect within grace period cancels timer and reuses open record ---');
    tab5Socket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => {
      tab5Socket!.on('connect', () => {
        tab5Socket!.emit('room:join', { roomId }, () => {
          tab5Socket!.emit('live:joined', { roomId }, (res: any) => {
            assert(res?.ok === true, 'Tab 5 live:joined acknowledged during grace period');
            resolve();
          });
        });
      });
    });

    assert(
      !hasActiveGraceTimer(activeSession.id, studentUser.id),
      'Grace timer was cancelled upon reconnect'
    );
    assert(getLiveSocketsCount(roomId, studentUser.id) === 1, 'liveSockets tracked for new Tab 5');
    records = getMockAttendance();
    const userRecordsFinal = records.filter((r) => r.userId === studentUser.id);
    assert(
      userRecordsFinal.length === 1,
      'Reconnecting during grace period reused single open attendance record (no inflation)',
      `Total records: ${userRecordsFinal.length}`
    );
    assert(userRecordsFinal[0]?.leftAt === null, 'Attendance record is still open');

    console.log('\n--- Test 9: Close final tab and wait for grace expiration to close record ---');
    tab5Socket.disconnect();
    // Allow disconnect processing and grace timer start
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert(
      hasActiveGraceTimer(activeSession.id, studentUser.id),
      'Grace timer started after final Tab 5 disconnected'
    );

    // Wait for the 300ms grace period to expire
    console.log('  Waiting 400ms for grace period expiration...');
    await new Promise((resolve) => setTimeout(resolve, 400));

    assert(
      !hasActiveGraceTimer(activeSession.id, studentUser.id),
      'Grace timer finished'
    );
    records = getMockAttendance();
    const closedRecord = records.find((r) => r.userId === studentUser.id);
    assert(
      closedRecord !== undefined && closedRecord.leftAt !== null,
      'AC-2: Attendance record successfully closes (leftAt set) only after ALL tabs have left and grace expired',
      `leftAt: ${closedRecord?.leftAt}`
    );
    assert(
      records.filter((r) => r.userId === studentUser.id).length === 1,
      'Total attendance records remained exactly 1 throughout the entire multi-tab session lifecycle'
    );

  } catch (err: any) {
    console.error('Unexpected error in test execution:', err);
    assert(false, 'Test execution completed without unhandled exceptions', err.message);
  } finally {
    resetAttendanceGracePeriodMs();
    hostSocket?.disconnect();
    tab1Socket?.disconnect();
    tab2Socket?.disconnect();
    tab3Socket?.disconnect();
    tab4Socket?.disconnect();
    tab5Socket?.disconnect();

    await new Promise<void>((resolve) => {
      testServer.close(() => {
        console.log('\n[Test Server] Closed');
        resolve();
      });
    });

    console.log('\n============================================================');
    console.log(`Results: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runTests();
