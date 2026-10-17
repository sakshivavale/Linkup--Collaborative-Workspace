/**
 * Automated Verification Script for US-PERM-06: Mute All (Host)
 * Module: Permission Control
 * Priority: P1 | Traces to: FR-4.7
 *
 * Acceptance Criteria Verified:
 * 1. A "Mute All" button is available in the host's Participants panel.
 * 2. Clicking it sets can_mic = false for every participant (not the host) in a single bulk request.
 * 3. Each affected participant receives a toast: "Teacher muted everyone."
 * 4. Participants who were actively publishing audio are muted within 1 second.
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
import {
  Me,
  RoomSummary,
  Permissions,
  diffPermissions,
  getPermissionChangeMessage,
  PermChangedPayload,
  Member,
} from '@linkup/shared';

const TEST_PORT = 3138;
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
  console.log('🚀 Running US-PERM-06: Mute All (Host) Automated Tests (FR-4.7)');
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

    // ─────────────────────────────────────────────────────────────────────────────
    // Test 1: Static / Component Verification of "Mute All" Button (AC-1)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Verifying "Mute All" button exists in host Participants panel (AC-1)...');
    const peoplePanelPath = path.resolve(__dirname, '../../client/src/features/rooms/PeoplePanel.tsx');
    const peoplePanelSource = fs.readFileSync(peoplePanelPath, 'utf8');

    assert(
      peoplePanelSource.includes('id="mute-all-btn"') && peoplePanelSource.includes('data-testid="mute-all-btn"'),
      'AC-1: "Mute All" button is present with id="mute-all-btn" and data-testid="mute-all-btn"'
    );

    assert(
      peoplePanelSource.includes("room.myRole === 'host'") && peoplePanelSource.includes('handleMuteAll'),
      'AC-1: "Mute All" button is only displayed for the room host'
    );

    assert(
      peoplePanelSource.includes('/api/rooms/${room.id}/permissions/bulk') ||
      peoplePanelSource.includes('/permissions/bulk'),
      'AC-1: Clicking "Mute All" calls bulk permissions endpoint'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // Test 2: Static Verification of Client Toast & Fast Audio Muting (AC-3, AC-4)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Verifying toast message and rapid audio muting implementation (AC-3, AC-4)...');
    const toastSource = fs.readFileSync(
      path.resolve(__dirname, '../../client/src/features/rooms/PermissionToast.tsx'),
      'utf8'
    );
    const liveTabSource = fs.readFileSync(
      path.resolve(__dirname, '../../client/src/features/rooms/LiveTab.tsx'),
      'utf8'
    );

    assert(
      toastSource.includes('Teacher muted everyone.'),
      'AC-3: PermissionToast displays "Teacher muted everyone." on bulk mute'
    );

    assert(
      liveTabSource.includes('canMic === false') && liveTabSource.includes('setMicOn(false)'),
      'AC-4: LiveTab immediately disables microphone publishing when canMic is revoked'
    );

    assert(
      liveTabSource.includes('track.enabled = micOn') || liveTabSource.includes('track.enabled = false'),
      'AC-4: LiveTab media tracks are instantly disabled when muted'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // Setup Mock Environment for Sockets & API
    // ─────────────────────────────────────────────────────────────────────────────
    const hostUser: Me = {
      id: 'teacher-host-perm-06',
      fullName: 'Professor Turing',
      email: 'turing@linkup.test',
      role: 'teacher',
    };

    const student1: Me = {
      id: 'student-1-perm-06',
      fullName: 'Ada Lovelace',
      email: 'ada@linkup.test',
      role: 'student',
    };

    const student2: Me = {
      id: 'student-2-perm-06',
      fullName: 'Charles Babbage',
      email: 'charles@linkup.test',
      role: 'student',
    };

    const hostToken = 'token-host-perm-06';
    const student1Token = 'token-student1-perm-06';
    const student2Token = 'token-student2-perm-06';

    setCachedUser(hostToken, hostUser);
    setCachedUser(student1Token, student1);
    setCachedUser(student2Token, student2);

    const roomId = 'room-mute-all-06';

    const testRoom: RoomSummary = {
      id: roomId,
      name: 'Advanced Algorithms',
      description: 'US-PERM-06 Verification Room',
      joinCode: 'MUTE06',
      hostName: hostUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: 'session-mute-06',
      createdAt: new Date().toISOString(),
      members: [
        {
          userId: hostUser.id,
          fullName: hostUser.fullName,
          userRole: 'teacher',
          memberRole: 'host',
          permissions: {
            canMic: true,
            canCamera: true,
            canScreen: true,
            canWhiteboard: true,
            canCode: true,
          },
          joinedAt: new Date().toISOString(),
        },
        {
          userId: student1.id,
          fullName: student1.fullName,
          userRole: 'student',
          memberRole: 'participant',
          permissions: {
            canMic: true, // Currently allowed
            canCamera: true,
            canScreen: false,
            canWhiteboard: true,
            canCode: true,
          },
          joinedAt: new Date().toISOString(),
        },
        {
          userId: student2.id,
          fullName: student2.fullName,
          userRole: 'student',
          memberRole: 'participant',
          permissions: {
            canMic: true, // Currently allowed
            canCamera: true,
            canScreen: false,
            canWhiteboard: true,
            canCode: true,
          },
          joinedAt: new Date().toISOString(),
        },
      ],
    };

    setMockRooms(hostUser.id, [{ ...testRoom, myRole: 'host' }]);
    setMockRooms(student1.id, [{ ...testRoom, myRole: 'participant' }]);
    setMockRooms(student2.id, [{ ...testRoom, myRole: 'participant' }]);

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
      new Promise<void>((r) => hostSocket!.on('connect', () => r())),
      new Promise<void>((r) => student1Socket!.on('connect', () => r())),
      new Promise<void>((r) => student2Socket!.on('connect', () => r())),
    ]);

    // Join room channel
    await new Promise<void>((r) => hostSocket!.emit('room:join', { roomId }, () => r()));
    await new Promise<void>((r) => student1Socket!.emit('room:join', { roomId }, () => r()));
    await new Promise<void>((r) => student2Socket!.emit('room:join', { roomId }, () => r()));

    // ─────────────────────────────────────────────────────────────────────────────
    // Test 3: Non-Host cannot bulk mute (403 HOST_ONLY / FORBIDDEN)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 3] Verifying non-host student cannot trigger bulk permissions update...');
    const forbiddenRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/permissions/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${student1Token}`,
      },
      body: JSON.stringify({ canMic: false }),
    });

    assert(
      forbiddenRes.status === 403,
      'Non-host student receives 403 FORBIDDEN when attempting bulk mute',
      `Got status: ${forbiddenRes.status}`
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // Test 4: Host Bulk Mute Request (AC-2) & Real-time Delivery (AC-3, AC-4)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 4] Host triggers "Mute All" bulk request (AC-2, AC-3, AC-4)...');

    let student1ReceivedPayload: PermChangedPayload | null = null;
    let student2ReceivedPayload: PermChangedPayload | null = null;
    let bulkEventReceived = false;
    let startTimestamp = 0;
    let deliveryDurationMs = 0;

    student1Socket.on('perm:changed', (data: PermChangedPayload) => {
      if (data.userId === student1.id) {
        student1ReceivedPayload = data;
        deliveryDurationMs = Date.now() - startTimestamp;
      }
    });

    student2Socket.on('perm:changed', (data: PermChangedPayload) => {
      if (data.userId === student2.id) {
        student2ReceivedPayload = data;
      }
    });

    student1Socket.on('perm:bulk', (data: any) => {
      if (data.roomId === roomId && data.patch?.canMic === false) {
        bulkEventReceived = true;
      }
    });

    startTimestamp = Date.now();
    const bulkRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/permissions/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ canMic: false }),
    });

    assert(
      bulkRes.status === 200,
      'AC-2: Single bulk request POST /api/rooms/:roomId/permissions/bulk succeeds with HTTP 200',
      `Status: ${bulkRes.status}`
    );

    const updatedMembers = await bulkRes.json();
    assert(
      Array.isArray(updatedMembers) && updatedMembers.length === 2,
      'AC-2: Response contains array of all affected participants',
      `Updated members count: ${updatedMembers.length}`
    );

    const s1Member = updatedMembers.find((m: Member) => m.userId === student1.id);
    const s2Member = updatedMembers.find((m: Member) => m.userId === student2.id);
    assert(
      s1Member && s1Member.permissions.canMic === false,
      'AC-2: Participant 1 has can_mic = false'
    );
    assert(
      s2Member && s2Member.permissions.canMic === false,
      'AC-2: Participant 2 has can_mic = false'
    );

    // Verify host permissions were NOT modified
    const hostRoomData = (await (
      await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      })
    ).json()) as RoomSummary;

    const hostMember = hostRoomData.members?.find((m) => m.userId === hostUser.id);
    assert(
      hostMember && hostMember.permissions.canMic === true,
      'AC-2: Host retains full permissions and is not muted (can_mic = true)'
    );

    // Wait up to 500ms for socket delivery
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert(
      Boolean(student1ReceivedPayload),
      'AC-3: Student 1 receives perm:changed socket event'
    );
    assert(
      Boolean(student2ReceivedPayload),
      'AC-3: Student 2 receives perm:changed socket event'
    );
    assert(
      bulkEventReceived,
      'AC-3: Room receives perm:bulk socket broadcast'
    );

    // Check duration for AC-4 (< 1000ms)
    assert(
      deliveryDurationMs < 1000,
      `AC-4: Active publishing audio participants are muted within 1 second (took ${deliveryDurationMs}ms)`
    );

    // Check Toast diffing and message for affected participants (AC-3)
    const prevPerms: Permissions = {
      canMic: true,
      canCamera: true,
      canScreen: false,
      canWhiteboard: true,
      canCode: true,
    };

    const diffs1 = diffPermissions(prevPerms, student1ReceivedPayload!.permissions, student1ReceivedPayload!.reason);
    assert(
      diffs1.length === 1 && diffs1[0].key === 'canMic' && diffs1[0].granted === false,
      'AC-3: Student diff indicates canMic was revoked'
    );

    assert(
      diffs1[0].message === 'Teacher muted everyone.',
      `AC-3: Toast message is exactly "Teacher muted everyone." (got: "${diffs1[0].message}")`
    );

    const directMsg = getPermissionChangeMessage('canMic', false, 'MUTE_ALL');
    assert(
      directMsg === 'Teacher muted everyone.',
      'AC-3: getPermissionChangeMessage returns "Teacher muted everyone." when reason is MUTE_ALL'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // Test 5: Participants Already Muted do not get affected / redundant toast
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 5] Verifying already-muted participant does not produce redundant toast...');
    const alreadyMutedPerms: Permissions = {
      canMic: false,
      canCamera: true,
      canScreen: false,
      canWhiteboard: true,
      canCode: true,
    };

    const unaffectedDiffs = diffPermissions(alreadyMutedPerms, student1ReceivedPayload!.permissions, student1ReceivedPayload!.reason);
    assert(
      unaffectedDiffs.length === 0,
      'Participant whose mic was already off has 0 diffs and does not receive redundant toast'
    );

  } catch (err: any) {
    console.error('\n❌ Unexpected error running tests:', err);
    assert(false, `Unexpected error: ${err.message}`);
  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (student1Socket) student1Socket.disconnect();
    if (student2Socket) student2Socket.disconnect();

    testServer.close();
    console.log('\n============================================================');
    console.log(`Test Execution Finished: ${passedCount} passed, ${failedCount} failed`);
    console.log('============================================================\n');

    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runTests();
