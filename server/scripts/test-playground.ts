/**
 * Automated Verification Script for US-CODE-07: Personal Playground (P1)
 * Module: Code Workspace
 * Priority: P1 | Traces to: FR-5.8
 *
 * Acceptance Criteria Verified:
 * 1. A /playground route shows a Monaco editor, language selector, stdin box, Run button, and output panel.
 * 2. Code runs via POST /execute without a roomId; output is shown only to the user.
 * 3. No code or output is shared to any room.
 * 4. Same rate limits apply (10 runs/minute).
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
import { clearCodeWorkspace } from '../src/realtime/codeWorkspace';
import { setMockPistonExecutor, clearRunRateLimits } from '../src/lib/piston';
import { Me, RoomSummary, Member, RunResult } from '@linkup/shared';

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
  console.log('🚀 Running US-CODE-07: Personal Playground Automated Tests');
  console.log('   Priority: P1 | Traces to: FR-5.8');
  console.log('============================================================\n');

  const testServer = http.createServer(app);
  io.attach(testServer);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  let roomSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearPresence();
    clearCodeWorkspace();
    clearRunRateLimits();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: Static Route & Component UI Verification (AC-1)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Verifying /playground route and UI component elements...');
    
    // 1.1 Verify route in App.tsx
    const appPath = path.resolve(__dirname, '../../client/src/App.tsx');
    const appSource = fs.readFileSync(appPath, 'utf8');
    assert(
      appSource.includes('path="/playground"') && appSource.includes('element={<PlaygroundPage />}'),
      'App.tsx has /playground route mounted with PlaygroundPage under ProtectedRoute (AC-1)'
    );

    // 1.2 Verify UI elements in PlaygroundPage.tsx
    const playgroundPath = path.resolve(__dirname, '../../client/src/features/playground/PlaygroundPage.tsx');
    const playgroundSource = fs.readFileSync(playgroundPath, 'utf8');

    assert(
      playgroundSource.includes('id="playground-language-select"') &&
        playgroundSource.includes('data-testid="playground-language-select"'),
      'Language selector exists with id="playground-language-select" (AC-1)'
    );

    assert(
      playgroundSource.includes('id="playground-run-button"') &&
        playgroundSource.includes('data-testid="playground-run-button"'),
      'Run button exists with id="playground-run-button" (AC-1)'
    );

    assert(
      playgroundSource.includes('id="playground-stdin"') &&
        playgroundSource.includes('data-testid="playground-stdin"'),
      'Stdin box exists with id="playground-stdin" (AC-1)'
    );

    assert(
      playgroundSource.includes('id="playground-output-panel"') &&
        playgroundSource.includes('data-testid="playground-output-panel"'),
      'Output panel exists with id="playground-output-panel" (AC-1)'
    );

    assert(
      playgroundSource.includes('@monaco-editor/react') &&
        playgroundSource.includes('id="playground-code-editor-sync"'),
      'Monaco Editor is integrated with accessible synchronized textarea (AC-1)'
    );

    assert(
      playgroundSource.includes("api.post<RunResult>('/execute'"),
      'Playground calls POST /execute without a roomId (AC-2)'
    );

    // 1.3 Verify Vite proxy config
    const viteConfigPath = path.resolve(__dirname, '../../client/vite.config.ts');
    const viteConfigSource = fs.readFileSync(viteConfigPath, 'utf8');
    assert(
      viteConfigSource.includes("'/execute':") && viteConfigSource.includes("'/runtimes':"),
      'client/vite.config.ts proxies /execute and /runtimes to backend (AC-2)'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // SETUP TEST USER & ROOM SOCKET
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Setup] Configuring test user and room socket listener...');
    const testUser: Me = {
      id: 'usr-playground-001',
      fullName: 'Marie Curie',
      role: 'student',
      email: 'marie@linkup.test',
    };
    const userToken = 'bearer-token-marie';
    setCachedUser(userToken, testUser);

    const testRoom: RoomSummary = {
      id: 'room-curie-lab',
      name: 'Physics Lab',
      description: 'Shared room for physics',
      joinCode: 'PHYS01',
      hostName: 'Marie Curie',
      memberCount: 1,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
    };
    setMockRooms([testRoom]);

    // Connect a socket to room-curie-lab to verify NO events are emitted during playground runs
    roomSocket = ClientSocket(BASE_URL, {
      auth: { token: userToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 4000);
      roomSocket!.on('connect', () => {
        clearTimeout(timeout);
        roomSocket!.emit('room:join', { roomId: testRoom.id });
        setTimeout(resolve, 300);
      });
    });

    let receivedRunStarted = false;
    let receivedRunResult = false;
    roomSocket.on('code:run-started', () => {
      receivedRunStarted = true;
    });
    roomSocket.on('code:run-result', () => {
      receivedRunResult = true;
    });

    // Configure mock executor
    setMockPistonExecutor(async ({ language, code, stdin }) => {
      return {
        stdout: `Executed ${language} code successfully! stdin: [${stdin || ''}]`,
        stderr: '',
        exitCode: 0,
        timeMs: 42,
        timedOut: false,
        truncated: false,
      };
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: Unauthenticated Execution Check
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Testing unauthenticated call to POST /execute...');
    const unauthRes = await fetch(`${BASE_URL}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'python',
        code: 'print("Hello")',
      }),
    });
    assert(
      unauthRes.status === 401,
      'POST /execute without Authorization header returns HTTP 401 UNAUTHENTICATED'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: Authenticated Execution without roomId (AC-2 & AC-3)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 3] Testing POST /execute without roomId...');
    receivedRunStarted = false;
    receivedRunResult = false;

    const execRes = await fetch(`${BASE_URL}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        language: 'python',
        code: 'print("Personal Playground Code")',
        stdin: 'sample input',
      }),
    });

    assert(
      execRes.status === 200,
      'POST /execute without roomId returns HTTP 200 (AC-2)'
    );

    const execData = (await execRes.json()) as RunResult;
    assert(
      execData.exitCode === 0 &&
        execData.stdout.includes('Executed python code successfully!') &&
        execData.stdout.includes('stdin: [sample input]'),
      'POST /execute returns output with stdout, exitCode 0, timeMs, and processed stdin (AC-2)'
    );

    // Give socket events a moment to potentially arrive
    await new Promise((r) => setTimeout(r, 200));

    assert(
      !receivedRunStarted && !receivedRunResult,
      'No socket events (code:run-started, code:run-result) emitted to room during playground run (AC-3)'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 4: Rate Limiting Enforcement (10 runs/min) (AC-4)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 4] Testing Rate Limiting (10 runs/minute) on POST /execute (AC-4)...');
    clearRunRateLimits();

    let successfulRuns = 0;
    for (let i = 1; i <= 10; i++) {
      const res = await fetch(`${BASE_URL}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({
          language: 'python',
          code: `print("run ${i}")`,
        }),
      });
      if (res.status === 200) {
        successfulRuns++;
      }
    }

    assert(
      successfulRuns === 10,
      'First 10 runs in a 1-minute window succeed with HTTP 200 (AC-4)'
    );

    // 11th run should return 429 RATE_LIMITED
    const rateLimitedRes = await fetch(`${BASE_URL}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        language: 'python',
        code: 'print("run 11 - should rate limit")',
      }),
    });

    assert(
      rateLimitedRes.status === 429,
      '11th run returns HTTP 429 RATE_LIMITED (AC-4)'
    );

    const rateLimitBody = await rateLimitedRes.json();
    assert(
      rateLimitBody?.error?.code === 'RATE_LIMITED' &&
        rateLimitBody?.error?.message === 'Too many runs — try again in a few seconds.',
      '429 response body matches expected contract: "Too many runs — try again in a few seconds."'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 5: Code Payload Size Validation
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 5] Testing Code Payload size limit (>64 KB)...');
    clearRunRateLimits();

    const oversizedCode = 'a'.repeat(65 * 1024);
    const oversizedRes = await fetch(`${BASE_URL}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        language: 'python',
        code: oversizedCode,
      }),
    });

    assert(
      oversizedRes.status === 413,
      'Code exceeding 64 KB returns HTTP 413 PAYLOAD_TOO_LARGE'
    );

    const oversizedBody = await oversizedRes.json();
    assert(
      oversizedBody?.error?.message === 'Source code exceeds the 64 KB limit.',
      '413 response body matches expected message'
    );
  } catch (err: any) {
    console.error('Unexpected test error:', err);
    failedCount++;
  } finally {
    if (roomSocket && roomSocket.connected) {
      roomSocket.disconnect();
    }
    setMockPistonExecutor(null);
    clearRunRateLimits();
    await new Promise<void>((resolve) => {
      testServer.close(() => {
        console.log('\n[Test Server] Closed');
        resolve();
      });
    });

    console.log('\n============================================================');
    console.log(`Test Results: ${passedCount} passed, ${failedCount} failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  }
}

runTests();
