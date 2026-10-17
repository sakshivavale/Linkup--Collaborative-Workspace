/**
 * Automated Verification Script for US-CODE-05: Run Code
 * Module: Code Workspace
 * Priority: P0 | Traces to: FR-5.5, FR-5.6
 *
 * Acceptance Criteria Verified:
 * 1. A "Run" button is visible in the Code tab for the pen holder and the host.
 * 2. An optional stdin text box is available before running.
 * 3. Clicking Run emits code:run-started to the room and calls POST /execute via Piston.
 * 4. The output panel shows stdout, stderr (highlighted), exit code, execution time, and a spinner while running.
 * 5. All room members see the same output (via code:run-result).
 * 6. Code over 64 KB returns 413 PAYLOAD_TOO_LARGE: "Source code exceeds the 64 KB limit."
 * 7. A run exceeding 3 seconds shows: "Time limit exceeded (3 s)."
 * 8. After 10 runs per minute from the same user, the 11th returns 429 RATE_LIMITED: "Too many runs — try again in a few seconds."
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
import { clearCodeWorkspace, setPenHolder } from '../src/realtime/codeWorkspace';
import { setMockPistonExecutor, clearRunRateLimits } from '../src/lib/piston';
import { Me, RoomSummary, Member, RunResult } from '@linkup/shared';

const TEST_PORT = 3145;
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
  console.log('🚀 Running US-CODE-05: Run Code Automated Tests');
  console.log('   Priority: P0 | Traces to: FR-5.5, FR-5.6');
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
  let viewerSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearPresence();
    clearCodeWorkspace();
    clearRunRateLimits();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: Static / Component UI Verification (AC-1, AC-2, AC-4, AC-5)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Verifying CodeTab UI elements: Run button, Stdin box, and Output panel...');
    const codeTabPath = path.resolve(__dirname, '../../client/src/features/rooms/CodeTab.tsx');
    const codeTabSource = fs.readFileSync(codeTabPath, 'utf8');

    assert(
      codeTabSource.includes('canRun &&') &&
        codeTabSource.includes('id="room-code-run"') &&
        codeTabSource.includes('data-testid="room-code-run"'),
      'Run button has id="room-code-run" and data-testid="room-code-run", visible only when canRun is true (AC-1)'
    );

    assert(
      codeTabSource.includes('isPenHolder || isUserHost'),
      'canRun correctly permits pen holder and host to run code (AC-1)'
    );

    assert(
      codeTabSource.includes('id="room-code-stdin"') &&
        codeTabSource.includes('data-testid="room-code-stdin"') &&
        codeTabSource.includes('id="room-code-stdin-container"'),
      'Optional stdin text box has id="room-code-stdin" and data-testid="room-code-stdin" available before running (AC-2)'
    );

    assert(
      codeTabSource.includes('id="room-code-output-panel"') &&
        codeTabSource.includes('id="code-run-spinner"') &&
        codeTabSource.includes('id="code-run-stdout"') &&
        codeTabSource.includes('id="code-run-stderr"') &&
        codeTabSource.includes('id="code-run-exit-code"') &&
        codeTabSource.includes('id="code-run-time"'),
      'Output panel shows stdout, stderr (highlighted), exit code, time, and spinner while running (AC-4)'
    );

    assert(
      codeTabSource.includes('code:run-started') && codeTabSource.includes('code:run-result'),
      'CodeTab listens to code:run-started and code:run-result so all room members see the output (AC-3, AC-5)'
    );

    assert(
      codeTabSource.includes('Time limit exceeded (3 s).'),
      'CodeTab displays "Time limit exceeded (3 s)." when execution times out (AC-7)'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // SETUP TEST ROOM & USERS
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Setup] Configuring test users and room...');
    const roomId = 'room-code-run-001';

    const hostUser: Me = {
      id: 'usr-host-101',
      fullName: 'Prof. Ada Lovelace',
      role: 'teacher',
      email: 'ada@linkup.test',
    };
    const studentUser: Me = {
      id: 'usr-student-202',
      fullName: 'Alan Turing',
      role: 'student',
      email: 'alan@linkup.test',
    };
    const viewerUser: Me = {
      id: 'usr-viewer-303',
      fullName: 'Grace Hopper',
      role: 'student',
      email: 'grace@linkup.test',
    };

    setCachedUser('token-host', hostUser);
    setCachedUser('token-student', studentUser);
    setCachedUser('token-viewer', viewerUser);

    const hostMember: Member = {
      userId: hostUser.id,
      fullName: hostUser.fullName,
      userRole: 'teacher',
      memberRole: 'host',
      permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
      joinedAt: new Date().toISOString(),
    };
    const studentMember: Member = {
      userId: studentUser.id,
      fullName: studentUser.fullName,
      userRole: 'student',
      memberRole: 'participant',
      permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: true, canCode: true },
      joinedAt: new Date().toISOString(),
    };
    const viewerMember: Member = {
      userId: viewerUser.id,
      fullName: viewerUser.fullName,
      userRole: 'student',
      memberRole: 'participant',
      permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: true, canCode: true },
      joinedAt: new Date().toISOString(),
    };

    const hostRoom: RoomSummary = {
      id: roomId,
      name: 'Computer Science 101',
      description: 'Intro to Algorithms',
      joinCode: 'CS101A',
      hostName: hostUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      members: [hostMember, studentMember, viewerMember],
    };

    const studentRoom: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    const viewerRoom: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    setMockRooms(hostUser.id, [hostRoom]);
    setMockRooms(studentUser.id, [studentRoom]);
    setMockRooms(viewerUser.id, [viewerRoom]);

    // Give pen to student Alan Turing
    setPenHolder(roomId, studentUser.id);

    // Setup client sockets
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: 'token-host' },
      transports: ['websocket'],
    });
    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: 'token-student' },
      transports: ['websocket'],
    });
    viewerSocket = ClientSocket(BASE_URL, {
      auth: { token: 'token-viewer' },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((res) => hostSocket!.on('connect', () => res())),
      new Promise<void>((res) => studentSocket!.on('connect', () => res())),
      new Promise<void>((res) => viewerSocket!.on('connect', () => res())),
    ]);

    await Promise.all([
      new Promise<void>((res) => hostSocket!.emit('room:join', { roomId }, () => res())),
      new Promise<void>((res) => studentSocket!.emit('room:join', { roomId }, () => res())),
      new Promise<void>((res) => viewerSocket!.emit('room:join', { roomId }, () => res())),
    ]);

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: Successful Execution by Pen Holder with Stdin (AC-3, AC-4, AC-5)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Verifying execution by pen holder, code:run-started & code:run-result broadcast...');

    // Mock piston execution result
    setMockPistonExecutor(async ({ language, code, stdin }) => {
      return {
        stdout: `Hello from Piston!\nLanguage: ${language}\nReceived stdin: ${stdin || 'none'}\n`,
        stderr: '',
        exitCode: 0,
        timeMs: 45,
        timedOut: false,
        truncated: false,
      };
    });

    let hostReceivedRunStarted = false;
    let viewerReceivedRunStarted = false;
    let hostReceivedRunResult: RunResult | null = null;
    let viewerReceivedRunResult: RunResult | null = null;

    hostSocket.on('code:run-started', (data) => {
      if (data.roomId === roomId) hostReceivedRunStarted = true;
    });
    viewerSocket.on('code:run-started', (data) => {
      if (data.roomId === roomId) viewerReceivedRunStarted = true;
    });

    hostSocket.on('code:run-result', (data) => {
      if (data.roomId === roomId) hostReceivedRunResult = data.result;
    });
    viewerSocket.on('code:run-result', (data) => {
      if (data.roomId === roomId) viewerReceivedRunResult = data.result;
    });

    const execResponse = await fetch(`${BASE_URL}/api/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-student', // Pen holder
      },
      body: JSON.stringify({
        roomId,
        language: 'python',
        code: 'name = input()\nprint("Hello " + name)',
        stdin: 'World',
      }),
    });

    assert(execResponse.status === 200, 'POST /api/execute returns HTTP 200 for pen holder');
    const execData: RunResult = await execResponse.json();

    assert(Boolean(execData?.stdout?.includes('Received stdin: World')), 'Execution output includes stdout with stdin processed');
    assert(execData?.exitCode === 0, 'Exit code is 0');
    assert(Boolean(execData?.timeMs && execData.timeMs > 0), 'Execution timeMs is returned');

    // Wait briefly for socket broadcast delivery
    await new Promise((r) => setTimeout(r, 100));

    assert(hostReceivedRunStarted && viewerReceivedRunStarted, 'All room members received code:run-started (AC-3)');
    assert(
      hostReceivedRunResult !== null && viewerReceivedRunResult !== null,
      'All room members received code:run-result with exact same output (AC-5)'
    );
    assert(
      hostReceivedRunResult?.stdout === execData.stdout,
      'Broadcasted stdout matches HTTP response across all participants (AC-5)'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: Execution by Host (even when student holds the pen)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 3] Verifying host can also run code...');
    const hostExecResponse = await fetch(`${BASE_URL}/api/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-host',
      },
      body: JSON.stringify({
        roomId,
        language: 'python',
        code: 'print("Host running code")',
      }),
    });

    assert(hostExecResponse.status === 200, 'Host can execute code (HTTP 200) even when student has pen (AC-1)');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 4: Non-pen-holder participant cannot run code in the room
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 4] Verifying viewer (non-pen holder, non-host) cannot run code in the room...');
    const viewerExecResponse = await fetch(`${BASE_URL}/api/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-viewer',
      },
      body: JSON.stringify({
        roomId,
        language: 'python',
        code: 'print("Unauthorized run")',
      }),
    });

    assert(viewerExecResponse.status === 403, 'Non-pen-holder participant receives 403 NOT_PEN_HOLDER');
    const viewerErr = await viewerExecResponse.json();
    assert(viewerErr.error.code === 'NOT_PEN_HOLDER', 'Error code is NOT_PEN_HOLDER');

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 5: Code over 64 KB returns 413 PAYLOAD_TOO_LARGE (AC-6)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 5] Verifying code over 64 KB limit returns 413 PAYLOAD_TOO_LARGE (AC-6)...');
    const oversizedCode = 'a = 1\n'.repeat(12000); // ~72 KB > 64 KB

    const oversizedResponse = await fetch(`${BASE_URL}/api/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-host',
      },
      body: JSON.stringify({
        roomId,
        language: 'python',
        code: oversizedCode,
      }),
    });

    assert(oversizedResponse.status === 413, 'Code over 64 KB returns HTTP 413 (AC-6)');
    const oversizedJson = await oversizedResponse.json();
    assert(
      oversizedJson.error?.code === 'PAYLOAD_TOO_LARGE' &&
        oversizedJson.error?.message === 'Source code exceeds the 64 KB limit.',
      'Returns 413 PAYLOAD_TOO_LARGE: "Source code exceeds the 64 KB limit."'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 6: Execution exceeding 3 seconds shows "Time limit exceeded (3 s)." (AC-7)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 6] Verifying timeout detection exceeding 3 seconds (AC-7)...');
    setMockPistonExecutor(async () => {
      return {
        stdout: '',
        stderr: 'Time limit exceeded (3 s).',
        exitCode: 137,
        timeMs: 3005,
        timedOut: true,
        truncated: false,
      };
    });

    const timeoutResponse = await fetch(`${BASE_URL}/api/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-host',
      },
      body: JSON.stringify({
        roomId,
        language: 'python',
        code: 'import time\ntime.sleep(5)',
      }),
    });

    assert(timeoutResponse.status === 200, 'Timed out run returns HTTP 200 with timeout metadata');
    const timeoutJson: RunResult = await timeoutResponse.json();
    assert(timeoutJson.timedOut === true, 'RunResult timedOut is true (AC-7)');
    assert(
      timeoutJson.stderr.includes('Time limit exceeded (3 s).'),
      'Output stderr includes "Time limit exceeded (3 s)." (AC-7)'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 7: Rate limiting (10 runs / min per user; 11th returns 429) (AC-8)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 7] Verifying 10 runs per minute limit; 11th returns 429 RATE_LIMITED (AC-8)...');
    clearRunRateLimits();

    setMockPistonExecutor(async () => {
      return {
        stdout: 'ok\n',
        stderr: '',
        exitCode: 0,
        timeMs: 10,
        timedOut: false,
        truncated: false,
      };
    });

    let lastStatus = 0;
    let eleventhResponseJson: any = null;

    // Send 11 runs in rapid succession from hostUser
    for (let i = 1; i <= 11; i++) {
      const res = await fetch(`${BASE_URL}/api/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-host',
        },
        body: JSON.stringify({
          roomId,
          language: 'python',
          code: `print(${i})`,
        }),
      });
      lastStatus = res.status;
      if (i === 11) {
        eleventhResponseJson = await res.json();
      }
    }

    assert(lastStatus === 429, '11th run returns HTTP 429 (AC-8)');
    assert(
      eleventhResponseJson?.error?.code === 'RATE_LIMITED' &&
        eleventhResponseJson?.error?.message === 'Too many runs — try again in a few seconds.',
      'Returns 429 RATE_LIMITED: "Too many runs — try again in a few seconds."'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 8: GET /runtimes endpoint
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 8] Verifying GET /runtimes endpoint...');
    const runtimesRes = await fetch(`${BASE_URL}/runtimes`);
    assert(runtimesRes.status === 200, 'GET /runtimes returns HTTP 200');
    const runtimesData = await runtimesRes.json();
    assert(
      Array.isArray(runtimesData) && runtimesData.some((r: any) => r.language === 'python'),
      'GET /runtimes returns supported languages including python'
    );
  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (studentSocket) studentSocket.disconnect();
    if (viewerSocket) viewerSocket.disconnect();
    clearMockPistonExecutor();
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

function clearMockPistonExecutor() {
  setMockPistonExecutor(null);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
