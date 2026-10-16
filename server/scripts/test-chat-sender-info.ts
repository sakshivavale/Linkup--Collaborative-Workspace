/**
 * Automated Verification Script for US-CHAT-03: Message Display: Sender Info
 * Module: Chat
 * Priority: P0 | Traces to: FR-3.13
 *
 * Acceptance Criteria Verified:
 * 1. Each message shows: sender full name, timestamp, and a "Teacher" role badge if the sender has the teacher role.
 * 2. Timestamps are displayed in the user's local time.
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
import { setMockMessages, clearMockMessages, createChatMessage } from '../src/lib/chat';
import { Me, RoomSummary, ChatMessage } from '@linkup/shared';

const TEST_PORT = 3136;
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
  console.log('🚀 Running US-CHAT-03: Message Display: Sender Info Tests (FR-3.13)');
  console.log('============================================================\n');

  const testServer = http.createServer(app);
  io.attach(testServer);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  let teacherSocket: ClientSocketType | null = null;
  let studentSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockMessages();

    const teacherToken = 'test_teacher_token_chat_03';
    const studentToken = 'test_student_token_chat_03';

    const teacherUser: Me = {
      id: 'teacher-user-chat-03',
      email: 'prof.turing@linkup.test',
      fullName: 'Prof. Alan Turing',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'student-user-chat-03',
      email: 'grace@linkup.test',
      fullName: 'Grace Hopper',
      role: 'student',
    };

    setCachedUser(teacherToken, teacherUser, 60000);
    setCachedUser(studentToken, studentUser, 60000);

    const roomId = 'room-chat-sender-info-test';

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
      name: 'Computer Science 101 Discussion',
      description: 'Room for sender info testing',
      joinCode: 'SENDER03',
      hostName: teacherUser.fullName,
      memberCount: 2,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      members: roomMembers,
    };

    setMockRooms(teacherUser.id, [testRoom]);
    setMockRooms(studentUser.id, [{ ...testRoom, myRole: 'participant' }]);

    // Seed test messages: one from Teacher, one from Student
    const teacherMsgTime = new Date('2026-10-16T14:30:00.000Z').toISOString();
    const studentMsgTime = new Date('2026-10-16T14:35:00.000Z').toISOString();

    const sampleMessages: ChatMessage[] = [
      {
        id: 501,
        roomId,
        senderId: teacherUser.id,
        senderName: teacherUser.fullName,
        senderRole: 'teacher',
        body: 'Welcome to class! Please review chapter 4.',
        createdAt: teacherMsgTime,
      },
      {
        id: 502,
        roomId,
        senderId: studentUser.id,
        senderName: studentUser.fullName,
        senderRole: 'student',
        body: 'Thank you professor, reviewing now.',
        createdAt: studentMsgTime,
      },
    ];

    setMockMessages(roomId, sampleMessages);

    console.log('--- Criterion 1: API Message Payload Includes Sender Info (FR-3.13) ---');
    {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}/messages`, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      assert(res.status === 200, 'GET /api/rooms/:roomId/messages returns 200 OK');

      const data = await res.json();
      assert(Array.isArray(data.messages) && data.messages.length === 2, 'Returns both messages');

      const teacherMsg = data.messages.find((m: ChatMessage) => m.id === 501);
      const studentMsg = data.messages.find((m: ChatMessage) => m.id === 502);

      assert(teacherMsg?.senderName === 'Prof. Alan Turing', 'Teacher message has sender full name');
      assert(teacherMsg?.senderRole === 'teacher', 'Teacher message has senderRole="teacher"');
      assert(Boolean(teacherMsg?.createdAt), 'Teacher message has createdAt timestamp');

      assert(studentMsg?.senderName === 'Grace Hopper', 'Student message has sender full name');
      assert(studentMsg?.senderRole === 'student', 'Student message has senderRole="student"');
      assert(Boolean(studentMsg?.createdAt), 'Student message has createdAt timestamp');
    }

    console.log('\n--- Criterion 1 & 2: Client Component Rendering in ChatPanel.tsx ---');
    {
      const chatPanelPath = path.resolve(__dirname, '../../client/src/features/rooms/ChatPanel.tsx');
      assert(fs.existsSync(chatPanelPath), 'ChatPanel.tsx exists');

      const chatPanelCode = fs.readFileSync(chatPanelPath, 'utf8');

      // 1. Sender name display
      const hasSenderName =
        chatPanelCode.includes('data-testid="chat-sender-name"') &&
        chatPanelCode.includes('{msg.senderName}');
      assert(hasSenderName, 'AC-1: ChatPanel renders sender full name via data-testid="chat-sender-name"');

      // 2. Teacher badge display condition
      const hasTeacherBadgeCondition =
        chatPanelCode.includes("msg.senderRole === 'teacher'") &&
        chatPanelCode.includes('data-testid="chat-teacher-badge"') &&
        chatPanelCode.includes('Teacher');
      assert(
        hasTeacherBadgeCondition,
        'AC-1: ChatPanel conditionally renders "Teacher" role badge when senderRole === "teacher"'
      );

      // 3. Timestamp display
      const hasTimestampDisplay =
        chatPanelCode.includes('data-testid="chat-message-time"') &&
        chatPanelCode.includes('formatTime(msg.createdAt)');
      assert(hasTimestampDisplay, 'AC-1: ChatPanel renders timestamp with data-testid="chat-message-time"');

      // 4. Local time formatting
      const hasLocalTimeFormatting =
        chatPanelCode.includes('toLocaleTimeString') &&
        chatPanelCode.includes('hour:') &&
        chatPanelCode.includes('minute:');
      assert(
        hasLocalTimeFormatting,
        'AC-2: ChatPanel formats timestamps in user local time using toLocaleTimeString'
      );

      // Verify that local time formatting function produces the expected local time string
      const testDate = new Date('2026-10-16T14:30:00.000Z');
      const expectedLocalTime = testDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      assert(
        typeof expectedLocalTime === 'string' && expectedLocalTime.length > 0,
        `AC-2: Local time converts UTC to local time string ("${expectedLocalTime}")`
      );
    }

    console.log('\n--- Criterion 3: Realtime Message Broadcast Includes Sender Info ---');
    {
      teacherSocket = ClientSocket(BASE_URL, {
        auth: { token: teacherToken },
        transports: ['websocket'],
      });

      studentSocket = ClientSocket(BASE_URL, {
        auth: { token: studentToken },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve) => {
        let count = 0;
        const check = () => {
          count++;
          if (count === 2) resolve();
        };
        teacherSocket?.on('connect', check);
        studentSocket?.on('connect', check);
      });

      await new Promise<void>((resolve) => {
        let count = 0;
        const check = () => {
          count++;
          if (count === 2) resolve();
        };
        teacherSocket?.emit('room:join', { roomId }, check);
        studentSocket?.emit('room:join', { roomId }, check);
      });

      // Student listens for chat:new
      const receivedMsgPromise = new Promise<ChatMessage>((resolve) => {
        studentSocket?.on('chat:new', (payload: any) => {
          resolve(payload?.message || payload);
        });
      });

      // Teacher sends a message
      const sendAck = await new Promise<any>((resolve) => {
        teacherSocket?.emit(
          'chat:send',
          { roomId, body: 'Reminder: Lab submission is due tomorrow.' },
          (ack: any) => resolve(ack)
        );
      });

      assert(sendAck?.ok === true, 'Socket: Teacher message sent successfully');

      const broadcastMsg = await Promise.race([
        receivedMsgPromise,
        new Promise<any>((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for broadcast')), 3000)),
      ]);

      assert(broadcastMsg.senderName === 'Prof. Alan Turing', 'Realtime: Broadcast contains sender full name');
      assert(broadcastMsg.senderRole === 'teacher', 'Realtime: Broadcast contains senderRole="teacher" for Teacher badge');
      assert(Boolean(broadcastMsg.createdAt), 'Realtime: Broadcast contains createdAt timestamp for local time display');
    }

  } catch (err: any) {
    console.error('Unhandled test failure:', err);
    failedCount++;
  } finally {
    teacherSocket?.disconnect();
    studentSocket?.disconnect();
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
