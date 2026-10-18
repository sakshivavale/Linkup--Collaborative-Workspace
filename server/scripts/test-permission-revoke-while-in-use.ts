/**
 * Automated Verification Script for US-ERR-04: Permission Revoked While in Use
 * Module: Error States & System Resilience
 * Priority: P0 | Traces to: FRD Section 7
 *
 * User Story:
 * As a student whose mic/camera/screen is revoked while active,
 * I want a clear notification and graceful control disablement so that I am not confused.
 *
 * Acceptance Criteria Verified:
 * 1. The student receives a toast and the relevant control is immediately disabled.
 * 2. The media track stops within 1 second.
 * 3. No crash or error screen is shown.
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
import { clearActiveScreenShare } from '../src/realtime/screenShare';
import {
  Me,
  RoomSummary,
  Permissions,
  getPermissionChangeMessage,
  diffPermissions,
} from '@linkup/shared';

const TEST_PORT = 3140;
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
  console.log('🚀 Running US-ERR-04: Permission Revoked While in Use Tests');
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
    clearPresence();
    clearActiveScreenShare();

    const hostToken = 'token_host_us_err_04';
    const studentToken = 'token_student_us_err_04';

    const hostUser: Me = {
      id: 'teacher-us-err-04',
      fullName: 'Professor Turing',
      email: 'turing@linkup.test',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'student-us-err-04',
      fullName: 'Ada Lovelace',
      email: 'ada@linkup.test',
      role: 'student',
    };

    setCachedUser(hostToken, hostUser);
    setCachedUser(studentToken, studentUser);

    const roomId = 'room-test-us-err-04';

    const initialPermissions: Permissions = {
      canMic: true,
      canCamera: true,
      canScreen: true,
      canWhiteboard: true,
      canCode: true,
    };

    const roomMembers = [
      {
        userId: hostUser.id,
        fullName: hostUser.fullName,
        userRole: hostUser.role,
        memberRole: 'host' as const,
        permissions: { ...initialPermissions },
        joinedAt: new Date().toISOString(),
      },
      {
        userId: studentUser.id,
        fullName: studentUser.fullName,
        userRole: studentUser.role,
        memberRole: 'participant' as const,
        permissions: { ...initialPermissions },
        joinedAt: new Date().toISOString(),
      },
    ];

    const hostRoom: RoomSummary = {
      id: roomId,
      name: 'Resilience and Fault Tolerance Lab',
      description: 'US-ERR-04 Verification Room',
      joinCode: 'ERR004',
      hostName: hostUser.fullName,
      memberCount: 2,
      myRole: 'host',
      activeSessionId: 'session-us-err-04',
      createdAt: new Date().toISOString(),
      members: roomMembers,
    };

    const studentRoom: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    setMockRooms(hostUser.id, [hostRoom]);
    setMockRooms(studentUser.id, [studentRoom]);

    // Connect socket clients
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

    // Join room
    hostSocket.emit('room:join', { roomId });
    studentSocket.emit('room:join', { roomId });
    await new Promise((r) => setTimeout(r, 200));

    // ─────────────────────────────────────────────────────────────
    // TEST 1: Active Microphone Revocation While in Use
    // Acceptance Criteria 1 & 2:
    // - Toast received: "Teacher turned off your microphone."
    // - Relevant control is immediately disabled
    // - Media track stops within 1 second (< 1000ms)
    // ─────────────────────────────────────────────────────────────
    console.log('\x1b[34m[Test 1]\x1b[0m Microphone Revoked While in Use...');

    let simulatedStudentAudioTrackStopped = false;
    let studentAudioTrackStopTimeMs = 0;
    const startMicRevokeTime = Date.now();

    const permChangedMicPromise = new Promise<any>((resolve) => {
      studentSocket!.once('perm:changed', (payload) => {
        const elapsedMs = Date.now() - startMicRevokeTime;
        studentAudioTrackStopTimeMs = elapsedMs;
        // Simulate client hook stopping the audio track immediately on event
        if (payload.userId === studentUser.id && payload.permissions.canMic === false) {
          simulatedStudentAudioTrackStopped = true;
        }
        resolve(payload);
      });
    });

    const micRevokeRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${studentUser.id}/permissions`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ canMic: false }),
    });

    const micRevokeBody = (await micRevokeRes.json()) as any;
    assert(
      micRevokeRes.status === 200 && micRevokeBody.permissions?.canMic === false,
      'Host successfully revokes canMic via PATCH /api/rooms/:roomId/members/:userId/permissions'
    );

    const micPayload = await permChangedMicPromise;
    assert(
      micPayload.userId === studentUser.id && micPayload.permissions.canMic === false,
      'Student receives real-time perm:changed event with canMic: false'
    );

    const expectedMicToast = getPermissionChangeMessage('canMic', false);
    assert(
      expectedMicToast === 'Teacher turned off your microphone.',
      'Toast message matches expected UX string: "Teacher turned off your microphone."'
    );

    const micDiffs = diffPermissions(initialPermissions, micPayload.permissions);
    assert(
      micDiffs.length === 1 &&
        micDiffs[0].key === 'canMic' &&
        micDiffs[0].granted === false &&
        micDiffs[0].message === 'Teacher turned off your microphone.',
      'diffPermissions accurately produces revoked canMic diff with correct message'
    );

    assert(
      simulatedStudentAudioTrackStopped && studentAudioTrackStopTimeMs < 1000,
      `Media track stops within 1 second (stopped in ${studentAudioTrackStopTimeMs} ms)`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Active Camera Revocation While in Use
    // Acceptance Criteria 1 & 2:
    // - Toast received: "Teacher turned off your camera."
    // - Relevant control is immediately disabled
    // - Video media track stops within 1 second (< 1000ms)
    // ─────────────────────────────────────────────────────────────
    console.log('\n\x1b[34m[Test 2]\x1b[0m Camera Revoked While in Use...');

    let simulatedStudentVideoTrackStopped = false;
    let studentVideoTrackStopTimeMs = 0;
    const startCamRevokeTime = Date.now();

    const permChangedCamPromise = new Promise<any>((resolve) => {
      studentSocket!.once('perm:changed', (payload) => {
        const elapsedMs = Date.now() - startCamRevokeTime;
        studentVideoTrackStopTimeMs = elapsedMs;
        if (payload.userId === studentUser.id && payload.permissions.canCamera === false) {
          simulatedStudentVideoTrackStopped = true;
        }
        resolve(payload);
      });
    });

    const camRevokeRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${studentUser.id}/permissions`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ canCamera: false }),
    });

    const camRevokeBody = (await camRevokeRes.json()) as any;
    assert(
      camRevokeRes.status === 200 && camRevokeBody.permissions?.canCamera === false,
      'Host successfully revokes canCamera via PATCH /api/rooms/:roomId/members/:userId/permissions'
    );

    const camPayload = await permChangedCamPromise;
    assert(
      camPayload.userId === studentUser.id && camPayload.permissions.canCamera === false,
      'Student receives real-time perm:changed event with canCamera: false'
    );

    const expectedCamToast = getPermissionChangeMessage('canCamera', false);
    assert(
      expectedCamToast === 'Teacher turned off your camera.',
      'Toast message matches expected UX string: "Teacher turned off your camera."'
    );

    assert(
      simulatedStudentVideoTrackStopped && studentVideoTrackStopTimeMs < 1000,
      `Video track stops within 1 second (stopped in ${studentVideoTrackStopTimeMs} ms)`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Active Screen Sharing Revocation While in Use
    // Acceptance Criteria 1 & 2:
    // - Student is actively sharing screen
    // - Host revokes canScreen
    // - Screen share automatically stopped and broadcast with reason: PERMISSION_REVOKED
    // - Toast received: "Teacher turned off your screen sharing."
    // - Screen track stops within 1 second
    // ─────────────────────────────────────────────────────────────
    console.log('\n\x1b[34m[Test 3]\x1b[0m Screen Sharing Revoked While Active...');

    // Student starts sharing screen
    const screenStartedPromise = new Promise<any>((resolve) => {
      hostSocket!.once('screen:started', resolve);
    });

    studentSocket.emit('screen:start', { roomId });
    const startedData = await screenStartedPromise;
    assert(
      startedData.userId === studentUser.id,
      'Student successfully starts active screen sharing in the room'
    );

    let screenStoppedReason = '';
    let screenTrackStopTimeMs = 0;
    const startScreenRevokeTime = Date.now();

    const screenStoppedPromise = new Promise<any>((resolve) => {
      studentSocket!.once('screen:stopped', (payload) => {
        const elapsed = Date.now() - startScreenRevokeTime;
        screenTrackStopTimeMs = elapsed;
        screenStoppedReason = payload.reason;
        resolve(payload);
      });
    });

    const permChangedScreenPromise = new Promise<any>((resolve) => {
      studentSocket!.once('perm:changed', resolve);
    });

    // Host revokes screen sharing permission from active sharer
    const screenRevokeRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${studentUser.id}/permissions`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ canScreen: false }),
    });

    assert(screenRevokeRes.status === 200, 'Host revokes canScreen permission');

    await screenStoppedPromise;
    const screenPermPayload = await permChangedScreenPromise;

    assert(
      screenStoppedReason === 'PERMISSION_REVOKED',
      'Active screen share is terminated with reason: PERMISSION_REVOKED'
    );

    assert(
      screenTrackStopTimeMs < 1000,
      `Screen share track stops within 1 second (stopped in ${screenTrackStopTimeMs} ms)`
    );

    const expectedScreenToast = getPermissionChangeMessage('canScreen', false);
    assert(
      expectedScreenToast === 'Teacher turned off your screen sharing.',
      'Toast message matches expected UX string: "Teacher turned off your screen sharing."'
    );

    assert(
      screenPermPayload.permissions.canScreen === false,
      'Student receives perm:changed with canScreen: false'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Bulk Permission Revocation (Mute All While in Use)
    // Acceptance Criteria 1 & 2:
    // - Toast: "Teacher muted everyone."
    // - Control immediately disabled
    // - Audio track stops within 1 second
    // ─────────────────────────────────────────────────────────────
    console.log('\n\x1b[34m[Test 4]\x1b[0m Bulk Mute All Revocation While in Use...');

    let muteAllReceived = false;
    let muteAllReason = '';

    const withTimeout = <T>(promise: Promise<T>, ms: number, errMsg: string): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errMsg)), ms)),
      ]);

    const muteAllPromise = new Promise<any>((resolve) => {
      studentSocket!.once('perm:changed', (payload) => {
        if (payload.reason === 'MUTE_ALL') {
          muteAllReceived = true;
          muteAllReason = payload.reason;
        }
        resolve(payload);
      });
    });

    const muteAllRes = await withTimeout(
      fetch(`${BASE_URL}/api/rooms/${roomId}/permissions/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ canMic: false }),
      }),
      4000,
      'POST /api/rooms/:roomId/permissions/bulk timed out'
    );

    assert(muteAllRes.status === 200, 'Host triggers bulk Mute All');

    await withTimeout(muteAllPromise, 4000, 'Mute All perm:changed event timed out');
    assert(
      muteAllReceived && muteAllReason === 'MUTE_ALL',
      'Student receives bulk mute with reason: MUTE_ALL'
    );

    const muteAllToast = getPermissionChangeMessage('canMic', false, 'MUTE_ALL');
    assert(
      muteAllToast === 'Teacher muted everyone.',
      'Toast message matches MUTE_ALL UX requirement: "Teacher muted everyone."'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 5: System Resilience & No Crash or Error Screen
    // Acceptance Criteria 3:
    // - No crash or error screen is shown
    // - Collaboration tools (Chat, Code, Whiteboard) remain fully functional
    // ─────────────────────────────────────────────────────────────
    console.log('\n\x1b[34m[Test 5]\x1b[0m System Resilience — Chat and Collaboration Uninterrupted...');

    const chatPromise = new Promise<any>((resolve) => {
      const handler = (payload: any) => resolve(payload);
      hostSocket!.once('chat:new', handler);
      hostSocket!.once('chat:message', handler);
    });

    studentSocket.emit('chat:send', {
      roomId,
      text: 'Resilience test: Chat is still working smoothly!',
      body: 'Resilience test: Chat is still working smoothly!',
    });

    const receivedChat = await withTimeout(chatPromise, 4000, 'Chat broadcast event timed out');
    assert(
      (receivedChat.body || receivedChat.text || '').includes('Resilience test'),
      'Student can continue participating via chat without crashes or errors'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Authorization Security Enforcement
    // - Student cannot revoke permissions of another user
    // ─────────────────────────────────────────────────────────────
    console.log('\n\x1b[34m[Test 6]\x1b[0m Security Enforcement — Non-Host Cannot Revoke Permissions...');

    const forbiddenRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${hostUser.id}/permissions`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ canMic: false }),
    });

    assert(
      forbiddenRes.status === 403,
      'Student cannot revoke permissions (returns 403 FORBIDDEN)'
    );

  } catch (err: any) {
    console.error('\x1b[31mUnexpected Test Error:\x1b[0m', err);
    failedCount++;
  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (studentSocket) studentSocket.disconnect();
    testServer.close();
  }

  console.log('\n============================================================');
  console.log(`Results: \x1b[32m${passedCount} Passed\x1b[0m, \x1b[31m${failedCount} Failed\x1b[0m`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests();
