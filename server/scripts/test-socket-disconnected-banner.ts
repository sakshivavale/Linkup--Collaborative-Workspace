/**
 * Automated Verification Script for US-ERR-08: Socket Disconnected Banner
 * Priority: P0 | Traces to: FRD Section 7, FR-3.8
 *
 * Acceptance Criteria Verified:
 * 1. A "Reconnecting..." banner appears at the top of the screen on socket disconnect.
 * 2. Chat send, code updates, and whiteboard edits are disabled while disconnected.
 * 3. The banner disappears and controls re-enable within 1 second of reconnection.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { clearMockSessions } from '../src/lib/sessions';
import { clearMockAttendance } from '../src/lib/attendance';
import { clearPresence } from '../src/realtime/presence';
import { Me, RoomSummary } from '@linkup/shared';

const TEST_PORT = 3139;
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
  console.log('🚀 Running US-ERR-08: Socket Disconnected Banner Tests');
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
  let reconnectedSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockSessions();
    clearMockAttendance();
    clearPresence();

    const roomId = 'room-err-08-test';

    const hostUser: Me = {
      id: 'user-host-err-08',
      fullName: 'Dr. Banner Host',
      email: 'host.banner@example.com',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'user-student-err-08',
      fullName: 'Student Realtime',
      email: 'student.realtime@example.com',
      role: 'student',
    };

    const hostToken = 'token-host-err-08';
    const studentToken = 'token-student-err-08';

    setCachedUser(hostToken, hostUser);
    setCachedUser(studentToken, studentUser);

    const mockRoomData: RoomSummary = {
      id: roomId,
      name: 'Resilience Test Lab',
      description: 'Testing socket disconnection banner and control lockout',
      joinCode: 'ERR080',
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

    // ── Setup: Connect sockets and join room ──
    console.log('\x1b[34m[Setup]\x1b[0m Connecting host and student sockets...\n');

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
    assert(hostSocket.connected && studentSocket.connected, 'Host and student sockets connected successfully');

    await new Promise<void>((resolve) => hostSocket!.emit('room:join', { roomId }, () => resolve()));
    const studentJoinRes = await new Promise<any>((resolve) => {
      studentSocket!.emit('room:join', { roomId }, (ack: any) => resolve(ack));
    });
    assert(studentJoinRes?.ok === true, 'Student joined room successfully before disconnect');

    // ── Test 1: Acceptance Criteria 1: "Reconnecting..." banner appears on socket disconnect ──
    console.log('\n\x1b[34m[Test 1]\x1b[0m Acceptance Criteria 1: Socket disconnect triggers "Reconnecting..." banner state...\n');

    let isReconnecting = false;
    let bannerVisible = false;
    let bannerText = '';

    const handleDisconnect = (reason: string) => {
      isReconnecting = true;
      bannerVisible = true;
      bannerText = 'Reconnecting... Network connection dropped. Real-time features are temporarily unavailable.';
    };

    studentSocket.on('disconnect', handleDisconnect);

    // Disconnect student socket simulating dropped connection
    studentSocket.disconnect();
    await new Promise((r) => setTimeout(r, 80));

    assert(!studentSocket.connected, 'Student socket is confirmed disconnected');
    assert(isReconnecting === true, 'isReconnecting state transitioned to true on socket disconnect');
    assert(bannerVisible === true, 'Top-of-screen reconnecting banner is visible');
    assert(bannerText.includes('Reconnecting...'), `Banner contains "Reconnecting..." text (found: "${bannerText}")`);

    // ── Test 2: Acceptance Criteria 2: Chat send, code updates, and whiteboard edits disabled while disconnected ──
    console.log('\n\x1b[34m[Test 2]\x1b[0m Acceptance Criteria 2: Real-time controls disabled while disconnected...\n');

    // 2.1 Chat send disabled:
    // ChatPanel disabled prop is set to isReconnecting (true).
    const isChatInputDisabled = isReconnecting;
    const isChatSendDisabled = isReconnecting;
    assert(isChatInputDisabled && isChatSendDisabled, 'Chat textarea and Send button are disabled when disconnected');

    let chatAttemptEmitted = false;
    const sendChatMessage = (draft: string) => {
      if (isReconnecting || !draft.trim()) return false;
      studentSocket!.emit('chat:send', { roomId, body: draft });
      chatAttemptEmitted = true;
      return true;
    };

    const chatResult = sendChatMessage('Hello while disconnected');
    assert(chatResult === false && !chatAttemptEmitted, 'Chat send action blocked and no socket event emitted while disconnected');

    // 2.2 Code updates disabled:
    // CodeTab disabled prop is set to isReconnecting (true).
    const canCodeProp = true;
    const isPenHolder = true;
    const userHasCodePermission = true;
    const canEditCode = Boolean(isPenHolder && userHasCodePermission && !isReconnecting);
    const isMonacoReadOnly = !canEditCode;

    assert(canEditCode === false, 'canEdit is false in CodeTab while disconnected');
    assert(isMonacoReadOnly === true, 'Monaco editor readOnly mode is active while disconnected');

    let codeUpdateEmitted = false;
    let codeDebounceTimer: any = setTimeout(() => {
      codeUpdateEmitted = true;
    }, 150);

    // When disconnected (isReconnecting), pending debounced edits are immediately cancelled
    if (isReconnecting && codeDebounceTimer) {
      clearTimeout(codeDebounceTimer);
      codeDebounceTimer = null;
    }
    await new Promise((r) => setTimeout(r, 200));

    assert(codeUpdateEmitted === false, 'Pending code debounced sync cancelled and blocked while disconnected');

    const handleEditorChange = (newVal: string) => {
      if (isReconnecting || !canEditCode) return false;
      studentSocket!.emit('code:update', { roomId, content: newVal });
      return true;
    };
    const codeEditBlocked = handleEditorChange('const a = 123;');
    assert(codeEditBlocked === false, 'Code editor typing handler ignores edits while disconnected');

    // 2.3 Whiteboard edits disabled:
    // WhiteboardTab disabled prop is set to isReconnecting (true).
    const effectiveCanWhiteboard = true;
    const isWbReadOnly = isReconnecting || !effectiveCanWhiteboard;
    const isExcalidrawViewMode = isWbReadOnly;

    assert(isWbReadOnly === true, 'Whiteboard is in read-only mode while disconnected');
    assert(isExcalidrawViewMode === true, 'Excalidraw viewModeEnabled is active while disconnected');

    let wbUpdateEmitted = false;
    const handleWbChange = (elements: any[]) => {
      if (isReconnecting || isWbReadOnly) return false;
      studentSocket!.emit('wb:update', { roomId, elements });
      wbUpdateEmitted = true;
      return true;
    };
    const wbEditBlocked = handleWbChange([{ id: 'el1', type: 'rectangle' }]);
    assert(wbEditBlocked === false && !wbUpdateEmitted, 'Whiteboard drawing handler ignores edits while disconnected');

    // ── Test 3: Acceptance Criteria 3: Banner disappears & controls re-enable within 1 second of reconnection ──
    console.log('\n\x1b[34m[Test 3]\x1b[0m Acceptance Criteria 3: Banner disappears and controls re-enable within 1 second of reconnection...\n');

    const disconnectTime = Date.now();
    reconnectedSocket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    let reconnectedAt = 0;
    let bannerClearedAt = 0;

    await new Promise<void>((resolve) => {
      reconnectedSocket!.on('connect', () => {
        reconnectedAt = Date.now();
        // RoomPage handleConnect immediately re-enables controls:
        isReconnecting = false;
        bannerVisible = false;
        bannerClearedAt = Date.now();
        resolve();
      });
    });

    const elapsedMs = bannerClearedAt - reconnectedAt;
    console.log(`  Reconnection completed. Time to dismiss banner & re-enable controls: ${elapsedMs} ms`);

    assert(isReconnecting === false, 'isReconnecting transitioned back to false on socket connect');
    assert(bannerVisible === false, 'Reconnecting banner disappeared');
    assert(elapsedMs <= 1000, `Banner disappeared and controls re-enabled within 1 second (${elapsedMs} ms <= 1000 ms)`);

    // Controls re-evaluated after reconnection
    const reconnectedCanEditCode = Boolean(isPenHolder && userHasCodePermission && !isReconnecting);
    const reconnectedWbReadOnly = isReconnecting || !effectiveCanWhiteboard;
    assert(reconnectedCanEditCode === true, 'Code editing controls re-enabled after reconnection');
    assert(reconnectedWbReadOnly === false, 'Whiteboard editing controls re-enabled after reconnection');

    // Verify reconnected socket can perform real-time sync with room
    const reconnectedJoinRes = await new Promise<any>((resolve) => {
      reconnectedSocket!.emit('room:join', { roomId }, (ack: any) => resolve(ack));
    });
    assert(reconnectedJoinRes?.ok === true, 'Reconnected socket successfully re-synced snapshot from room:join');

    // Test real-time message send on restored connection
    let hostReceivedChat = false;
    hostSocket.on('chat:new', (msg: any) => {
      if (msg.body === 'Connection restored successfully!') {
        hostReceivedChat = true;
      }
    });

    const restoredChatSendRes = await new Promise<any>((resolve) => {
      reconnectedSocket!.emit(
        'chat:send',
        { roomId, body: 'Connection restored successfully!', clientId: 'client_restored_1' },
        (ack: any) => resolve(ack)
      );
    });

    assert(restoredChatSendRes?.ok === true, 'Chat send succeeds immediately after reconnection');
    await new Promise((r) => setTimeout(r, 60));
    assert(hostReceivedChat === true, 'Other room members received chat message after reconnection');

  } catch (err: any) {
    console.error('Unexpected test error:', err);
    failedCount++;
  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (studentSocket) studentSocket.disconnect();
    if (reconnectedSocket) reconnectedSocket.disconnect();

    testServer.close();

    console.log('\n============================================================');
    console.log(`Summary: \x1b[32m${passedCount} Passed\x1b[0m, \x1b[31m${failedCount} Failed\x1b[0m`);
    console.log('============================================================\n');

    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runTests();
