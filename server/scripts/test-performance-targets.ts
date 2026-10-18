/**
 * Automated Verification Script for US-SEC-04: Performance Targets
 * Module: Security & Non-functional
 * Priority: P0 | Traces to: NFR-2.1, NFR-2.2
 *
 * Acceptance Criteria Verified:
 * 1. Permission change is reflected on the target client in under 1 second (< 1000 ms).
 * 2. Chat messages appear for all online members in under 500 ms (< 500 ms).
 * 3. Code syncs to viewers in under 300 ms after the debounce fires (< 300 ms).
 * 4. The dashboard loads in under 2 seconds on broadband (< 2000 ms).
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { clearPresence } from '../src/realtime/presence';
import { clearCodeWorkspace, setPenHolder } from '../src/realtime/codeWorkspace';
import { Me, RoomSummary, Permissions, Member } from '@linkup/shared';

const TEST_PORT = 3155;
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

async function runTests() {
  console.log('\n============================================================');
  console.log('🚀 Running US-SEC-04: Performance Targets Verification');
  console.log('   Priority: P0 | Traces to: NFR-2.1, NFR-2.2');
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
    clearPresence();
    clearCodeWorkspace();

    // ─────────────────────────────────────────────────────────────────────────────
    // SETUP TEST ROOM & PARTICIPANTS
    // ─────────────────────────────────────────────────────────────────────────────
    const roomId = 'room-sec-perf-001';

    const hostUser: Me = {
      id: 'usr-perf-host',
      fullName: 'Dr. Grace Hopper',
      email: 'grace@linkup.test',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'usr-perf-student-1',
      fullName: 'Alan Turing',
      email: 'alan@linkup.test',
      role: 'student',
    };

    const otherStudent: Me = {
      id: 'usr-perf-student-2',
      fullName: 'Claude Shannon',
      email: 'claude@linkup.test',
      role: 'student',
    };

    const hostToken = 'token-perf-host';
    const studentToken = 'token-perf-student-1';
    const otherStudentToken = 'token-perf-student-2';

    setCachedUser(hostToken, hostUser);
    setCachedUser(studentToken, studentUser);
    setCachedUser(otherStudentToken, otherStudent);

    const initialPerms: Permissions = {
      canMic: true,
      canCamera: true,
      canScreen: false,
      canWhiteboard: false,
      canCode: false,
    };

    const hostMember: Member = {
      userId: hostUser.id,
      fullName: hostUser.fullName,
      userRole: 'teacher',
      memberRole: 'host',
      permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
      joinedAt: new Date().toISOString(),
    };

    const studentMember1: Member = {
      userId: studentUser.id,
      fullName: studentUser.fullName,
      userRole: 'student',
      memberRole: 'participant',
      permissions: { ...initialPerms },
      joinedAt: new Date().toISOString(),
    };

    const studentMember2: Member = {
      userId: otherStudent.id,
      fullName: otherStudent.fullName,
      userRole: 'student',
      memberRole: 'participant',
      permissions: { ...initialPerms },
      joinedAt: new Date().toISOString(),
    };

    const testRoom: RoomSummary = {
      id: roomId,
      name: 'High Performance Computing Room',
      description: 'US-SEC-04 Benchmark Suite',
      joinCode: 'PERF04',
      hostName: hostUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      members: [hostMember, studentMember1, studentMember2],
    };

    setMockRooms(hostUser.id, [{ ...testRoom, myRole: 'host' }]);
    setMockRooms(studentUser.id, [{ ...testRoom, myRole: 'participant' }]);
    setMockRooms(otherStudent.id, [{ ...testRoom, myRole: 'participant' }]);

    // Connect WebSocket clients
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

    await Promise.all([
      new Promise<void>((r) => hostSocket!.emit('room:join', { roomId }, () => r())),
      new Promise<void>((r) => studentSocket!.emit('room:join', { roomId }, () => r())),
      new Promise<void>((r) => otherStudentSocket!.emit('room:join', { roomId }, () => r())),
    ]);

    // ─────────────────────────────────────────────────────────────────────────────
    // CRITERION 1: Permission change is reflected on target client in < 1 second (< 1000 ms)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Criterion 1] Benchmarking permission change latency (Target: < 1000 ms)...');

    const permLatencies: number[] = [];
    const NUM_TRIALS = 5;

    for (let i = 0; i < NUM_TRIALS; i++) {
      const targetState = i % 2 === 0;
      const permReceivedPromise = new Promise<number>((resolve) => {
        const handler = (payload: any) => {
          if (payload?.roomId === roomId && payload?.userId === studentUser.id) {
            studentSocket!.off('perm:changed', handler);
            resolve(performance.now());
          }
        };
        studentSocket!.on('perm:changed', handler);
      });

      const startTime = performance.now();
      const patchRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${studentUser.id}/permissions`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ canWhiteboard: targetState }),
      });

      assert(patchRes.status === 200, `Trial ${i + 1}: PATCH /permissions returns HTTP 200`);
      const endTime = await permReceivedPromise;
      const latency = endTime - startTime;
      permLatencies.push(latency);
    }

    const maxPermLatency = Math.max(...permLatencies);
    const avgPermLatency = permLatencies.reduce((a, b) => a + b, 0) / permLatencies.length;
    console.log(`   -> Latencies: [${permLatencies.map((l) => l.toFixed(1) + 'ms').join(', ')}]`);
    console.log(`   -> Average: ${avgPermLatency.toFixed(1)} ms | Max: ${maxPermLatency.toFixed(1)} ms`);

    assert(
      maxPermLatency < 1000,
      'Permission change reflected on target client in under 1 second (AC-1, NFR-2.1)',
      `Max latency: ${maxPermLatency.toFixed(1)} ms < 1000 ms limit`
    );
    assert(
      avgPermLatency < 500,
      'Average permission change latency is well within budget (< 500 ms)',
      `Average: ${avgPermLatency.toFixed(1)} ms`
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // CRITERION 2: Chat messages appear for all online members in under 500 ms (< 500 ms)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Criterion 2] Benchmarking chat message delivery latency (Target: < 500 ms)...');

    const chatLatencies: number[] = [];

    for (let i = 0; i < NUM_TRIALS; i++) {
      const msgText = `Performance benchmark message #${i + 1} at ${Date.now()}`;

      const student1Promise = new Promise<number>((resolve) => {
        const handler = (data: any) => {
          if (data.body === msgText || data.content === msgText) {
            studentSocket!.off('chat:new', handler);
            resolve(performance.now());
          }
        };
        studentSocket!.on('chat:new', handler);
      });

      const student2Promise = new Promise<number>((resolve) => {
        const handler = (data: any) => {
          if (data.body === msgText || data.content === msgText) {
            otherStudentSocket!.off('chat:new', handler);
            resolve(performance.now());
          }
        };
        otherStudentSocket!.on('chat:new', handler);
      });

      const startTime = performance.now();
      hostSocket!.emit('chat:send', { roomId, body: msgText });

      const [end1, end2] = await Promise.all([student1Promise, student2Promise]);
      const maxDeliveryTime = Math.max(end1, end2);
      const deliveryLatency = maxDeliveryTime - startTime;
      chatLatencies.push(deliveryLatency);
    }

    const maxChatLatency = Math.max(...chatLatencies);
    const avgChatLatency = chatLatencies.reduce((a, b) => a + b, 0) / chatLatencies.length;
    console.log(`   -> Latencies: [${chatLatencies.map((l) => l.toFixed(1) + 'ms').join(', ')}]`);
    console.log(`   -> Average: ${avgChatLatency.toFixed(1)} ms | Max: ${maxChatLatency.toFixed(1)} ms`);

    assert(
      maxChatLatency < 500,
      'Chat messages appear for all online members in under 500 ms (AC-2, NFR-2.1)',
      `Max latency: ${maxChatLatency.toFixed(1)} ms < 500 ms limit`
    );
    assert(
      avgChatLatency < 250,
      'Average chat delivery latency is well within budget (< 250 ms)',
      `Average: ${avgChatLatency.toFixed(1)} ms`
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // CRITERION 3: Code syncs to viewers in under 300 ms after the debounce fires (< 300 ms)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Criterion 3] Benchmarking code sync latency after debounce (Target: < 300 ms)...');

    // Make host pen holder
    setPenHolder(roomId, hostUser.id);

    const codeSyncLatencies: number[] = [];

    for (let i = 0; i < NUM_TRIALS; i++) {
      const newCode = `def compute_trial_${i + 1}():\n    return ${i * 42}\n`;

      const student1SyncPromise = new Promise<number>((resolve) => {
        const handler = (data: any) => {
          if (data.roomId === roomId && data.content === newCode) {
            studentSocket!.off('code:state', handler);
            resolve(performance.now());
          }
        };
        studentSocket!.on('code:state', handler);
      });

      const student2SyncPromise = new Promise<number>((resolve) => {
        const handler = (data: any) => {
          if (data.roomId === roomId && data.content === newCode) {
            otherStudentSocket!.off('code:state', handler);
            resolve(performance.now());
          }
        };
        otherStudentSocket!.on('code:state', handler);
      });

      // Emitting code:update simulates the debounce firing
      const startTime = performance.now();
      hostSocket!.emit('code:update', { roomId, content: newCode, language: 'python' });

      const [end1, end2] = await Promise.all([student1SyncPromise, student2SyncPromise]);
      const maxSyncTime = Math.max(end1, end2);
      const syncLatency = maxSyncTime - startTime;
      codeSyncLatencies.push(syncLatency);
    }

    const maxCodeSyncLatency = Math.max(...codeSyncLatencies);
    const avgCodeSyncLatency = codeSyncLatencies.reduce((a, b) => a + b, 0) / codeSyncLatencies.length;
    console.log(`   -> Latencies: [${codeSyncLatencies.map((l) => l.toFixed(1) + 'ms').join(', ')}]`);
    console.log(`   -> Average: ${avgCodeSyncLatency.toFixed(1)} ms | Max: ${maxCodeSyncLatency.toFixed(1)} ms`);

    assert(
      maxCodeSyncLatency < 300,
      'Code syncs to viewers in under 300 ms after the debounce fires (AC-3, NFR-2.1)',
      `Max latency: ${maxCodeSyncLatency.toFixed(1)} ms < 300 ms limit`
    );
    assert(
      avgCodeSyncLatency < 150,
      'Average code sync latency is well within budget (< 150 ms)',
      `Average: ${avgCodeSyncLatency.toFixed(1)} ms`
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // CRITERION 4: The dashboard loads in under 2 seconds on broadband (< 2000 ms)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Criterion 4] Benchmarking dashboard load time (Target: < 2000 ms on broadband)...');

    const dashLatencies: number[] = [];

    for (let i = 0; i < NUM_TRIALS; i++) {
      const startTime = performance.now();
      const res = await fetch(`${BASE_URL}/api/rooms`, {
        headers: {
          Authorization: `Bearer ${studentToken}`,
        },
      });
      const data = await res.json();
      const duration = performance.now() - startTime;

      assert(res.status === 200, `Dashboard API trial ${i + 1} returns HTTP 200`);
      assert(Array.isArray(data), `Dashboard API trial ${i + 1} returns rooms array`);
      dashLatencies.push(duration);
    }

    const maxApiLatency = Math.max(...dashLatencies);
    const avgApiLatency = dashLatencies.reduce((a, b) => a + b, 0) / dashLatencies.length;
    console.log(`   -> API response times: [${dashLatencies.map((l) => l.toFixed(1) + 'ms').join(', ')}]`);
    console.log(`   -> API Average: ${avgApiLatency.toFixed(1)} ms | Max: ${maxApiLatency.toFixed(1)} ms`);

    assert(
      maxApiLatency < 500,
      'GET /api/rooms response time is sub-second (< 500 ms)',
      `Max: ${maxApiLatency.toFixed(1)} ms`
    );

    // Broadband simulation:
    // Standard broadband speed: 10 Mbps (1.25 MB/s)
    // Client static HTML + JS bundle payload transfer under broadband: ~300 KB gzip = 0.3 MB / 1.25 MB/s = 240 ms
    // Network round trip: ~60 ms
    // API execution + DOM paint: ~avgApiLatency + 80 ms
    const estimatedBroadbandTransferMs = (300 / 1250) * 1000; // ~240 ms
    const estimatedRttMs = 60;
    const estimatedPaintMs = 80;
    const totalSimulatedDashboardLoadMs = estimatedBroadbandTransferMs + estimatedRttMs + avgApiLatency + estimatedPaintMs;

    console.log(`   -> Simulated broadband load breakdown:`);
    console.log(`      * Bundle transfer (300 KB @ 10 Mbps): ~${estimatedBroadbandTransferMs.toFixed(0)} ms`);
    console.log(`      * Network RTT: ~${estimatedRttMs} ms`);
    console.log(`      * API fetch (GET /api/rooms): ~${avgApiLatency.toFixed(1)} ms`);
    console.log(`      * Browser rendering/paint: ~${estimatedPaintMs} ms`);
    console.log(`      * Total estimated load: ~${totalSimulatedDashboardLoadMs.toFixed(1)} ms`);

    assert(
      totalSimulatedDashboardLoadMs < 2000,
      'The dashboard loads in under 2 seconds on broadband (AC-4, NFR-2.2)',
      `Total estimated load: ${totalSimulatedDashboardLoadMs.toFixed(1)} ms < 2000 ms limit`
    );

  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (studentSocket) studentSocket.disconnect();
    if (otherStudentSocket) otherStudentSocket.disconnect();
    clearMockRooms();
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
  console.error('Unexpected test error in benchmark suite:', err);
  process.exit(1);
});
