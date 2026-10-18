/**
 * Automated Verification Script for US-SEC-05: Scalability Target for MVP
 * Module: Security & Non-functional
 * Priority: P0 | Traces to: NFR-4.1
 *
 * Acceptance Criteria Verified:
 * 1. A 15-participant room with all features active (video, chat, code, whiteboard) runs without errors.
 * 2. 3 concurrent rooms do not degrade each other's performance.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms, clearMockSessions } from '../src/lib/rooms';
import { clearPresence } from '../src/realtime/presence';
import { clearCodeWorkspace, setPenHolder } from '../src/realtime/codeWorkspace';
import { clearWhiteboard } from '../src/realtime/whiteboard';
import { setMockPistonExecutor } from '../src/lib/piston';
import { Me, RoomSummary, Permissions, Member } from '@linkup/shared';

const TEST_PORT = 3165;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS\x1b[0m: ${testName} ${detail ? `(${detail})` : ''}`);
    passedCount++;
  } else {
    console.error(`  \x1b[31m✖ FAIL\x1b[0m: ${testName} ${detail ? `(${detail})` : ''}`);
    failedCount++;
  }
}

interface TestParticipant {
  user: Me;
  token: string;
  socket?: ClientSocketType;
  errors: any[];
}

function createRoomParticipants(roomId: string, count: number = 15): { host: TestParticipant; students: TestParticipant[] } {
  const hostUser: Me = {
    id: `usr-${roomId}-host`,
    fullName: `Teacher (${roomId})`,
    email: `host-${roomId}@linkup.test`,
    role: 'teacher',
  };
  const host: TestParticipant = {
    user: hostUser,
    token: `token-${roomId}-host`,
    errors: [],
  };

  const students: TestParticipant[] = [];
  for (let i = 1; i < count; i++) {
    const studentUser: Me = {
      id: `usr-${roomId}-s${i}`,
      fullName: `Student ${i} (${roomId})`,
      email: `student${i}-${roomId}@linkup.test`,
      role: 'student',
    };
    students.push({
      user: studentUser,
      token: `token-${roomId}-s${i}`,
      errors: [],
    });
  }

  return { host, students };
}

function setupRoomMock(roomId: string, host: TestParticipant, students: TestParticipant[]) {
  const hostMember: Member = {
    userId: host.user.id,
    fullName: host.user.fullName,
    userRole: 'teacher',
    memberRole: 'host',
    permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
    joinedAt: new Date().toISOString(),
  };

  const studentMembers: Member[] = students.map((s, idx) => ({
    userId: s.user.id,
    fullName: s.user.fullName,
    userRole: 'student',
    memberRole: 'participant',
    permissions: {
      canMic: true,
      canCamera: true,
      canScreen: false,
      canWhiteboard: idx === 0, // 1st student can whiteboard
      canCode: idx === 0,       // 1st student can code
    },
    joinedAt: new Date().toISOString(),
  }));

  const allMembers = [hostMember, ...studentMembers];

  setCachedUser(host.token, host.user);
  students.forEach((s) => setCachedUser(s.token, s.user));

  const roomSummary: RoomSummary = {
    id: roomId,
    name: `Room ${roomId}`,
    description: `Scalability Room ${roomId}`,
    joinCode: roomId.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6) || 'ROOM01',
    hostName: host.user.fullName,
    memberCount: allMembers.length,
    myRole: 'host',
    activeSessionId: null,
    createdAt: new Date().toISOString(),
    members: allMembers,
  };

  setMockRooms(host.user.id, [{ ...roomSummary, myRole: 'host' }]);
  students.forEach((s) => {
    setMockRooms(s.user.id, [{ ...roomSummary, myRole: 'participant' }]);
  });
}

async function connectParticipants(
  participants: TestParticipant[],
  roomId: string
): Promise<void> {
  await Promise.all(
    participants.map((p) => {
      return new Promise<void>((resolve, reject) => {
        p.socket = ClientSocket(BASE_URL, {
          auth: { token: p.token },
          transports: ['websocket'],
          reconnection: false,
        });

        p.socket.on('error', (err) => p.errors.push(err));
        p.socket.on('room:error', (err) => p.errors.push(err));

        p.socket.on('connect', () => {
          p.socket!.emit('room:join', { roomId }, (res: any) => {
            resolve();
          });
        });
        p.socket.on('connect_error', reject);
      });
    })
  );
}

async function runTests() {
  console.log('\n============================================================');
  console.log('🚀 Running US-SEC-05: Scalability Target for MVP (NFR-4.1)');
  console.log('   Target: 15 participants/room, 3 concurrent rooms on 1 instance');
  console.log('============================================================\n');

  const testServer = http.createServer(app);
  io.attach(testServer);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  // Mock code execution service for fast predictable load testing
  setMockPistonExecutor(async (options) => ({
    stdout: `Executed ${options.language} code successfully`,
    stderr: '',
    exitCode: 0,
    timeMs: 15,
    timedOut: false,
    truncated: false,
  }));

  const allConnectedSockets: ClientSocketType[] = [];

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockSessions();
    clearPresence();
    clearCodeWorkspace();
    clearWhiteboard();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: 15-PARTICIPANT ROOM WITH ALL FEATURES ACTIVE (AC 1)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Testing a 15-participant room with all features active...');
    const ROOM_1_ID = 'room-mvp-scale-01';
    const room1 = createRoomParticipants(ROOM_1_ID, 15);
    setupRoomMock(ROOM_1_ID, room1.host, room1.students);

    const room1Participants = [room1.host, ...room1.students];
    assert(room1Participants.length === 15, 'Created 15 participants for Room 1 (1 Host + 14 Students)');

    // 1. Connect all 15 participants concurrently
    const connectStart = performance.now();
    await connectParticipants(room1Participants, ROOM_1_ID);
    const connectDuration = performance.now() - connectStart;
    room1Participants.forEach((p) => p.socket && allConnectedSockets.push(p.socket));

    assert(
      room1Participants.every((p) => p.socket?.connected),
      'All 15 participants successfully connected via WebSocket to Room 1',
      `Duration: ${connectDuration.toFixed(1)} ms`
    );

    // 2. Feature: Video / Session & LiveKit Token
    console.log('   -> Activating Video feature (host starts session, all 15 request tokens)...');
    const startSessionRes = await fetch(`${BASE_URL}/api/rooms/${ROOM_1_ID}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${room1.host.token}`,
      },
    });
    assert(startSessionRes.status === 201 || startSessionRes.status === 200, 'Host started video session (HTTP 201/200)');
    const sessionData = await startSessionRes.json();
    const sessionId = sessionData?.id || sessionData?.session?.id;
    assert(Boolean(sessionId), `Session ID created: ${sessionId}`);

    // All 15 participants concurrently fetch LiveKit token
    const tokenFetches = await Promise.all(
      room1Participants.map(async (p) => {
        const res = await fetch(`${BASE_URL}/api/rooms/${ROOM_1_ID}/livekit-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${p.token}`,
          },
        });
        const json = await res.json();
        return { status: res.status, hasToken: Boolean(json.token || json.data?.token) };
      })
    );

    assert(
      tokenFetches.every((t) => t.status === 200 && t.hasToken),
      'All 15 participants received valid LiveKit video tokens without error'
    );

    // 3. Feature: Chat
    console.log('   -> Activating Chat feature (concurrent message broadcast to 15 members)...');
    const CHAT_MSG_COUNT = 5;
    let chatDeliveriesReceived = 0;
    const expectedDeliveries = CHAT_MSG_COUNT * room1Participants.length;

    const chatReceivedPromises = room1Participants.map((p) => {
      return new Promise<void>((resolve) => {
        let count = 0;
        p.socket!.on('chat:new', () => {
          count++;
          chatDeliveriesReceived++;
          if (count === CHAT_MSG_COUNT) resolve();
        });
      });
    });

    for (let m = 0; m < CHAT_MSG_COUNT; m++) {
      const sender = room1Participants[m % room1Participants.length];
      sender.socket!.emit('chat:send', {
        roomId: ROOM_1_ID,
        body: `Test 1 multi-participant message #${m + 1}`,
      });
    }

    await Promise.all(chatReceivedPromises);
    assert(
      chatDeliveriesReceived === expectedDeliveries,
      `All 15 members received all ${CHAT_MSG_COUNT} chat messages (${chatDeliveriesReceived}/${expectedDeliveries} deliveries)`
    );

    // 4. Feature: Code Collaboration & Execution
    console.log('   -> Activating Code feature (pen delegation, code sync to 15 members, execution)...');
    const penStudent = room1.students[0];
    setPenHolder(ROOM_1_ID, penStudent.user.id);

    // Pen holder sends code update
    const codeSyncPromises = room1Participants.filter((p) => p !== penStudent).map((p) => {
      return new Promise<void>((resolve) => {
        p.socket!.once('code:state', (data: any) => {
          if (data.content.includes('scale_test_var')) resolve();
        });
      });
    });

    penStudent.socket!.emit('code:update', {
      roomId: ROOM_1_ID,
      content: '# Scale test\nscale_test_var = 15\nprint(scale_test_var)\n',
      language: 'python',
    });

    await Promise.all(codeSyncPromises);
    assert(true, 'Code update synchronized to all other 14 viewers in the room');

    // Pen holder executes code
    const runResultPromises = room1Participants.map((p) => {
      return new Promise<void>((resolve) => {
        p.socket!.once('code:run-result', (data: any) => {
          if (data.roomId === ROOM_1_ID) resolve();
        });
      });
    });

    const execRes = await fetch(`${BASE_URL}/api/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${penStudent.token}`,
      },
      body: JSON.stringify({
        roomId: ROOM_1_ID,
        language: 'python',
        code: 'print(scale_test_var)',
      }),
    });

    assert(execRes.status === 200, 'POST /api/execute executed successfully (HTTP 200)');
    await Promise.all(runResultPromises);
    assert(true, 'code:run-result broadcast successfully delivered to all 15 members');

    // 5. Feature: Shared Whiteboard
    console.log('   -> Activating Whiteboard feature (collaborative board updates to 15 members)...');
    const boardEditor = room1.students[0]; // has canWhiteboard permission

    const wbSyncPromises = room1Participants
      .filter((p) => p !== boardEditor)
      .map((p) => {
        return new Promise<void>((resolve) => {
          p.socket!.once('wb:update', (data: any) => {
            if (data.roomId === ROOM_1_ID) resolve();
          });
        });
      });

    boardEditor.socket!.emit('wb:update', {
      roomId: ROOM_1_ID,
      elements: [
        { id: 'rect-01', type: 'rectangle', x: 10, y: 10, width: 100, height: 100 },
        { id: 'rect-02', type: 'rectangle', x: 120, y: 10, width: 80, height: 80 },
      ],
    });

    await Promise.all(wbSyncPromises);
    assert(true, 'wb:update broadcast successfully received by all 15 room participants');

    // Check error logs across all 15 sockets
    const totalRoom1Errors = room1Participants.reduce((sum, p) => sum + p.errors.length, 0);
    assert(
      totalRoom1Errors === 0,
      'A 15-participant room with all features active runs without errors (AC-1, NFR-4.1)',
      `Errors recorded: ${totalRoom1Errors}`
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: 3 CONCURRENT ROOMS DO NOT DEGRADE EACH OTHER'S PERFORMANCE (AC 2)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Testing 3 concurrent rooms (45 total participants)...');
    const ROOM_2_ID = 'room-mvp-scale-02';
    const ROOM_3_ID = 'room-mvp-scale-03';

    const room2 = createRoomParticipants(ROOM_2_ID, 15);
    setupRoomMock(ROOM_2_ID, room2.host, room2.students);
    const room2Participants = [room2.host, ...room2.students];

    const room3 = createRoomParticipants(ROOM_3_ID, 15);
    setupRoomMock(ROOM_3_ID, room3.host, room3.students);
    const room3Participants = [room3.host, ...room3.students];

    // Connect Room 2 and Room 3 participants
    await Promise.all([
      connectParticipants(room2Participants, ROOM_2_ID),
      connectParticipants(room3Participants, ROOM_3_ID),
    ]);
    room2Participants.forEach((p) => p.socket && allConnectedSockets.push(p.socket));
    room3Participants.forEach((p) => p.socket && allConnectedSockets.push(p.socket));

    assert(
      allConnectedSockets.length === 45,
      'All 45 participants across 3 rooms concurrently connected on single backend instance'
    );

    // Spy on cross-talk: No events from Room A should ever leak into Room B or Room C
    let crossTalkLeaksDetected = 0;
    const checkLeak = (expectedRoomId: string) => (data: any) => {
      const eventRoomId = data?.roomId;
      if (eventRoomId && eventRoomId !== expectedRoomId) {
        crossTalkLeaksDetected++;
        console.error(`  ✖ LEAK: Client in ${expectedRoomId} received event for ${eventRoomId}`);
      }
    };

    room1Participants.forEach((p) => {
      p.socket!.on('chat:new', checkLeak(ROOM_1_ID));
      p.socket!.on('code:state', checkLeak(ROOM_1_ID));
      p.socket!.on('wb:update', checkLeak(ROOM_1_ID));
    });

    room2Participants.forEach((p) => {
      p.socket!.on('chat:new', checkLeak(ROOM_2_ID));
      p.socket!.on('code:state', checkLeak(ROOM_2_ID));
      p.socket!.on('wb:update', checkLeak(ROOM_2_ID));
    });

    room3Participants.forEach((p) => {
      p.socket!.on('chat:new', checkLeak(ROOM_3_ID));
      p.socket!.on('code:state', checkLeak(ROOM_3_ID));
      p.socket!.on('wb:update', checkLeak(ROOM_3_ID));
    });

    // Run simultaneous multi-feature operations across all 3 rooms
    console.log('   -> Executing concurrent operations simultaneously across all 3 rooms...');

    setPenHolder(ROOM_1_ID, room1.host.user.id);
    setPenHolder(ROOM_2_ID, room2.host.user.id);
    setPenHolder(ROOM_3_ID, room3.host.user.id);

    const concurrentStart = performance.now();

    // Room 1: Chat broadcast + Code run
    const room1Work = async () => {
      const room1Start = performance.now();
      const chatDone = new Promise<void>((resolve) => {
        let count = 0;
        room1.students[1].socket!.on('chat:new', () => {
          count++;
          if (count === 3) resolve();
        });
      });

      for (let i = 0; i < 3; i++) {
        room1.host.socket!.emit('chat:send', { roomId: ROOM_1_ID, body: `Room 1 load msg ${i}` });
      }
      await chatDone;

      const codeRes = await fetch(`${BASE_URL}/api/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${room1.host.token}`,
        },
        body: JSON.stringify({ roomId: ROOM_1_ID, language: 'python', code: 'print("R1")' }),
      });
      assert(codeRes.status === 200, 'Room 1 concurrent code execution completed');
      return performance.now() - room1Start;
    };

    // Room 2: Whiteboard streaming + Permission updates
    const room2Work = async () => {
      const room2Start = performance.now();
      const wbDone = new Promise<void>((resolve) => {
        let count = 0;
        room2.students[2].socket!.on('wb:update', () => {
          count++;
          if (count === 3) resolve();
        });
      });

      for (let i = 0; i < 3; i++) {
        room2.host.socket!.emit('wb:update', {
          roomId: ROOM_2_ID,
          elements: [{ id: `elem-${i}`, type: 'line', x: i * 10, y: i * 10 }],
        });
      }
      await wbDone;

      const permRes = await fetch(`${BASE_URL}/api/rooms/${ROOM_2_ID}/members/${room2.students[0].user.id}/permissions`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${room2.host.token}`,
        },
        body: JSON.stringify({ canWhiteboard: true }),
      });
      assert(permRes.status === 200, 'Room 2 concurrent permission update completed');
      return performance.now() - room2Start;
    };

    // Room 3: Code sync + Chat conversation
    const room3Work = async () => {
      const room3Start = performance.now();
      const codeSyncDone = new Promise<void>((resolve) => {
        room3.students[3].socket!.once('code:state', () => resolve());
      });

      room3.host.socket!.emit('code:update', {
        roomId: ROOM_3_ID,
        content: '# Room 3 concurrent edit\nx = 100\n',
        language: 'python',
      });
      await codeSyncDone;

      const chatDone = new Promise<void>((resolve) => {
        room3.students[4].socket!.once('chat:new', () => resolve());
      });
      room3.students[0].socket!.emit('chat:send', { roomId: ROOM_3_ID, body: 'Room 3 active chat' });
      await chatDone;

      return performance.now() - room3Start;
    };

    const [r1Duration, r2Duration, r3Duration] = await Promise.all([
      room1Work(),
      room2Work(),
      room3Work(),
    ]);

    const totalConcurrentTime = performance.now() - concurrentStart;
    console.log(`   -> Concurrent execution complete in ${totalConcurrentTime.toFixed(1)} ms total:`);
    console.log(`      * Room 1 elapsed: ${r1Duration.toFixed(1)} ms`);
    console.log(`      * Room 2 elapsed: ${r2Duration.toFixed(1)} ms`);
    console.log(`      * Room 3 elapsed: ${r3Duration.toFixed(1)} ms`);

    assert(
      crossTalkLeaksDetected === 0,
      'Complete isolation maintained across all 3 concurrent rooms (zero cross-talk leaks)'
    );

    assert(
      r1Duration < 1000 && r2Duration < 1000 && r3Duration < 1000,
      'All 3 concurrent rooms completed their operations in sub-second time without blocking each other'
    );

    assert(
      totalConcurrentTime < 1500,
      '3 concurrent rooms do not degrade each other\'s performance (AC-2, NFR-4.1)',
      `Total batch time for 3 concurrent rooms: ${totalConcurrentTime.toFixed(1)} ms`
    );

  } finally {
    allConnectedSockets.forEach((s) => s.disconnect());
    clearMockRooms();
    clearMockSessions();
    clearTokenCache();
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

runTests().catch((err) => {
  console.error('Unexpected error during scalability test suite:', err);
  process.exit(1);
});
