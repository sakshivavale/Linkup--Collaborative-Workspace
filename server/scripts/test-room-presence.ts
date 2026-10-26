/**
 * Automated Verification Script for US-ROOM-02: View Members and Presence
 * Traces to: FR-2.4
 *
 * Acceptance Criteria Verified:
 * 1. The People sidebar shows all room members with a name, role badge (Teacher / Student), and an online/offline dot.
 * 2. The online dot updates within 1 second when a member connects or disconnects.
 * 3. Users currently in the live call have an additional "In call" indicator.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocketIO, Socket as ClientSocket } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms, setMockSession, clearMockSessions } from '../src/lib/rooms';
import { clearPresence } from '../src/realtime/presence';
import { Me, PresenceEntry, RoomSummary } from '@linkup/shared';

const TEST_PORT = 3112;
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
  console.log('🚀 Running US-ROOM-02: View Members and Presence Tests');
  console.log('============================================================\n');

  const testServer = http.createServer(app);
  io.attach(testServer);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  const socketsToClose: ClientSocket[] = [];

  try {
    clearTokenCache();
    clearMockRooms();
    clearPresence();

    const teacherToken = 'test_teacher_presence_token';
    const studentToken = 'test_student_presence_token';

    const teacherUser: Me = {
      id: 'teacher-pres-1',
      email: 'teacher@linkup.test',
      fullName: 'Prof. Ada Lovelace',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'student-pres-1',
      email: 'student@linkup.test',
      fullName: 'Alan Turing',
      role: 'student',
    };

    setCachedUser(teacherToken, teacherUser, 60000);
    setCachedUser(studentToken, studentUser, 60000);

    const roomId = 'room-presence-test';
    const testRoom: RoomSummary = {
      id: roomId,
      name: 'Algorithm Analysis',
      description: 'Room for presence testing',
      joinCode: 'PRES01',
      hostName: teacherUser.fullName,
      memberCount: 2,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      members: [
        {
          userId: teacherUser.id,
          fullName: teacherUser.fullName,
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
    };

    setMockRooms(teacherUser.id, [testRoom]);
    setMockRooms(studentUser.id, [{ ...testRoom, myRole: 'participant' }]);

    // -------------------------------------------------------------------------
    // CRITERION 1: People sidebar shows all room members with roles (Teacher / Student)
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Criterion 1]\x1b[0m Verifying room members and roles via GET /api/rooms/:roomId...\n');

    const roomRes = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    const roomBody = (await roomRes.json()) as RoomSummary;

    assert(roomRes.status === 200, 'GET /api/rooms/:roomId returns 200');
    assert(
      Array.isArray(roomBody.members) && roomBody.members.length === 2,
      'Room summary includes all 2 room members'
    );

    const teacherMember = roomBody.members?.find((m) => m.userId === teacherUser.id);
    const studentMember = roomBody.members?.find((m) => m.userId === studentUser.id);

    assert(
      teacherMember?.userRole === 'teacher' && teacherMember?.memberRole === 'host',
      'Teacher member has userRole="teacher" and memberRole="host"'
    );
    assert(
      studentMember?.userRole === 'student' && studentMember?.memberRole === 'participant',
      'Student member has userRole="student" and memberRole="participant"'
    );

    // -------------------------------------------------------------------------
    // CRITERION 2: Online dot updates within 1 second on connect & disconnect
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Criterion 2]\x1b[0m Verifying real-time presence:update within 1s on connect/disconnect...\n');

    // 2a. Teacher connects socket and joins room
    const teacherSocket = ClientSocketIO(BASE_URL, {
      auth: { token: teacherToken },
      transports: ['websocket'],
    });
    socketsToClose.push(teacherSocket);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Teacher socket connect timeout')), 3000);
      teacherSocket.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    const teacherJoinedPresencePromise = new Promise<{ presence: PresenceEntry[]; latencyMs: number }>(
      (resolve, reject) => {
        const start = Date.now();
        const timeout = setTimeout(() => reject(new Error('presence:update timeout on join')), 1000);

        teacherSocket.on('presence:update', (data: { roomId: string; presence: PresenceEntry[] }) => {
          if (data.roomId === roomId) {
            clearTimeout(timeout);
            resolve({ presence: data.presence, latencyMs: Date.now() - start });
          }
        });
      }
    );

    teacherSocket.emit('room:join', roomId);
    const teacherPresenceData = await teacherJoinedPresencePromise;

    assert(
      teacherPresenceData.latencyMs < 1000,
      `presence:update received within 1 second on join (${teacherPresenceData.latencyMs}ms)`
    );
    assert(
      teacherPresenceData.presence.some((p) => p.userId === teacherUser.id),
      'Teacher is marked online in presence list'
    );

    // 2b. Student connects socket and joins room
    const studentSocket = ClientSocketIO(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });
    socketsToClose.push(studentSocket);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Student socket connect timeout')), 3000);
      studentSocket.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    // Both teacher and student should receive presence:update within 1s with both users online
    const bothOnlinePromise = new Promise<{ presence: PresenceEntry[]; latencyMs: number }>(
      (resolve, reject) => {
        const start = Date.now();
        const timeout = setTimeout(() => reject(new Error('presence:update timeout on second member join')), 1000);

        teacherSocket.on('presence:update', (data: { roomId: string; presence: PresenceEntry[] }) => {
          if (data.roomId === roomId && data.presence.length === 2) {
            clearTimeout(timeout);
            resolve({ presence: data.presence, latencyMs: Date.now() - start });
          }
        });
      }
    );

    studentSocket.emit('room:join', roomId);
    const bothPresenceData = await bothOnlinePromise;

    assert(
      bothPresenceData.latencyMs < 1000,
      `Second member connect broadcasted presence:update within 1 second (${bothPresenceData.latencyMs}ms)`
    );
    assert(
      bothPresenceData.presence.some((p) => p.userId === teacherUser.id) &&
        bothPresenceData.presence.some((p) => p.userId === studentUser.id),
      'Both Teacher and Student are in presence list'
    );

    // -------------------------------------------------------------------------
    // CRITERION 3: In-call indicator updates on live:joined and live:left
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Criterion 3]\x1b[0m Verifying "In call" indicator update on live:joined and live:left...\n');

    setMockSession(roomId, {
      id: 'session-presence-test',
      roomId,
      hostId: teacherUser.id,
      startedAt: new Date().toISOString(),
      endedAt: null,
    } as any);

    // 3a. Student enters live call
    const inCallPromise = new Promise<{ inLive: boolean; latencyMs: number }>((resolve, reject) => {
      const start = Date.now();
      const timeout = setTimeout(() => reject(new Error('live:joined presence update timeout')), 1000);

      teacherSocket.on('presence:update', (data: { roomId: string; presence: PresenceEntry[] }) => {
        const studentP = data.presence.find((p) => p.userId === studentUser.id);
        if (studentP && studentP.inLive) {
          clearTimeout(timeout);
          resolve({ inLive: studentP.inLive, latencyMs: Date.now() - start });
        }
      });
    });

    studentSocket.emit('live:joined', { roomId });
    const inCallData = await inCallPromise;

    assert(
      inCallData.inLive === true,
      'Student has inLive=true ("In call" indicator active)'
    );
    assert(
      inCallData.latencyMs < 1000,
      `In-call indicator updated within 1 second (${inCallData.latencyMs}ms)`
    );

    // 3b. Student leaves live call
    const leaveCallPromise = new Promise<{ inLive: boolean; latencyMs: number }>((resolve, reject) => {
      const start = Date.now();
      const timeout = setTimeout(() => reject(new Error('live:left presence update timeout')), 1000);

      teacherSocket.on('presence:update', (data: { roomId: string; presence: PresenceEntry[] }) => {
        const studentP = data.presence.find((p) => p.userId === studentUser.id);
        if (studentP && !studentP.inLive) {
          clearTimeout(timeout);
          resolve({ inLive: studentP.inLive, latencyMs: Date.now() - start });
        }
      });
    });

    studentSocket.emit('live:left', { roomId });
    const leaveCallData = await leaveCallPromise;

    assert(
      leaveCallData.inLive === false,
      'Student has inLive=false ("In call" indicator removed)'
    );

    // -------------------------------------------------------------------------
    // CRITERION 2 (Continued): Disconnect update within 1 second
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Criterion 2 Continued]\x1b[0m Verifying disconnect presence update within 1 second...\n');

    const studentDisconnectPromise = new Promise<{ remainingCount: number; latencyMs: number }>(
      (resolve, reject) => {
        const start = Date.now();
        const timeout = setTimeout(() => reject(new Error('Disconnect presence update timeout')), 1000);

        teacherSocket.on('presence:update', (data: { roomId: string; presence: PresenceEntry[] }) => {
          if (data.roomId === roomId && !data.presence.some((p) => p.userId === studentUser.id)) {
            clearTimeout(timeout);
            resolve({ remainingCount: data.presence.length, latencyMs: Date.now() - start });
          }
        });
      }
    );

    studentSocket.disconnect();
    const disconnectData = await studentDisconnectPromise;

    assert(
      disconnectData.latencyMs < 1000,
      `Student disconnect broadcasted within 1 second (${disconnectData.latencyMs}ms)`
    );
    assert(
      disconnectData.remainingCount === 1,
      'Student removed from online presence (now offline)'
    );

    console.log(`\n============================================================`);
    console.log(`Summary: ${passedCount} passed, ${failedCount} failed`);
    console.log(`============================================================\n`);

    if (failedCount > 0) {
      process.exitCode = 1;
    }
  } catch (err: any) {
    console.error('\n\x1b[31m[Test Error]\x1b[0m Unexpected failure:', err);
    process.exitCode = 1;
  } finally {
    for (const s of socketsToClose) {
      if (s.connected) s.disconnect();
    }
    clearMockRooms();
    clearTokenCache();
    clearPresence();
    testServer.close();
  }
}

runTests();
