/**
 * Automated Verification Script for US-LIVE-06: Host Leaves Without Ending
 * Module: Live Session & Media | Priority: P0 | Traces to: FR-3.7
 *
 * Acceptance Criteria Verified:
 * 1. The session remains active (LiveKit room not deleted) when the host disconnects from the call.
 * 2. Other participants remain connected.
 * 3. The host can re-join the call using the Join Live button.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { clearMockSessions, getMockAttendance, addMockAttendance, clearMockAttendance } from '../src/lib/sessions';
import { clearPresence } from '../src/realtime/presence';
import { Me, Session } from '@linkup/shared';

const TEST_PORT = 3126;
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
  console.log('🚀 Running US-LIVE-06: Host Leaves Without Ending Tests');
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
    clearMockSessions();
    clearMockAttendance();
    clearPresence();

    const hostToken = 'test_host_token_us_live_06';
    const studentToken = 'test_student_token_us_live_06';

    const hostUser: Me = {
      id: 'host-user-us-live-06',
      email: 'host@linkup.test',
      fullName: 'Host Teacher',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'student-user-us-live-06',
      email: 'student@linkup.test',
      fullName: 'Student Attendee',
      role: 'student',
    };

    setCachedUser(hostToken, hostUser, 60000);
    setCachedUser(studentToken, studentUser, 60000);

    const roomId = 'room-test-us-live-06';

    // Set up mock rooms for host and student
    setMockRooms(hostUser.id, [
      {
        id: roomId,
        name: 'Distributed Systems Live',
        description: 'Interactive lecture and lab',
        joinCode: 'DIST99',
        hostName: hostUser.fullName,
        memberCount: 2,
        myRole: 'host',
        activeSessionId: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    setMockRooms(studentUser.id, [
      {
        id: roomId,
        name: 'Distributed Systems Live',
        description: 'Interactive lecture and lab',
        joinCode: null,
        hostName: hostUser.fullName,
        memberCount: 2,
        myRole: 'participant',
        activeSessionId: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    console.log('\x1b[34m[Test 1]\x1b[0m Host starts a live session...\n');
    const startRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });

    const activeSession: Session = await startRes.json();
    assert(startRes.status === 201, 'Host started session with 201 Created');
    assert(Boolean(activeSession?.id), `Active session created with ID: ${activeSession?.id}`);
    assert(activeSession.endedAt === null, 'Session endedAt is null (active)');

    // Add mock attendance records
    addMockAttendance({
      id: 1,
      sessionId: activeSession.id,
      roomId,
      userId: hostUser.id,
      joinedAt: activeSession.startedAt,
      leftAt: null,
    });
    addMockAttendance({
      id: 2,
      sessionId: activeSession.id,
      roomId,
      userId: studentUser.id,
      joinedAt: activeSession.startedAt,
      leftAt: null,
    });

    console.log('\n\x1b[34m[Test 2]\x1b[0m Host and student connect sockets and join live call...\n');
    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: hostToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Student socket timeout')), 4000);
        studentSocket!.on('connect', () => {
          studentSocket!.emit('room:join', { roomId }, (ack: any) => {
            clearTimeout(timeout);
            assert(ack?.ok === true, 'Student socket joined room channel');
            resolve();
          });
        });
      }),
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Host socket timeout')), 4000);
        hostSocket!.on('connect', () => {
          hostSocket!.emit('room:join', { roomId }, (ack: any) => {
            clearTimeout(timeout);
            assert(ack?.ok === true, 'Host socket joined room channel');
            resolve();
          });
        });
      }),
    ]);

    // Both join the live call
    await Promise.all([
      new Promise<void>((resolve) => {
        studentSocket!.emit('live:joined', { roomId }, (ack: any) => {
          assert(ack?.ok === true, 'Student joined live call (inLive: true)');
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        hostSocket!.emit('live:joined', { roomId }, (ack: any) => {
          assert(ack?.ok === true, 'Host joined live call (inLive: true)');
          resolve();
        });
      }),
    ]);

    console.log('\n\x1b[34m[Test 3]\x1b[0m Acceptance Criteria 1 & 2: Host leaves the call without ending session...\n');
    let sessionEndedEventFired = false;
    studentSocket!.on('session:ended', () => {
      sessionEndedEventFired = true;
    });

    const studentPresencePromise = new Promise<any[]>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Presence update timeout after host leave')), 4000);
      const listener = (data: any) => {
        if (data.roomId === roomId) {
          const hostEntry = data.presence?.find((p: any) => p.userId === hostUser.id);
          if (hostEntry && hostEntry.inLive === false) {
            clearTimeout(timeout);
            studentSocket!.off('presence:update', listener);
            resolve(data.presence);
          }
        }
      };
      studentSocket!.on('presence:update', listener);
    });

    // Host emits live:left (leaving the call)
    await new Promise<void>((resolve) => {
      hostSocket!.emit('live:left', { roomId }, (ack: any) => {
        assert(ack?.ok === true, 'Host emitted live:left');
        resolve();
      });
    });

    const updatedPresence = await studentPresencePromise;
    const hostPresence = updatedPresence.find((p) => p.userId === hostUser.id);
    const studentPresence = updatedPresence.find((p) => p.userId === studentUser.id);

    // AC-1: Verify session is STILL active
    const checkActiveRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/active`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    const checkActiveData = await checkActiveRes.json();
    assert(checkActiveRes.status === 200, 'GET /api/rooms/:roomId/sessions/active returns 200 OK');
    assert(Boolean(checkActiveData?.session), 'Active session still exists');
    assert(checkActiveData.session.id === activeSession.id, 'Active session ID unchanged');
    assert(checkActiveData.session.endedAt === null, 'Session endedAt remains null (NOT ended)');

    // AC-2: Other participants remain connected
    assert(studentPresence?.inLive === true, 'Student participant remains connected in live call (inLive: true)');
    assert(hostPresence?.inLive === false, 'Host participant is marked not in live (inLive: false)');
    assert(sessionEndedEventFired === false, 'No session:ended event was broadcast when host left call');

    console.log('\n\x1b[34m[Test 4]\x1b[0m Acceptance Criteria 3: Host re-joins the call using Join Live button...\n');
    const rejoinPresencePromise = new Promise<any[]>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Presence update timeout after host rejoin')), 4000);
      const listener = (data: any) => {
        if (data.roomId === roomId) {
          const hostEntry = data.presence?.find((p: any) => p.userId === hostUser.id);
          if (hostEntry && hostEntry.inLive === true) {
            clearTimeout(timeout);
            studentSocket!.off('presence:update', listener);
            resolve(data.presence);
          }
        }
      };
      studentSocket!.on('presence:update', listener);
    });

    // Host emits live:joined to re-enter
    await new Promise<void>((resolve) => {
      hostSocket!.emit('live:joined', { roomId }, (ack: any) => {
        assert(ack?.ok === true, 'Host emitted live:joined to re-join the call');
        resolve();
      });
    });

    const rejoinedPresence = await rejoinPresencePromise;
    const hostRejoined = rejoinedPresence.find((p) => p.userId === hostUser.id);
    const studentStillConnected = rejoinedPresence.find((p) => p.userId === studentUser.id);

    assert(hostRejoined?.inLive === true, 'Host is back in live call (inLive: true)');
    assert(studentStillConnected?.inLive === true, 'Student is still in live call simultaneously (inLive: true)');

    console.log('\n\x1b[34m[Test 5]\x1b[0m Verify host socket disconnection (e.g. browser reload / network drop) does NOT end session...\n');
    const disconnectPresencePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Presence update timeout after host disconnect')), 4000);
      const listener = (data: any) => {
        if (data.roomId === roomId) {
          const hostEntry = data.presence?.find((p: any) => p.userId === hostUser.id);
          if (!hostEntry || hostEntry.inLive === false) {
            clearTimeout(timeout);
            studentSocket!.off('presence:update', listener);
            resolve();
          }
        }
      };
      studentSocket!.on('presence:update', listener);
    });

    hostSocket!.disconnect();
    await disconnectPresencePromise;

    // Check session remains active even after host socket disconnect
    const checkActiveAfterDisconnect = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/active`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    const afterDisconnectData = await checkActiveAfterDisconnect.json();
    assert(afterDisconnectData?.session?.id === activeSession.id, 'Session remains active after host socket disconnect');
    assert(afterDisconnectData?.session?.endedAt === null, 'Session endedAt is still null after host socket disconnect');

    console.log('\n\x1b[34m[Test 6]\x1b[0m Host reconnects socket and re-joins live call...\n');
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: hostToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Host reconnect socket timeout')), 4000);
      hostSocket!.on('connect', () => {
        hostSocket!.emit('room:join', { roomId }, (ack: any) => {
          clearTimeout(timeout);
          assert(ack?.ok === true, 'Host reconnected and joined room channel');
          resolve();
        });
      });
    });

    const reconnectLivePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Presence timeout on second rejoin')), 4000);
      const listener = (data: any) => {
        if (data.roomId === roomId) {
          const hostEntry = data.presence?.find((p: any) => p.userId === hostUser.id);
          if (hostEntry && hostEntry.inLive === true) {
            clearTimeout(timeout);
            studentSocket!.off('presence:update', listener);
            resolve();
          }
        }
      };
      studentSocket!.on('presence:update', listener);
    });

    await new Promise<void>((resolve) => {
      hostSocket!.emit('live:joined', { roomId }, (ack: any) => {
        assert(ack?.ok === true, 'Host re-joined live call after reconnect');
        resolve();
      });
    });

    await reconnectLivePromise;
    assert(true, 'Student confirmed host presence is live again');

    console.log('\n\x1b[34m[Test 7]\x1b[0m Host explicitly ends session via POST .../end to confirm distinct lifecycle...\n');
    const endEventPromise = new Promise<{ roomId: string; sessionId: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('session:ended timeout')), 4000);
      studentSocket!.on('session:ended', (payload: any) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });

    const endRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/${activeSession.id}/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });

    assert(endRes.status === 200, 'Host explicitly ending session returns 200 OK');
    const endedEvent = await endEventPromise;
    assert(endedEvent.sessionId === activeSession.id, 'session:ended emitted only upon explicit end');

    const finalActiveRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/sessions/active`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    const finalActiveData = await finalActiveRes.json();
    assert(finalActiveData.session === null, 'Session is now null after explicit end');

  } catch (err: any) {
    console.error('\x1b[31m[Test Error]\x1b[0m', err);
    failedCount++;
  } finally {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (studentSocket?.connected) studentSocket.disconnect();

    await new Promise<void>((resolve) => {
      testServer.close(() => {
        console.log('\n[Test Server] Closed');
        resolve();
      });
    });

    console.log('\n============================================================');
    console.log(`Summary: ${passedCount} passed, ${failedCount} failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  }
}

runTests();
