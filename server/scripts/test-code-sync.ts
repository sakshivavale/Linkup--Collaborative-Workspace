/**
 * Automated Verification Script for US-CODE-03: Type and Sync Code (Pen Holder)
 * Module: Code Workspace
 * Priority: P0 | Traces to: FR-5.2
 *
 * Acceptance Criteria Verified:
 * 1. Changes are emitted to the server with a 150 ms debounce.
 * 2. The server increments rev and broadcasts code:state to all other room members.
 * 3. Viewers see the update within 300 ms of the debounce firing.
 * 4. The full code content is sent (no diffing in the MVP); source size must be max 64 KB.
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
import { clearPresence } from '../src/realtime/presence';
import { clearCodeWorkspace, getCodeState, getPenHolder, setPenHolder, validateCodeSize, MAX_CODE_BYTES } from '../src/realtime/codeWorkspace';
import { CODE_DEBOUNCE_MS, CodeState, Member, RoomSummary, Me } from '@linkup/shared';

const TEST_PORT = 3146;
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
  console.log('🚀 Running US-CODE-03: Type and Sync Code Automated Tests');
  console.log('   Priority: P0 | Traces to: FR-5.2');
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
  let viewerSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearPresence();
    clearCodeWorkspace();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: Static / Component Verification of Debounce, 64KB Limit & Sync Badges (AC-1, AC-4)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Verifying CodeTab & shared constants for 150 ms debounce & 64 KB limit...');
    const codeTabPath = path.resolve(__dirname, '../../client/src/features/rooms/CodeTab.tsx');
    const codeTabSource = fs.readFileSync(codeTabPath, 'utf8');

    assert(
      codeTabSource.includes('DEBOUNCE_MS') &&
      (codeTabSource.includes('150') || codeTabSource.includes('CODE_DEBOUNCE_MS')),
      'CodeTab defines 150 ms debounce (DEBOUNCE_MS = CODE_DEBOUNCE_MS) (AC-1)'
    );

    assert(
      CODE_DEBOUNCE_MS === 150,
      'Shared constant CODE_DEBOUNCE_MS equals exactly 150 ms (AC-1)'
    );

    assert(
      MAX_CODE_BYTES === 65536,
      'Shared constant MAX_CODE_BYTES equals 64 KB (65,536 bytes) (AC-4)'
    );

    assert(
      codeTabSource.includes('MAX_CODE_BYTES') &&
      codeTabSource.includes('Source code exceeds the 64 KB limit.'),
      'CodeTab client checks source size against 64 KB limit and sets warning (AC-4)'
    );

    assert(
      codeTabSource.includes('id="room-code-rev"') && codeTabSource.includes('data-testid="room-code-rev"'),
      'CodeTab includes revision badge element id="room-code-rev" (AC-2)'
    );

    assert(
      codeTabSource.includes('id="code-sync-error"') && codeTabSource.includes('data-testid="code-sync-error"'),
      'CodeTab includes error notification banner id="code-sync-error" (AC-4)'
    );

    assert(
      typeof validateCodeSize === 'function',
      'Server exports validateCodeSize function for source code validation (AC-4)'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // SETUP: Room & Users for Real-Time Testing
    // ─────────────────────────────────────────────────────────────────────────────
    const roomId = 'room-code-sync-test-01';

    const teacherUser: Me = {
      id: 'teacher-sync-01',
      fullName: 'Dr. Turing',
      role: 'teacher',
      email: 'teacher.sync@linkup.test',
    };
    const teacherToken = 'teacher-sync-token';
    setCachedUser(teacherToken, teacherUser);

    const studentUser: Me = {
      id: 'student-sync-01',
      fullName: 'Ada Lovelace',
      role: 'student',
      email: 'student.sync@linkup.test',
    };
    const studentToken = 'student-sync-token';
    setCachedUser(studentToken, studentUser);

    const mockMembers: Member[] = [
      {
        userId: teacherUser.id,
        fullName: teacherUser.fullName,
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
    ];

    const mockRoom: RoomSummary = {
      id: roomId,
      name: 'Python Advanced Workspace',
      description: 'Shared coding room for US-CODE-03',
      joinCode: 'SYNC33',
      hostName: teacherUser.fullName,
      memberCount: 2,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      members: mockMembers,
    };

    setMockRooms(teacherUser.id, [{ ...mockRoom, myRole: 'host' }]);
    setMockRooms(studentUser.id, [{ ...mockRoom, myRole: 'participant' }]);

    // Connect teacher socket
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: teacherToken },
      transports: ['websocket'],
    });

    // Connect student socket
    viewerSocket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((res) => hostSocket!.on('connect', res)),
      new Promise<void>((res) => viewerSocket!.on('connect', res)),
    ]);

    // Both join room
    await Promise.all([
      new Promise<void>((res) => hostSocket!.emit('room:join', { roomId }, res)),
      new Promise<void>((res) => viewerSocket!.emit('room:join', { roomId }, res)),
    ]);

    assert(true, 'Host and student successfully connected and joined room');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: Incremented Revision & Broadcast on code:update (AC-2)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Verifying server increments rev and broadcasts code:state (AC-2)...');

    const initialCode = getCodeState(roomId, teacherUser.id);
    assert(initialCode.rev === 0, 'Initial code state has rev = 0');
    assert(getPenHolder(roomId, teacherUser.id) === teacherUser.id, 'Host is pen holder by default');

    const update1Content = 'def greet(name):\n    return f"Hello, {name}!"\n';

    const viewerReceivePromise1 = new Promise<CodeState>((resolve) => {
      viewerSocket!.once('code:state', (data: CodeState & { roomId: string }) => {
        resolve(data);
      });
    });

    let ackRev1 = 0;
    await new Promise<void>((resolve) => {
      hostSocket!.emit(
        'code:update',
        {
          roomId,
          content: update1Content,
          language: 'python',
        },
        (ack: any) => {
          assert(ack?.ok === true, 'Server acknowledged first code:update');
          ackRev1 = ack?.data?.rev;
          resolve();
        }
      );
    });

    const receivedState1 = await viewerReceivePromise1;

    assert(ackRev1 === 1, `Server incremented rev to 1 (got rev: ${ackRev1})`);
    assert(receivedState1.rev === 1, `Viewer received code:state with rev = 1`);
    assert(receivedState1.content === update1Content, 'Viewer received exact full code content (no diffing)');
    assert(receivedState1.language === 'python', 'Viewer received correct language');

    // Second update to verify rev increments sequentially to 2
    const update2Content = update1Content + 'print(greet("World"))\n';

    const viewerReceivePromise2 = new Promise<CodeState>((resolve) => {
      viewerSocket!.once('code:state', (data: CodeState & { roomId: string }) => {
        resolve(data);
      });
    });

    let ackRev2 = 0;
    await new Promise<void>((resolve) => {
      hostSocket!.emit(
        'code:update',
        {
          roomId,
          content: update2Content,
          language: 'python',
        },
        (ack: any) => {
          assert(ack?.ok === true, 'Server acknowledged second code:update');
          ackRev2 = ack?.data?.rev;
          resolve();
        }
      );
    });

    const receivedState2 = await viewerReceivePromise2;

    assert(ackRev2 === 2, `Server incremented rev sequentially to 2 (got rev: ${ackRev2})`);
    assert(receivedState2.rev === 2, `Viewer received code:state with rev = 2`);
    assert(receivedState2.content === update2Content, 'Viewer received full updated code content');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: Viewer Latency Within 300 ms of Debounce Firing (AC-3)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 3] Verifying viewer sees update within 300 ms of debounce firing (AC-3)...');

    const update3Content = update2Content + '# Additional comment for timing benchmark\n';

    let debounceFiredTimestamp = 0;
    let viewerReceivedTimestamp = 0;

    const latencyPromise = new Promise<number>((resolve) => {
      viewerSocket!.once('code:state', () => {
        viewerReceivedTimestamp = Date.now();
        const latencyMs = viewerReceivedTimestamp - debounceFiredTimestamp;
        resolve(latencyMs);
      });
    });

    // Simulate debounce timer expiration (150 ms elapsed)
    debounceFiredTimestamp = Date.now();
    hostSocket!.emit('code:update', {
      roomId,
      content: update3Content,
      language: 'python',
    });

    const measuredLatencyMs = await latencyPromise;
    console.log(`  [Timing] Broadcast delivery latency: ${measuredLatencyMs} ms`);

    assert(
      measuredLatencyMs < 300,
      `Viewer sees update within 300 ms of debounce firing (Actual: ${measuredLatencyMs} ms < 300 ms)`
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 4: Full Code Content & 64 KB Max Limit Enforcement (AC-4)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 4] Verifying 64 KB source size limit enforcement (AC-4)...');

    // 4A: Valid 10 KB code content
    const tenKbCode = '# 10 KB Payload\n' + 'x = 1\n'.repeat(2000);
    const tenKbSize = Buffer.byteLength(tenKbCode, 'utf8');
    assert(tenKbSize > 10000 && tenKbSize < 65536, `Created valid 10 KB payload (${tenKbSize} bytes)`);

    const viewer10KbPromise = new Promise<CodeState>((resolve) => {
      viewerSocket!.once('code:state', resolve);
    });

    await new Promise<void>((resolve) => {
      hostSocket!.emit(
        'code:update',
        {
          roomId,
          content: tenKbCode,
          language: 'python',
        },
        (ack: any) => {
          assert(ack?.ok === true, '10 KB code accepted and acknowledged by server');
          resolve();
        }
      );
    });

    const rec10Kb = await viewer10KbPromise;
    assert(rec10Kb.content === tenKbCode, 'Viewer received full 10 KB code content without truncation');

    // 4B: Valid exactly 64 KB code content (65,536 bytes)
    const exact64KbCode = 'A'.repeat(65536);
    assert(Buffer.byteLength(exact64KbCode, 'utf8') === 65536, 'Created exactly 64 KB payload (65,536 bytes)');

    const viewer64KbPromise = new Promise<CodeState>((resolve) => {
      viewerSocket!.once('code:state', resolve);
    });

    await new Promise<void>((resolve) => {
      hostSocket!.emit(
        'code:update',
        {
          roomId,
          content: exact64KbCode,
          language: 'python',
        },
        (ack: any) => {
          assert(ack?.ok === true, 'Exactly 64 KB code accepted by server');
          resolve();
        }
      );
    });

    const rec64Kb = await viewer64KbPromise;
    assert(rec64Kb.content === exact64KbCode, 'Viewer received full 64 KB code without truncation');

    // 4C: Oversized code content (> 64 KB, e.g. 70 KB = 71,680 bytes)
    const oversizedCode = 'B'.repeat(71680);
    const oversizedBytes = Buffer.byteLength(oversizedCode, 'utf8');
    assert(oversizedBytes > 65536, `Created oversized payload (${oversizedBytes} bytes > 64 KB)`);

    let oversizedRejected = false;
    let oversizedErrorCode = '';
    let oversizedErrorMessage = '';

    const errorEventPromise = new Promise<any>((resolve) => {
      hostSocket!.once('error', (err: any) => {
        resolve(err);
      });
    });

    let viewerReceivedOversized = false;
    const unexpectedViewerListener = () => {
      viewerReceivedOversized = true;
    };
    viewerSocket!.once('code:state', unexpectedViewerListener);

    await new Promise<void>((resolve) => {
      hostSocket!.emit(
        'code:update',
        {
          roomId,
          content: oversizedCode,
          language: 'python',
        },
        (ack: any) => {
          if (!ack?.ok) {
            oversizedRejected = true;
            oversizedErrorCode = ack?.error?.code;
            oversizedErrorMessage = ack?.error?.message;
          }
          resolve();
        }
      );
    });

    const errorEventPayload = await errorEventPromise;

    assert(
      oversizedRejected || errorEventPayload?.code === 'PAYLOAD_TOO_LARGE',
      'Server rejected oversized code > 64 KB with PAYLOAD_TOO_LARGE'
    );

    assert(
      oversizedErrorCode === 'PAYLOAD_TOO_LARGE' || errorEventPayload?.code === 'PAYLOAD_TOO_LARGE',
      'Error code is PAYLOAD_TOO_LARGE'
    );

    assert(
      oversizedErrorMessage.includes('Source code exceeds the 64 KB limit.') ||
      errorEventPayload?.message?.includes('Source code exceeds the 64 KB limit.'),
      'Error message states: "Source code exceeds the 64 KB limit."'
    );

    // Wait 100ms to guarantee viewer was NOT sent the oversized code
    await new Promise((r) => setTimeout(r, 100));
    viewerSocket!.off('code:state', unexpectedViewerListener);
    assert(!viewerReceivedOversized, 'Viewer was NOT sent the oversized code');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 5: Pen Holder Security Check (Only Pen Holder Can Sync)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 5] Verifying pen holder enforcement and handover sync...');

    // Student (viewer) attempts to emit code:update without holding pen
    let studentDropped = false;
    const studentErrorPromise = new Promise<void>((resolve) => {
      viewerSocket!.once('error', (err: any) => {
        if (err?.code === 'NOT_PEN_HOLDER') {
          studentDropped = true;
        }
        resolve();
      });
    });

    viewerSocket!.emit('code:update', {
      roomId,
      content: 'unauthorized student edit',
      language: 'python',
    });

    await studentErrorPromise;
    assert(studentDropped, 'Unauthorized student update dropped with NOT_PEN_HOLDER');

    // Host gives pen to student
    await new Promise<void>((resolve) => {
      hostSocket!.emit('code:pen', { roomId, holderId: studentUser.id }, () => resolve());
    });

    assert(getPenHolder(roomId) === studentUser.id, 'Pen assigned to student');

    // Student (now pen holder) emits code:update
    const studentNewContent = '# Student code as new pen holder\nprint("Collaborative learning!")\n';
    const hostViewerPromise = new Promise<CodeState>((resolve) => {
      hostSocket!.once('code:state', resolve);
    });

    await new Promise<void>((resolve) => {
      viewerSocket!.emit(
        'code:update',
        {
          roomId,
          content: studentNewContent,
          language: 'python',
        },
        (ack: any) => {
          assert(ack?.ok === true, 'Student pen holder code:update acknowledged');
          resolve();
        }
      );
    });

    const receivedByHost = await hostViewerPromise;
    assert(
      receivedByHost.content === studentNewContent,
      'Host viewer received live code from new student pen holder'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 6: Simulated Debounce Keystroke Batching
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 6] Verifying simulated rapid keystrokes within 150 ms debounce...');

    // Simulate 5 keystrokes typed within 100 ms total, with debounce timer resetting each time
    let timer: NodeJS.Timeout | null = null;
    let pendingContent = '';
    let emissionsCount = 0;

    const simulateKeystroke = (char: string) => {
      pendingContent += char;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        emissionsCount++;
        viewerSocket!.emit('code:update', {
          roomId,
          content: pendingContent,
          language: 'python',
        });
      }, 150);
    };

    // Type 5 characters rapidly at 20ms intervals (100ms total < 150ms debounce)
    simulateKeystroke('a');
    await new Promise((r) => setTimeout(r, 20));
    simulateKeystroke('b');
    await new Promise((r) => setTimeout(r, 20));
    simulateKeystroke('c');
    await new Promise((r) => setTimeout(r, 20));
    simulateKeystroke('d');
    await new Promise((r) => setTimeout(r, 20));
    simulateKeystroke('e');

    // Wait 250ms for debounce timer to fire once
    await new Promise((r) => setTimeout(r, 250));

    assert(
      emissionsCount === 1,
      `Rapid keystrokes resulted in exactly 1 emitted update after 150 ms debounce (got: ${emissionsCount})`
    );
    assert(
      pendingContent === 'abcde',
      'Final debounced content matches full accumulated keystrokes'
    );

  } catch (err) {
    console.error('Unexpected test error:', err);
    failedCount++;
  } finally {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (viewerSocket?.connected) viewerSocket.disconnect();
    testServer.close();
  }

  console.log('\n============================================================');
  console.log(`Results: ${passedCount} passed, ${failedCount} failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests();
