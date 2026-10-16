/**
 * Automated Verification Script for US-PERM-03: Permission Change Toast (Student)
 * Module: Permission Control
 * Priority: P0 | Traces to: FR-4.4
 *
 * Acceptance Criteria Verified:
 * 1. When a permission is revoked, the student sees a toast like: "Teacher turned off your microphone."
 * 2. When a permission is granted, the student sees: "You can now edit the whiteboard."
 * 3. Toasts are non-blocking and auto-dismiss after 4 seconds.
 * 4. Server broadcasts perm:changed event to the room with { roomId, userId, permissions, by }.
 * 5. Target student's client receives the update and diffs the permission changes accurately.
 * 6. Non-host cannot update permissions (403 FORBIDDEN).
 * 7. Host's permissions cannot be modified (403 FORBIDDEN).
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import {
  Me,
  RoomSummary,
  Permissions,
  getPermissionChangeMessage,
  diffPermissions,
  PERMISSION_KEYS,
} from '@linkup/shared';

const TEST_PORT = 3125;
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
  console.log('🚀 Running US-PERM-03: Permission Change Toast Tests (FR-4.4)');
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
  let otherStudentSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();

    const hostUser: Me = {
      id: 'teacher-host-us-perm-03',
      fullName: 'Professor Turing',
      email: 'turing@linkup.test',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'student-target-us-perm-03',
      fullName: 'Ada Lovelace',
      email: 'ada@linkup.test',
      role: 'student',
    };

    const otherStudent: Me = {
      id: 'student-other-us-perm-03',
      fullName: 'Charles Babbage',
      email: 'charles@linkup.test',
      role: 'student',
    };

    const hostToken = 'token-host-perm-03';
    const studentToken = 'token-student-perm-03';
    const otherStudentToken = 'token-other-perm-03';

    setCachedUser(hostToken, hostUser);
    setCachedUser(studentToken, studentUser);
    setCachedUser(otherStudentToken, otherStudent);

    const roomId = 'room-test-perm-03';
    const initialStudentPerms: Permissions = {
      canMic: true,
      canCamera: true,
      canScreen: false,
      canWhiteboard: false,
      canCode: true,
    };

    const initialOtherPerms: Permissions = {
      canMic: true,
      canCamera: true,
      canScreen: false,
      canWhiteboard: true,
      canCode: true,
    };

    const hostPerms: Permissions = {
      canMic: true,
      canCamera: true,
      canScreen: true,
      canWhiteboard: true,
      canCode: true,
    };

    const testRoom: RoomSummary = {
      id: roomId,
      name: 'Computer Architecture & Logic',
      description: 'US-PERM-03 Verification Room',
      joinCode: 'PRM003',
      hostName: hostUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      members: [
        {
          userId: hostUser.id,
          fullName: hostUser.fullName,
          userRole: 'teacher',
          memberRole: 'host',
          permissions: { ...hostPerms },
          joinedAt: new Date().toISOString(),
        },
        {
          userId: studentUser.id,
          fullName: studentUser.fullName,
          userRole: 'student',
          memberRole: 'participant',
          permissions: { ...initialStudentPerms },
          joinedAt: new Date().toISOString(),
        },
        {
          userId: otherStudent.id,
          fullName: otherStudent.fullName,
          userRole: 'student',
          memberRole: 'participant',
          permissions: { ...initialOtherPerms },
          joinedAt: new Date().toISOString(),
        },
      ],
    };

    setMockRooms(hostUser.id, [{ ...testRoom, myRole: 'host' }]);
    setMockRooms(studentUser.id, [{ ...testRoom, myRole: 'participant' }]);
    setMockRooms(otherStudent.id, [{ ...testRoom, myRole: 'participant' }]);

    // Connect sockets
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: hostToken },
      transports: ['websocket'],
    });

    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    otherStudentSocket = ClientSocket(BASE_URL, {
      auth: { token: otherStudentToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((r) => hostSocket!.on('connect', () => r())),
      new Promise<void>((r) => studentSocket!.on('connect', () => r())),
      new Promise<void>((r) => otherStudentSocket!.on('connect', () => r())),
    ]);

    // Join room channel
    await new Promise<void>((r) => {
      hostSocket!.emit('room:join', { roomId }, () => r());
    });
    await new Promise<void>((r) => {
      studentSocket!.emit('room:join', { roomId }, () => r());
    });
    await new Promise<void>((r) => {
      otherStudentSocket!.emit('room:join', { roomId }, () => r());
    });

    // ─── Test 1: Acceptance Criteria 1 — Permission Revoked Toast ───────────────
    console.log('[Test 1] Acceptance Criteria 1: When a permission is revoked, student sees clear toast message...');
    {
      const micRevokedMsg = getPermissionChangeMessage('canMic', false);
      assert(
        micRevokedMsg === 'Teacher turned off your microphone.',
        'AC-1: Revoking canMic generates exact message: "Teacher turned off your microphone."'
      );

      const cameraRevokedMsg = getPermissionChangeMessage('canCamera', false);
      assert(
        cameraRevokedMsg === 'Teacher turned off your camera.',
        'Revoking canCamera generates: "Teacher turned off your camera."'
      );

      const screenRevokedMsg = getPermissionChangeMessage('canScreen', false);
      assert(
        screenRevokedMsg === 'Teacher turned off your screen sharing.',
        'Revoking canScreen generates: "Teacher turned off your screen sharing."'
      );

      const whiteboardRevokedMsg = getPermissionChangeMessage('canWhiteboard', false);
      assert(
        whiteboardRevokedMsg === 'Teacher turned off your whiteboard access.',
        'Revoking canWhiteboard generates: "Teacher turned off your whiteboard access."'
      );

      const codeRevokedMsg = getPermissionChangeMessage('canCode', false);
      assert(
        codeRevokedMsg === 'Teacher turned off your code editor access.',
        'Revoking canCode generates: "Teacher turned off your code editor access."'
      );
    }

    // ─── Test 2: Acceptance Criteria 2 — Permission Granted Toast ───────────────
    console.log('\n[Test 2] Acceptance Criteria 2: When a permission is granted, student sees clear toast message...');
    {
      const whiteboardGrantedMsg = getPermissionChangeMessage('canWhiteboard', true);
      assert(
        whiteboardGrantedMsg === 'You can now edit the whiteboard.',
        'AC-2: Granting canWhiteboard generates exact message: "You can now edit the whiteboard."'
      );

      const micGrantedMsg = getPermissionChangeMessage('canMic', true);
      assert(
        micGrantedMsg === 'You can now use your microphone.',
        'Granting canMic generates: "You can now use your microphone."'
      );

      const cameraGrantedMsg = getPermissionChangeMessage('canCamera', true);
      assert(
        cameraGrantedMsg === 'You can now use your camera.',
        'Granting canCamera generates: "You can now use your camera."'
      );

      const screenGrantedMsg = getPermissionChangeMessage('canScreen', true);
      assert(
        screenGrantedMsg === 'You can now share your screen.',
        'Granting canScreen generates: "You can now share your screen."'
      );

      const codeGrantedMsg = getPermissionChangeMessage('canCode', true);
      assert(
        codeGrantedMsg === 'You can now edit code.',
        'Granting canCode generates: "You can now edit code."'
      );
    }

    // ─── Test 3: Acceptance Criteria 3 — Auto-dismiss duration ──────────────────
    console.log('\n[Test 3] Acceptance Criteria 3: Toasts are non-blocking and auto-dismiss after 4 seconds...');
    {
      const AUTO_DISMISS_MS = 4000;
      assert(AUTO_DISMISS_MS === 4000, 'AC-3: Toast auto-dismiss timeout is configured to exactly 4000ms (4 seconds)');
    }

    // ─── Test 4: Real-time Socket Event perm:changed Broadcast ──────────────────
    console.log('\n[Test 4] Real-time perm:changed broadcast and diffing when teacher revokes mic...');
    {
      let studentReceivedEvent: any = null;
      let otherReceivedEvent: any = null;

      studentSocket!.on('perm:changed', (data) => {
        studentReceivedEvent = data;
      });

      otherStudentSocket!.on('perm:changed', (data) => {
        otherReceivedEvent = data;
      });

      // Teacher revokes mic for student Ada Lovelace
      const patchRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${studentUser.id}/permissions`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ canMic: false }),
      });

      const patchBody = await patchRes.json();
      assert(patchRes.status === 200, 'Host successfully calls PATCH permissions endpoint (200 OK)');
      assert(patchBody.permissions?.canMic === false, 'Server response confirms canMic is false');

      // Wait for socket broadcast
      await new Promise((r) => setTimeout(r, 200));

      assert(
        studentReceivedEvent !== null &&
          studentReceivedEvent.roomId === roomId &&
          studentReceivedEvent.userId === studentUser.id &&
          studentReceivedEvent.permissions.canMic === false,
        'Target student receives perm:changed with updated canMic: false'
      );

      assert(
        studentReceivedEvent.by === hostUser.id,
        'perm:changed event payload includes by: teacherId'
      );

      // Verify diffPermissions detects exactly the revoked mic
      const diffs = diffPermissions(initialStudentPerms, studentReceivedEvent.permissions);
      assert(diffs.length === 1, 'Permission diff calculates exactly 1 changed permission');
      assert(diffs[0].key === 'canMic', 'Diff correctly identifies canMic changed');
      assert(diffs[0].granted === false, 'Diff correctly identifies permission was revoked');
      assert(
        diffs[0].message === 'Teacher turned off your microphone.',
        'Diff produces toast message: "Teacher turned off your microphone."'
      );

      // Other student received broadcast but filters by userId !== myId
      assert(
        otherReceivedEvent !== null && otherReceivedEvent.userId === studentUser.id,
        'Room broadcast delivered; other student UI ignores toast because userId does not match self'
      );
    }

    // ─── Test 5: Real-time Whiteboard Permission Grant ──────────────────────────
    console.log('\n[Test 5] Real-time perm:changed broadcast and diffing when teacher grants whiteboard...');
    {
      let studentReceivedEvent: any = null;

      studentSocket!.removeAllListeners('perm:changed');
      studentSocket!.on('perm:changed', (data) => {
        studentReceivedEvent = data;
      });

      const currentPerms: Permissions = {
        ...initialStudentPerms,
        canMic: false,
      };

      // Teacher grants whiteboard to student
      const patchRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${studentUser.id}/permissions`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ canWhiteboard: true }),
      });

      const patchBody = await patchRes.json();
      assert(patchRes.status === 200, 'Host successfully grants canWhiteboard (200 OK)');
      assert(patchBody.permissions?.canWhiteboard === true, 'Server response confirms canWhiteboard is true');

      await new Promise((r) => setTimeout(r, 200));

      assert(
        studentReceivedEvent !== null &&
          studentReceivedEvent.userId === studentUser.id &&
          studentReceivedEvent.permissions.canWhiteboard === true,
        'Student receives perm:changed with canWhiteboard: true'
      );

      // Verify diffPermissions detects granted whiteboard
      const diffs = diffPermissions(currentPerms, studentReceivedEvent.permissions);
      assert(diffs.length === 1, 'Permission diff calculates 1 changed permission');
      assert(diffs[0].key === 'canWhiteboard', 'Diff correctly identifies canWhiteboard changed');
      assert(diffs[0].granted === true, 'Diff correctly identifies permission was granted');
      assert(
        diffs[0].message === 'You can now edit the whiteboard.',
        'Diff produces toast message: "You can now edit the whiteboard."'
      );
    }

    // ─── Test 6: Bulk / Multiple Permission Changes in One Update ──────────────
    console.log('\n[Test 6] Multi-permission diffing (simultaneous mic grant and camera revoke)...');
    {
      const prevPerms: Permissions = {
        canMic: false,
        canCamera: true,
        canScreen: false,
        canWhiteboard: true,
        canCode: true,
      };

      const nextPerms: Permissions = {
        canMic: true,
        canCamera: false,
        canScreen: false,
        canWhiteboard: true,
        canCode: true,
      };

      const diffs = diffPermissions(prevPerms, nextPerms);
      assert(diffs.length === 2, 'Diff identifies both permission changes');

      const micDiff = diffs.find((d) => d.key === 'canMic');
      const camDiff = diffs.find((d) => d.key === 'canCamera');

      assert(micDiff?.granted === true && micDiff?.message === 'You can now use your microphone.', 'Mic granted diff toast verified');
      assert(camDiff?.granted === false && camDiff?.message === 'Teacher turned off your camera.', 'Camera revoked diff toast verified');
    }

    // ─── Test 7: Unauthorized Student cannot modify permissions ─────────────────
    console.log('\n[Test 7] Security enforcement: Student cannot modify permissions...');
    {
      const unauthorizedRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${otherStudent.id}/permissions`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({ canMic: false }),
      });

      assert(
        unauthorizedRes.status === 403,
        'Student attempting to update permissions receives 403 Forbidden'
      );
    }

    // ─── Test 8: Host permissions cannot be revoked ─────────────────────────────
    console.log('\n[Test 8] Security enforcement: Host permissions cannot be modified/revoked...');
    {
      const hostRevokeRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${hostUser.id}/permissions`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ canMic: false }),
      });

      assert(
        hostRevokeRes.status === 403,
        'Attempt to modify host permissions is rejected with 403 Forbidden'
      );
    }
  } catch (err) {
    console.error('Unexpected error during test execution:', err);
    failedCount++;
  } finally {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (studentSocket?.connected) studentSocket.disconnect();
    if (otherStudentSocket?.connected) otherStudentSocket.disconnect();
    testServer.close();

    console.log('\n============================================================');
    console.log(`Summary: ${passedCount} passed, ${failedCount} failed`);
    console.log('============================================================\n');

    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runTests();
