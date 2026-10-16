/**
 * Automated Verification Script for US-CHAT-02: View Chat History
 * Module: Chat
 * Priority: P0 | Traces to: FR-3.12
 *
 * Acceptance Criteria Verified:
 * 1. Opening the room loads the last 50 messages (newest at the bottom).
 * 2. Scrolling to the top loads the next 50 older messages (cursor pagination via before query param).
 * 3. A "Loading..." indicator is shown during fetch.
 * 4. A "No more messages" indicator is shown when hasMore = false.
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
import { setMockMessages, clearMockMessages, getMockMessages } from '../src/lib/chat';
import { Me, RoomSummary, ChatMessage } from '@linkup/shared';

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
  console.log('🚀 Running US-CHAT-02: View Chat History Tests (FR-3.12)');
  console.log('============================================================\n');

  const testServer = http.createServer(app);
  io.attach(testServer);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  let memberSocket: ClientSocketType | null = null;
  let otherMemberSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockMessages();

    const teacherToken = 'test_teacher_token_chat_02';
    const studentToken = 'test_student_token_chat_02';
    const nonMemberToken = 'test_nonmember_token_chat_02';

    const teacherUser: Me = {
      id: 'teacher-user-chat-02',
      email: 'teacher@linkup.test',
      fullName: 'Prof. Ada Lovelace',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'student-user-chat-02',
      email: 'student@linkup.test',
      fullName: 'Charles Babbage',
      role: 'student',
    };

    const nonMemberUser: Me = {
      id: 'nonmember-user-chat-02',
      email: 'stranger@linkup.test',
      fullName: 'Random User',
      role: 'student',
    };

    setCachedUser(teacherToken, teacherUser, 60000);
    setCachedUser(studentToken, studentUser, 60000);
    setCachedUser(nonMemberToken, nonMemberUser, 60000);

    const roomId = 'room-chat-history-test';

    const roomMembers = [
      {
        userId: teacherUser.id,
        fullName: teacherUser.fullName,
        userRole: 'teacher' as const,
        memberRole: 'host' as const,
        permissions: {
          canMic: true,
          canCamera: true,
          canScreen: true,
          canWhiteboard: true,
          canCode: true,
        },
        joinedAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        userId: studentUser.id,
        fullName: studentUser.fullName,
        userRole: 'student' as const,
        memberRole: 'participant' as const,
        permissions: {
          canMic: true,
          canCamera: true,
          canScreen: false,
          canWhiteboard: true,
          canCode: true,
        },
        joinedAt: new Date(Date.now() - 1800000).toISOString(),
      },
    ];

    const testRoom: RoomSummary = {
      id: roomId,
      name: 'Computer Architecture Discussion',
      description: 'Room for chat history testing',
      joinCode: 'CHAT02',
      hostName: teacherUser.fullName,
      memberCount: 2,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      members: roomMembers,
    };

    setMockRooms(teacherUser.id, [testRoom]);
    setMockRooms(studentUser.id, [{ ...testRoom, myRole: 'participant' }]);

    // Seed 75 messages spanning over several hours
    // (Message 1 is oldest, Message 75 is newest)
    const baseTime = Date.now() - 75 * 60 * 1000;
    const initialMessages: ChatMessage[] = [];
    for (let i = 1; i <= 75; i++) {
      const isTeacher = i % 2 === 1;
      initialMessages.push({
        id: 1000 + i,
        roomId,
        senderId: isTeacher ? teacherUser.id : studentUser.id,
        senderName: isTeacher ? teacherUser.fullName : studentUser.fullName,
        senderRole: isTeacher ? 'teacher' : 'student',
        body: `Test message #${i} in room`,
        createdAt: new Date(baseTime + i * 60 * 1000).toISOString(),
      });
    }
    setMockMessages(roomId, initialMessages);

    console.log('--- Criterion 1: Opening the room loads the last 50 messages (newest at the bottom) ---');
    {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}/messages?limit=50`, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      assert(res.status === 200, 'AC-1: GET /api/rooms/:roomId/messages returns 200 OK');

      const data = await res.json();
      assert(Array.isArray(data.messages), 'AC-1: Response contains messages array');
      assert(data.messages.length === 50, `AC-1: Exactly 50 messages loaded (got ${data.messages?.length})`);
      assert(data.hasMore === true, 'AC-1: hasMore is true because 25 older messages remain');

      // Verify newest at the bottom: chronological ordering
      const firstMsg = data.messages[0];
      const lastMsg = data.messages[data.messages.length - 1];
      const isChronological = new Date(firstMsg.createdAt).getTime() <= new Date(lastMsg.createdAt).getTime();
      assert(isChronological, 'AC-1: Messages are chronologically ordered (newest at bottom)');

      // Verify that the 50 messages are messages #26 to #75
      assert(firstMsg.id === 1026, `AC-1: Oldest loaded message is #26 (got ID ${firstMsg.id})`);
      assert(lastMsg.id === 1075, `AC-1: Newest loaded message is #75 (got ID ${lastMsg.id})`);
    }

    console.log('\n--- Criterion 2: Scrolling to the top loads next 50 older messages via cursor pagination ---');
    {
      // First, get the initial 50 messages
      const initialRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/messages?limit=50`, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      const initialData = await initialRes.json();
      const oldestLoadedMessage = initialData.messages[0];
      const cursor = oldestLoadedMessage.createdAt;

      // Now query with ?before=<cursor>&limit=50
      const page2Res = await fetch(
        `${BASE_URL}/api/rooms/${roomId}/messages?limit=50&before=${encodeURIComponent(cursor)}`,
        { headers: { Authorization: `Bearer ${studentToken}` } }
      );
      assert(page2Res.status === 200, 'AC-2: Cursor request with before query param returns 200 OK');

      const page2Data = await page2Res.json();
      assert(page2Data.messages.length === 25, `AC-2: Next page returned remaining 25 messages (got ${page2Data.messages.length})`);

      // Verify the loaded older messages are #1 to #25
      const page2FirstMsg = page2Data.messages[0];
      const page2LastMsg = page2Data.messages[page2Data.messages.length - 1];
      assert(page2FirstMsg.id === 1001, `AC-2: Oldest message in page 2 is #1 (got ID ${page2FirstMsg.id})`);
      assert(page2LastMsg.id === 1025, `AC-2: Newest message in page 2 is #25 (got ID ${page2LastMsg.id})`);

      // Criterion 4: hasMore = false when history is exhausted
      assert(page2Data.hasMore === false, 'AC-4: hasMore is false when all older messages have been loaded');
    }

    console.log('\n--- Criterion 3 & 4: UI Indicators in Client Component (ChatPanel.tsx) ---');
    {
      const chatPanelPath = path.resolve(__dirname, '../../client/src/features/rooms/ChatPanel.tsx');
      assert(fs.existsSync(chatPanelPath), 'AC-3/4: ChatPanel.tsx exists');

      const chatPanelCode = fs.readFileSync(chatPanelPath, 'utf8');

      // AC-3: "Loading..." indicator is shown during fetch
      const hasLoadingIndicator =
        chatPanelCode.includes('id="chat-loading-indicator"') &&
        chatPanelCode.includes('Loading...');
      assert(hasLoadingIndicator, 'AC-3: ChatPanel has #chat-loading-indicator with "Loading..." text');

      // AC-4: "No more messages" indicator is shown when hasMore = false
      const hasNoMoreIndicator =
        chatPanelCode.includes('id="chat-no-more-messages"') &&
        chatPanelCode.includes('No more messages') &&
        chatPanelCode.includes('!hasMore');
      assert(hasNoMoreIndicator, 'AC-4: ChatPanel has #chat-no-more-messages with "No more messages" when !hasMore');

      // AC-2: Scroll listener triggering cursor pagination
      const hasScrollPagination =
        chatPanelCode.includes('before=') &&
        chatPanelCode.includes('onScroll') &&
        chatPanelCode.includes('loadOlderMessages');
      assert(hasScrollPagination, 'AC-2: ChatPanel implements onScroll upward cursor pagination with before query param');
    }

    console.log('\n--- Criterion 5: Security & Room Membership Enforcement ---');
    {
      // 1. Unauthenticated request
      const unauthRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/messages?limit=50`);
      assert(unauthRes.status === 401, 'Auth: Unauthenticated request rejected with 401');

      // 2. Non-member request
      const nonMemberRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/messages?limit=50`, {
        headers: { Authorization: `Bearer ${nonMemberToken}` },
      });
      assert(nonMemberRes.status === 403, 'Auth: Non-member request rejected with 403 NOT_A_MEMBER');
      const nonMemberData = await nonMemberRes.json();
      assert(nonMemberData.error?.code === 'NOT_A_MEMBER', 'Auth: Error code is NOT_A_MEMBER');
    }

    console.log('\n--- Criterion 6: Real-Time Chat & Socket.IO Integration ---');
    {
      // Connect teacher socket
      memberSocket = ClientSocket(BASE_URL, {
        auth: { token: teacherToken },
        transports: ['websocket'],
      });

      // Connect student socket
      otherMemberSocket = ClientSocket(BASE_URL, {
        auth: { token: studentToken },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve) => {
        let connectedCount = 0;
        const check = () => {
          connectedCount++;
          if (connectedCount === 2) resolve();
        };
        memberSocket?.on('connect', check);
        otherMemberSocket?.on('connect', check);
      });

      // Both join room
      await new Promise<void>((resolve) => {
        let joinedCount = 0;
        const check = () => {
          joinedCount++;
          if (joinedCount === 2) resolve();
        };
        memberSocket?.emit('room:join', { roomId }, check);
        otherMemberSocket?.emit('room:join', { roomId }, check);
      });

      // Listen for chat:new on student socket
      const chatNewPromise = new Promise<any>((resolve) => {
        otherMemberSocket?.on('chat:new', (payload) => {
          resolve(payload);
        });
      });

      // Teacher sends a chat message via socket
      const sendAck = await new Promise<any>((resolve) => {
        memberSocket?.emit(
          'chat:send',
          { roomId, body: 'Hello students, welcome to the lecture!' },
          (ack: any) => resolve(ack)
        );
      });

      assert(sendAck?.ok === true, 'Realtime: socket chat:send acknowledged with ok: true');
      assert(sendAck?.data?.body === 'Hello students, welcome to the lecture!', 'Realtime: ack contains created message');

      const receivedMsg = await Promise.race([
        chatNewPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for chat:new')), 3000)),
      ]);

      assert(receivedMsg?.body === 'Hello students, welcome to the lecture!', 'Realtime: student received chat:new event broadcast');
      assert(receivedMsg?.senderName === teacherUser.fullName, 'Realtime: senderName matches sender');
      assert(receivedMsg?.senderRole === 'teacher', 'Realtime: senderRole is teacher');
    }

  } catch (err: any) {
    console.error('Unhandled test failure:', err);
    failedCount++;
  } finally {
    memberSocket?.disconnect();
    otherMemberSocket?.disconnect();
    testServer.close();
  }

  console.log('\n============================================================');
  console.log(`Test Summary: \x1b[32m${passedCount} Passed\x1b[0m, \x1b[31m${failedCount} Failed\x1b[0m`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
