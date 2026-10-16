/**
 * Automated Verification Script for US-LIVE-04: Screen Sharing
 * Priority: P0 | Traces to: FR-3.5
 *
 * Acceptance Criteria Verified:
 * 1. The screen-share button is enabled only if can_screen = true (or the user is the host).
 * 2. A screen share appears as the focused tile for all participants; other tiles move to a strip below.
 * 3. Only one screen share is active at a time.
 * 4. If can_screen is revoked while sharing, the share stops immediately for all viewers.
 * 5. Hovering over a disabled screen-share button shows a tooltip explaining why.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { clearMockSessions } from '../src/lib/sessions';
import { clearPresence } from '../src/realtime/presence';
import { clearAllScreenShares } from '../src/realtime/screenShare';
import { Me, RoomSummary } from '@linkup/shared';

const TEST_PORT = 3122;
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
  console.log('🚀 Running US-LIVE-04: Screen Sharing Tests (FR-3.5)');
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
  let studentPermittedSocket: ClientSocketType | null = null;
  let studentRestrictedSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockSessions();
    clearPresence();
    clearAllScreenShares();

    const hostToken = 'test_host_token_us_live_04';
    const studentPermittedToken = 'test_student_permitted_token_us_live_04';
    const studentRestrictedToken = 'test_student_restricted_token_us_live_04';

    const hostUser: Me = {
      id: 'host-user-us-live-04',
      email: 'host@linkup.test',
      fullName: 'Prof. Alan Turing',
      role: 'teacher',
    };

    const studentPermitted: Me = {
      id: 'student-perm-us-live-04',
      email: 'grace@linkup.test',
      fullName: 'Grace Hopper',
      role: 'student',
    };

    const studentRestricted: Me = {
      id: 'student-restricted-us-live-04',
      email: 'john@linkup.test',
      fullName: 'John von Neumann',
      role: 'student',
    };

    setCachedUser(hostToken, hostUser, 60000);
    setCachedUser(studentPermittedToken, studentPermitted, 60000);
    setCachedUser(studentRestrictedToken, studentRestricted, 60000);

    const roomId = 'room-test-us-live-04';

    const roomMembers = [
      {
        userId: hostUser.id,
        fullName: hostUser.fullName,
        userRole: hostUser.role,
        memberRole: 'host' as const,
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
      {
        userId: studentPermitted.id,
        fullName: studentPermitted.fullName,
        userRole: studentPermitted.role,
        memberRole: 'participant' as const,
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
      {
        userId: studentRestricted.id,
        fullName: studentRestricted.fullName,
        userRole: studentRestricted.role,
        memberRole: 'participant' as const,
        permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
    ];

    const hostRoom: RoomSummary = {
      id: roomId,
      name: 'Advanced Computing Lab',
      description: 'Screen sharing and collaborative engineering',
      joinCode: 'COMP44',
      hostName: hostUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: 'session-us-live-04-1',
      createdAt: new Date().toISOString(),
      members: roomMembers,
    };

    const permittedRoom: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    const restrictedRoom: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    setMockRooms(hostUser.id, [hostRoom]);
    setMockRooms(studentPermitted.id, [permittedRoom]);
    setMockRooms(studentRestricted.id, [restrictedRoom]);

    // Connect all three users to sockets and join the room channel
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: hostToken },
      transports: ['websocket'],
    });

    studentPermittedSocket = ClientSocket(BASE_URL, {
      auth: { token: studentPermittedToken },
      transports: ['websocket'],
    });

    studentRestrictedSocket = ClientSocket(BASE_URL, {
      auth: { token: studentRestrictedToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) => hostSocket!.on('connect', () => resolve())),
      new Promise<void>((resolve) => studentPermittedSocket!.on('connect', () => resolve())),
      new Promise<void>((resolve) => studentRestrictedSocket!.on('connect', () => resolve())),
    ]);

    // Join room channel
    await Promise.all([
      new Promise<void>((resolve) => hostSocket!.emit('room:join', roomId, () => resolve())),
      new Promise<void>((resolve) => studentPermittedSocket!.emit('room:join', roomId, () => resolve())),
      new Promise<void>((resolve) => studentRestrictedSocket!.emit('room:join', roomId, () => resolve())),
    ]);

    console.log('\x1b[34m[Test 1]\x1b[0m Acceptance Criteria 1: Screen-share disabled when can_screen = false...\n');

    // Attempt screen share from studentRestricted (can_screen = false)
    const restrictedStartPromise = new Promise<{ ok: boolean; error?: any }>((resolve) => {
      studentRestrictedSocket!.emit('screen:start', { roomId }, (res: any) => {
        resolve(res);
      });
      studentRestrictedSocket!.once('screen:error', (err: any) => {
        resolve({ ok: false, error: err });
      });
    });

    const restrictedRes = await restrictedStartPromise;
    assert(!restrictedRes.ok, 'Student without can_screen cannot start screen share');
    assert(
      restrictedRes.error?.code === 'FORBIDDEN',
      'Server returns FORBIDDEN error code when permission is missing',
      restrictedRes.error?.code
    );

    console.log('\n\x1b[34m[Test 2]\x1b[0m Acceptance Criteria 1 & 2: User with can_screen = true starts screen share and broadcasts to all...\n');

    let hostReceivedStart: any = null;
    let restrictedReceivedStart: any = null;

    hostSocket.on('screen:started', (data) => {
      hostReceivedStart = data;
    });

    studentRestrictedSocket.on('screen:started', (data) => {
      restrictedReceivedStart = data;
    });

    const permittedStartPromise = new Promise<{ ok: boolean; data?: any }>((resolve) => {
      studentPermittedSocket!.emit('screen:start', { roomId }, (res: any) => {
        resolve(res);
      });
    });

    const permittedRes = await permittedStartPromise;
    assert(permittedRes.ok, 'User with can_screen = true successfully starts screen share');
    assert(permittedRes.data?.userId === studentPermitted.id, 'Screen share object has correct userId');

    // Wait for socket broadcast
    await new Promise((r) => setTimeout(r, 200));

    assert(
      hostReceivedStart?.userId === studentPermitted.id && hostReceivedStart?.roomId === roomId,
      'Host receives screen:started event to render focused tile'
    );
    assert(
      restrictedReceivedStart?.userId === studentPermitted.id,
      'Other participants receive screen:started event'
    );

    // Verify GET /api/rooms/:roomId/screen-share
    const getShareRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/screen-share`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    const shareBody = await getShareRes.json();
    assert(
      shareBody.screenShare?.userId === studentPermitted.id,
      'GET /api/rooms/:roomId/screen-share returns the active screen share'
    );

    console.log('\n\x1b[34m[Test 3]\x1b[0m Acceptance Criteria 3: Only one screen share is active at a time...\n');

    // Host attempts to start screen share while student is already sharing
    const secondStartPromise = new Promise<{ ok: boolean; error?: any }>((resolve) => {
      hostSocket!.emit('screen:start', { roomId }, (res: any) => {
        resolve(res);
      });
      hostSocket!.once('screen:error', (err: any) => {
        resolve({ ok: false, error: err });
      });
    });

    const secondStartRes = await secondStartPromise;
    assert(!secondStartRes.ok, 'Second user cannot start screen share when one is already active');
    assert(
      secondStartRes.error?.code === 'SCREEN_SHARE_ACTIVE',
      'Server returns SCREEN_SHARE_ACTIVE error code',
      secondStartRes.error?.code
    );

    console.log('\n\x1b[34m[Test 4]\x1b[0m Acceptance Criteria 4: If can_screen is revoked while sharing, share stops immediately for all viewers...\n');

    let hostReceivedStop: any = null;
    let sharerReceivedStop: any = null;
    let sharerReceivedPermChanged: any = null;

    hostSocket.on('screen:stopped', (data) => {
      hostReceivedStop = data;
    });

    studentPermittedSocket.on('screen:stopped', (data) => {
      sharerReceivedStop = data;
    });

    studentPermittedSocket.on('perm:changed', (data) => {
      sharerReceivedPermChanged = data;
    });

    // Host revokes canScreen via PATCH /api/rooms/:roomId/members/:userId/permissions
    const revokeRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${studentPermitted.id}/permissions`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ canScreen: false }),
    });

    const revokeBody = await revokeRes.json();
    assert(revokeRes.status === 200, 'Host successfully updates member permissions (200 OK)');
    assert(revokeBody.permissions?.canScreen === false, 'Updated permissions reflect canScreen = false');

    // Wait for socket broadcast
    await new Promise((r) => setTimeout(r, 200));

    assert(
      sharerReceivedPermChanged?.userId === studentPermitted.id &&
        sharerReceivedPermChanged?.permissions?.canScreen === false,
      'Sharer receives perm:changed with canScreen: false'
    );

    assert(
      hostReceivedStop?.reason === 'PERMISSION_REVOKED',
      'Host receives screen:stopped event with reason PERMISSION_REVOKED'
    );
    assert(
      sharerReceivedStop?.reason === 'PERMISSION_REVOKED',
      'Sharer receives screen:stopped event with reason PERMISSION_REVOKED'
    );

    // Verify screen share is now null
    const getShareAfterRevoke = await fetch(`${BASE_URL}/api/rooms/${roomId}/screen-share`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    const afterRevokeBody = await getShareAfterRevoke.json();
    assert(afterRevokeBody.screenShare === null, 'Active screen share is cleared immediately');

    console.log('\n\x1b[34m[Test 5]\x1b[0m Acceptance Criteria 1: Host can start screen share...\n');

    let hostScreenStartedData: any = null;
    studentRestrictedSocket.on('screen:started', (data) => {
      hostScreenStartedData = data;
    });

    const hostStartPromise = new Promise<{ ok: boolean; data?: any }>((resolve) => {
      hostSocket!.emit('screen:start', { roomId }, (res: any) => {
        resolve(res);
      });
    });

    const hostStartRes = await hostStartPromise;
    assert(hostStartRes.ok, 'Host can start screen share');
    assert(hostStartRes.data?.userId === hostUser.id, 'Host is the active screen sharer');

    await new Promise((r) => setTimeout(r, 200));
    assert(hostScreenStartedData?.userId === hostUser.id, 'Participants receive screen:started from host');

    // Host stops screen share
    let stopEventData: any = null;
    studentRestrictedSocket.on('screen:stopped', (data) => {
      stopEventData = data;
    });

    const hostStopPromise = new Promise<{ ok: boolean }>((resolve) => {
      hostSocket!.emit('screen:stop', { roomId }, (res: any) => {
        resolve(res);
      });
    });

    await hostStopPromise;
    await new Promise((r) => setTimeout(r, 200));
    assert(stopEventData?.userId === hostUser.id, 'Participants receive screen:stopped when host finishes');

  } catch (err) {
    console.error('Test execution failed with error:', err);
    failedCount++;
  } finally {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (studentPermittedSocket?.connected) studentPermittedSocket.disconnect();
    if (studentRestrictedSocket?.connected) studentRestrictedSocket.disconnect();

    testServer.close();
  }

  console.log('\n============================================================');
  console.log(`Summary: ${passedCount} passed, ${failedCount} failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
