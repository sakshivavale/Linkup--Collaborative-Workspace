/**
 * Automated Verification Script for US-CHAT-01: Send a Message
 * Module: Chat
 * Priority: P0 | Traces to: FR-3.10, FR-3.11
 *
 * Acceptance Criteria Verified:
 * 1. A message input and Send button are always available in the Chat sidebar tab, inside or outside a live session.
 * 2. Messages are 1-2000 characters; an empty message cannot be sent.
 * 3. Messages appear for all online members within 500 ms (same region).
 * 4. The sender sees an optimistic message that is confirmed or replaced once the server acknowledges it.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms, setMockSession, clearMockSessions } from '../src/lib/rooms';
import { setMockMessages, clearMockMessages, getMockMessages } from '../src/lib/chat';
import { Me, RoomSummary, Session } from '@linkup/shared';

const TEST_PORT = 3137;
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
  console.log('🚀 Running US-CHAT-01: Send a Message Tests (FR-3.10, FR-3.11)');
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
  let nonMemberSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockSessions();
    clearMockMessages();

    const teacherToken = 'test_teacher_token_chat_01';
    const studentToken = 'test_student_token_chat_01';
    const nonMemberToken = 'test_nonmember_token_chat_01';

    const teacherUser: Me = {
      id: 'teacher-user-chat-01',
      email: 'teacher@linkup.test',
      fullName: 'Prof. Ada Lovelace',
      role: 'teacher',
      createdAt: new Date().toISOString(),
    };

    const studentUser: Me = {
      id: 'student-user-chat-01',
      email: 'student@linkup.test',
      fullName: 'Grace Hopper',
      role: 'student',
      createdAt: new Date().toISOString(),
    };

    const nonMemberUser: Me = {
      id: 'nonmember-user-chat-01',
      email: 'stranger@linkup.test',
      fullName: 'Stranger Bob',
      role: 'student',
      createdAt: new Date().toISOString(),
    };

    setCachedUser(teacherToken, teacherUser);
    setCachedUser(studentToken, studentUser);
    setCachedUser(nonMemberToken, nonMemberUser);

    const roomId = 'room-chat-01-test';
    const testRoom: RoomSummary = {
      id: roomId,
      name: 'CS101 Intro to Computer Science',
      description: 'Main lecture hall',
      joinCode: 'CHAT01',
      hostName: teacherUser.fullName,
      createdAt: new Date().toISOString(),
      memberCount: 2,
      myRole: 'host',
      activeSessionId: null,
      members: [
        {
          userId: teacherUser.id,
          fullName: teacherUser.fullName,
          email: teacherUser.email,
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
          userId: studentUser.id,
          fullName: studentUser.fullName,
          email: studentUser.email,
          userRole: 'student',
          memberRole: 'participant',
          permissions: {
            canMic: true,
            canCamera: true,
            canScreen: false,
            canWhiteboard: true,
            canCode: true,
          },
          joinedAt: new Date().toISOString(),
        },
      ],
    };

    setMockRooms(teacherUser.id, [testRoom]);
    setMockRooms(studentUser.id, [{ ...testRoom, myRole: 'participant' }]);
    setMockMessages(roomId, []);

    // Connect Teacher socket
    teacherSocket = ClientSocket(BASE_URL, {
      auth: { token: teacherToken },
      transports: ['websocket'],
    });

    // Connect Student socket
    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    // Connect Non-member socket
    nonMemberSocket = ClientSocket(BASE_URL, {
      auth: { token: nonMemberToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((res) => teacherSocket?.on('connect', () => res())),
      new Promise<void>((res) => studentSocket?.on('connect', () => res())),
      new Promise<void>((res) => nonMemberSocket?.on('connect', () => res())),
    ]);

    // Join room channels
    await new Promise<void>((resolve) => {
      teacherSocket?.emit('room:join', { roomId }, () => resolve());
    });
    await new Promise<void>((resolve) => {
      studentSocket?.emit('room:join', { roomId }, () => resolve());
    });

    // -------------------------------------------------------------------------
    // Criterion 2: Messages are 1-2000 characters; an empty message cannot be sent
    // -------------------------------------------------------------------------
    console.log('--- Criterion 2: Length & Empty Message Validation ---');

    // 2a. Reject empty message via Socket
    const emptySocketAck: any = await new Promise((resolve) => {
      teacherSocket?.emit('chat:send', { roomId, body: '' }, (ack: any) => resolve(ack));
    });
    assert(
      emptySocketAck?.ok === false && emptySocketAck?.error?.code === 'VALIDATION',
      'Empty message is rejected with VALIDATION error over Socket'
    );

    // 2b. Reject whitespace-only message via Socket
    const whitespaceSocketAck: any = await new Promise((resolve) => {
      teacherSocket?.emit('chat:send', { roomId, body: '   \n  ' }, (ack: any) => resolve(ack));
    });
    assert(
      whitespaceSocketAck?.ok === false && whitespaceSocketAck?.error?.code === 'VALIDATION',
      'Whitespace-only message is rejected with VALIDATION error over Socket'
    );

    // 2c. Reject empty message via REST API
    const emptyRestRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`,
      },
      body: JSON.stringify({ body: '' }),
    });
    const emptyRestData: any = await emptyRestRes.json();
    assert(
      emptyRestRes.status === 400 && emptyRestData?.error?.code === 'VALIDATION',
      'Empty message via REST returns HTTP 400 VALIDATION error'
    );

    // 2d. Reject message exceeding 2000 characters (>2000 chars)
    const overLimitBody = 'A'.repeat(2001);
    const overLimitAck: any = await new Promise((resolve) => {
      teacherSocket?.emit('chat:send', { roomId, body: overLimitBody }, (ack: any) => resolve(ack));
    });
    assert(
      overLimitAck?.ok === false && overLimitAck?.error?.code === 'VALIDATION',
      'Message with 2001 characters is rejected over Socket'
    );

    const overLimitRestRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`,
      },
      body: JSON.stringify({ body: overLimitBody }),
    });
    assert(
      overLimitRestRes.status === 400,
      'Message with 2001 characters via REST returns HTTP 400 VALIDATION'
    );

    // 2e. Valid 1-character message is accepted
    const oneCharAck: any = await new Promise((resolve) => {
      teacherSocket?.emit('chat:send', { roomId, body: '?' }, (ack: any) => resolve(ack));
    });
    assert(
      oneCharAck?.ok === true && oneCharAck?.data?.body === '?',
      'Minimum length message (1 char) is successfully accepted'
    );

    // 2f. Valid 2000-character message is accepted
    const exactMaxBody = 'Z'.repeat(2000);
    const maxCharAck: any = await new Promise((resolve) => {
      teacherSocket?.emit('chat:send', { roomId, body: exactMaxBody }, (ack: any) => resolve(ack));
    });
    assert(
      maxCharAck?.ok === true && maxCharAck?.data?.body?.length === 2000,
      'Maximum length message (2000 chars) is successfully accepted'
    );

    // -------------------------------------------------------------------------
    // Criterion 4: The sender sees an optimistic message that is confirmed or
    //              replaced once the server acknowledges it
    // -------------------------------------------------------------------------
    console.log('\n--- Criterion 4: Optimistic Confirmation & Replacement ---');

    const clientMsgId = 'client_temp_12345';
    const msgContent = 'Optimistic message verification test';

    const ackPromise = new Promise<any>((resolve) => {
      teacherSocket?.emit(
        'chat:send',
        { roomId, body: msgContent, clientId: clientMsgId },
        (ack: any) => resolve(ack)
      );
    });

    const ackResult = await ackPromise;
    assert(
      ackResult?.ok === true,
      'Server acknowledges optimistic message with ok: true'
    );
    assert(
      ackResult?.data?.clientId === clientMsgId,
      'Server acknowledgment returns clientId to replace optimistic message'
    );
    assert(
      typeof ackResult?.data?.id === 'number' && ackResult?.data?.id > 0,
      'Server acknowledgment provides confirmed server message ID'
    );
    assert(
      Boolean(ackResult?.data?.createdAt),
      'Server acknowledgment provides server timestamp'
    );

    // -------------------------------------------------------------------------
    // Criterion 3: Messages appear for all online members within 500 ms
    // -------------------------------------------------------------------------
    console.log('\n--- Criterion 3: Real-time Broadcast & Latency (< 500 ms) ---');

    const realtimeText = 'Real-time broadcast within 500ms test';
    const sendStartTime = Date.now();

    const studentReceivePromise = new Promise<{ msg: any; latency: number }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for chat:new')), 1000);
      const onReceive = (payload: any) => {
        const msg = payload?.message || payload;
        if (msg?.body !== realtimeText) return;
        clearTimeout(timeout);
        studentSocket?.off('chat:new', onReceive);
        studentSocket?.off('chat:new message', onReceive);
        const latency = Date.now() - sendStartTime;
        resolve({ msg, latency });
      };
      studentSocket?.on('chat:new', onReceive);
      studentSocket?.on('chat:new message', onReceive);
    });

    teacherSocket?.emit('chat:send', { roomId, body: realtimeText });

    const { msg: receivedPayload, latency } = await studentReceivePromise;

    assert(
      receivedPayload?.body === realtimeText,
      'Online student member received broadcast chat:new message'
    );
    assert(
      latency < 500,
      `Broadcast delivered in ${latency} ms (Acceptance Criteria: < 500 ms)`
    );
    assert(
      receivedPayload?.senderName === teacherUser.fullName,
      'Broadcast message contains sender full name'
    );
    assert(
      receivedPayload?.senderRole === 'teacher',
      'Broadcast message contains sender teacher role'
    );

    // -------------------------------------------------------------------------
    // Criterion 1: Available inside or outside a live session
    // -------------------------------------------------------------------------
    console.log('\n--- Criterion 1: Available inside & outside live session ---');

    // 1a. Outside live session (mockSessions has no active session)
    const outsideMsgAck: any = await new Promise((resolve) => {
      teacherSocket?.emit(
        'chat:send',
        { roomId, body: 'Message sent outside live session' },
        (ack: any) => resolve(ack)
      );
    });
    assert(
      outsideMsgAck?.ok === true && outsideMsgAck?.data?.body === 'Message sent outside live session',
      'Chat message successfully sent outside a live session'
    );

    // 1b. Inside live session (active session started)
    const activeSession: Session = {
      id: 'session-chat-01-live',
      roomId,
      hostId: teacherUser.id,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: 'active',
    };
    testRoom.activeSessionId = activeSession.id;
    setMockSession(activeSession);
    setMockRooms(teacherUser.id, [testRoom]);
    setMockRooms(studentUser.id, [{ ...testRoom, myRole: 'participant' }]);

    const insideMsgAck: any = await new Promise((resolve) => {
      studentSocket?.emit(
        'chat:send',
        { roomId, body: 'Message sent inside active live session' },
        (ack: any) => resolve(ack)
      );
    });
    assert(
      insideMsgAck?.ok === true && insideMsgAck?.data?.body === 'Message sent inside active live session',
      'Chat message successfully sent inside an active live session'
    );

    // -------------------------------------------------------------------------
    // Authorization & Membership Enforcement
    // -------------------------------------------------------------------------
    console.log('\n--- Security: Room Membership Enforcement ---');

    const nonMemberAck: any = await new Promise((resolve) => {
      nonMemberSocket?.emit(
        'chat:send',
        { roomId, body: 'Intruder message' },
        (ack: any) => resolve(ack)
      );
    });
    assert(
      nonMemberAck?.ok === false && nonMemberAck?.error?.code === 'NOT_A_MEMBER',
      'Non-member cannot send chat message via Socket (NOT_A_MEMBER error)'
    );

    const nonMemberRestRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nonMemberToken}`,
      },
      body: JSON.stringify({ body: 'Intruder message' }),
    });
    assert(
      nonMemberRestRes.status === 403,
      'Non-member cannot send chat message via REST (HTTP 403 Forbidden)'
    );

  } catch (err: any) {
    console.error('Unhandled test failure:', err);
    failedCount++;
  } finally {
    teacherSocket?.disconnect();
    studentSocket?.disconnect();
    nonMemberSocket?.disconnect();
    await new Promise<void>((r) => testServer.close(() => r()));
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log('\n============================================================');
  console.log(`Results: ${passedCount} Passed, ${failedCount} Failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
