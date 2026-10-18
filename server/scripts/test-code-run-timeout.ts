/**
 * Automated Verification Script for US-ERR-06: Code Run Timeout
 * Module: Error States & System Resilience
 * Priority: P0 | Traces to: FRD Section 7
 *
 * Acceptance Criteria:
 * 1. The output panel shows: "Time limit exceeded (3 s)" when timedOut: true.
 * 2. Any partial stdout/stderr is still shown above the timeout message.
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
import { setMockPistonExecutor } from '../src/lib/piston';
import { Me, RunResult, RoomSummary } from '@linkup/shared';

const TEST_PORT = 3116;
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
  console.log('🚀 Running US-ERR-06: Code Run Timeout Tests');
  console.log('============================================================\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. STATIC UI VERIFICATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('[Phase 1] Static Code & Component Architecture Verification...');

  const codeTabPath = path.resolve(__dirname, '../../client/src/features/rooms/CodeTab.tsx');
  const playgroundPath = path.resolve(__dirname, '../../client/src/features/playground/PlaygroundPage.tsx');

  assert(fs.existsSync(codeTabPath), 'CodeTab.tsx exists in client/src/features/rooms');
  assert(fs.existsSync(playgroundPath), 'PlaygroundPage.tsx exists in client/src/features/playground');

  const codeTabSource = fs.readFileSync(codeTabPath, 'utf-8');
  const playgroundSource = fs.readFileSync(playgroundPath, 'utf-8');

  // Verify timeout container and text in CodeTab.tsx (AC-1)
  assert(
    codeTabSource.includes('id="code-run-timeout"') &&
      codeTabSource.includes('data-testid="code-run-timeout"'),
    'CodeTab has timeout element with id="code-run-timeout" and data-testid="code-run-timeout" (AC-1)'
  );

  assert(
    codeTabSource.includes('Time limit exceeded (3 s)'),
    'CodeTab renders "Time limit exceeded (3 s)" message (AC-1)'
  );

  // Verify that partial stdout and partial stderr are positioned ABOVE timeout message in CodeTab.tsx (AC-2)
  const stdoutIndex = codeTabSource.indexOf('id="code-run-stdout"');
  const stderrIndex = codeTabSource.indexOf('id="code-run-stderr"');
  const timeoutIndex = codeTabSource.indexOf('id="code-run-timeout"');

  assert(
    stdoutIndex !== -1 && stderrIndex !== -1 && timeoutIndex !== -1,
    'CodeTab output panel includes stdout, stderr, and timeout sections'
  );

  assert(
    stdoutIndex < timeoutIndex,
    'Any partial stdout is positioned above timeout message in CodeTab (AC-2)'
  );

  assert(
    stderrIndex < timeoutIndex,
    'Any partial stderr is positioned above timeout message in CodeTab (AC-2)'
  );

  // Verify PlaygroundPage layout consistency (AC-1 & AC-2)
  const playStdoutIdx = playgroundSource.indexOf('id="playground-output-stdout"');
  const playStderrIdx = playgroundSource.indexOf('id="playground-output-stderr"');
  const playTimeoutIdx = playgroundSource.indexOf('id="playground-output-timeout"');

  assert(
    playStdoutIdx < playTimeoutIdx && playStderrIdx < playTimeoutIdx,
    'PlaygroundPage also renders partial stdout and stderr above timeout message'
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. SERVER & REALTIME EXECUTION VERIFICATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[Phase 2] Server & Realtime Execution Verification...');

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
    clearPresence();

    const hostUser: Me = {
      id: 'teacher-us-err-06',
      fullName: 'Prof. Timeout Tester',
      role: 'teacher',
      email: 'teacher@timeout.edu',
    };

    const studentUser: Me = {
      id: 'student-us-err-06',
      fullName: 'Alice Timeout',
      role: 'student',
      email: 'alice@timeout.edu',
    };

    const hostToken = 'token-teacher-us-err-06';
    const studentToken = 'token-student-us-err-06';

    setCachedUser(hostToken, hostUser);
    setCachedUser(studentToken, studentUser);

    const roomId = 'room-test-us-err-06';
    const hostRoom: RoomSummary = {
      id: roomId,
      name: 'US-ERR-06 Test Room',
      description: 'US-ERR-06 Code Run Timeout Verification Room',
      joinCode: 'ERR006',
      hostName: hostUser.fullName,
      memberCount: 2,
      myRole: 'host',
      activeSessionId: 'session-us-err-06',
      createdAt: new Date().toISOString(),
      members: [
        {
          userId: hostUser.id,
          fullName: hostUser.fullName,
          userRole: hostUser.role,
          memberRole: 'host',
          joinedAt: new Date().toISOString(),
          permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        },
        {
          userId: studentUser.id,
          fullName: studentUser.fullName,
          userRole: studentUser.role,
          memberRole: 'participant',
          joinedAt: new Date().toISOString(),
          permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        },
      ],
    };

    const studentRoom: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    setMockRooms(hostUser.id, [hostRoom]);
    setMockRooms(studentUser.id, [studentRoom]);

    // Connect Host Socket
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: hostToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => {
      hostSocket!.on('connect', () => {
        hostSocket!.emit('room:join', { roomId }, () => resolve());
      });
    });

    // Connect Student Socket (listening to shared code:run-result)
    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => {
      studentSocket!.on('connect', () => {
        studentSocket!.emit('room:join', { roomId }, () => resolve());
      });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST: Code execution exceeds 3 seconds with partial stdout/stderr
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Simulating code run that exceeds 3 s with partial output...');

    const partialStdout = 'Calculated batch 1: [10, 20, 30]\n';
    const partialStderr = 'Warning: memory buffer approaching threshold\n';

    setMockPistonExecutor(async () => {
      return {
        stdout: partialStdout,
        stderr: `${partialStderr}Time limit exceeded (3 s).`,
        exitCode: 137,
        timeMs: 3012,
        timedOut: true,
        truncated: false,
      };
    });

    let studentReceivedResult: RunResult | null = null;
    studentSocket.on('code:run-result', (data: { roomId: string; result: RunResult }) => {
      if (data.roomId === roomId) {
        studentReceivedResult = data.result;
      }
    });

    const response = await fetch(`${BASE_URL}/api/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        roomId,
        language: 'python',
        code: 'import time\nprint("Calculated batch 1: [10, 20, 30]")\ntime.sleep(5)',
      }),
    });

    assert(response.status === 200, 'POST /api/execute returns HTTP 200 for timed-out execution');
    const result: RunResult = (await response.json()) as RunResult;

    assert(result.timedOut === true, 'RunResult timedOut is true (AC-1)');
    assert(result.stdout === partialStdout, 'Partial stdout is retained in RunResult (AC-2)');
    assert(result.stderr.includes(partialStderr), 'Partial stderr is retained in RunResult (AC-2)');

    // Allow socket propagation
    await new Promise((r) => setTimeout(r, 200));

    assert(
      studentReceivedResult !== null && (studentReceivedResult as unknown as RunResult).timedOut === true,
      'Room members receive code:run-result event with timedOut: true (AC-1)'
    );

    assert(
      (studentReceivedResult as unknown as RunResult)?.stdout === partialStdout,
      'Room members receive partial stdout before timeout (AC-2)'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST: Normal execution (timedOut: false)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Simulating normal code run that completes successfully...');

    setMockPistonExecutor(async () => {
      return {
        stdout: 'All tests passed.\n',
        stderr: '',
        exitCode: 0,
        timeMs: 145,
        timedOut: false,
        truncated: false,
      };
    });

    const normalResponse = await fetch(`${BASE_URL}/api/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        roomId,
        language: 'python',
        code: 'print("All tests passed.")',
      }),
    });

    assert(normalResponse.status === 200, 'Normal execution returns HTTP 200');
    const normalResult: RunResult = (await normalResponse.json()) as RunResult;
    assert(normalResult.timedOut === false, 'Normal execution has timedOut: false');
    assert(normalResult.stdout === 'All tests passed.\n', 'Normal execution stdout is preserved');
  } catch (err: any) {
    assert(false, 'Unexpected error during US-ERR-06 tests', err.message);
  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (studentSocket) studentSocket.disconnect();
    await new Promise<void>((resolve) => testServer.close(() => resolve()));
    setMockPistonExecutor(null);
  }

  console.log('\n============================================================');
  console.log(`Results: ${passedCount} Passed, ${failedCount} Failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests();
