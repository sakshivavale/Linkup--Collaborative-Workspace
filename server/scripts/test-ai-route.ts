/**
 * Automated Verification Script for AI Teaching Assistant Endpoint (FEAT-AI-01)
 *
 * Verifies:
 * 1. POST /api/ai/chat rejects unauthenticated requests (401 UNAUTHENTICATED).
 * 2. POST /api/ai/chat validates inputs (400 VALIDATION on empty/missing prompt).
 * 3. POST /api/ai/chat handles missing API credentials gracefully (503 AI_KEY_MISSING).
 */

import http from 'http';
import { app } from '../src/app';
import { setCachedUser } from '../src/lib/supabase';
import { Me } from '@linkup/shared';

const TEST_PORT = 3192;
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
  console.log('\n🚀 Starting AI Route Verification Suite (/api/ai/chat)...\n');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));

  const testUser: Me = {
    id: 'user-ai-test-student',
    email: 'student@linkup.test',
    fullName: 'Test Student',
    role: 'student',
  };
  const testToken = 'token_ai_test_valid';
  setCachedUser(testToken, testUser);

  try {
    // 1. Unauthenticated request check
    console.log('Case 1: Authentication Guard');
    const resNoAuth = await fetch(`${BASE_URL}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Hello AI' }),
    });
    assert(
      resNoAuth.status === 401,
      'Unauthenticated request returns 401 status',
      `Got status ${resNoAuth.status}`
    );
    const dataNoAuth = (await resNoAuth.json()) as any;
    assert(
      dataNoAuth?.error?.code === 'UNAUTHENTICATED',
      'Unauthenticated error code matches UNAUTHENTICATED',
      `Got ${dataNoAuth?.error?.code}`
    );

    // 2. Input validation check (empty prompt)
    console.log('\nCase 2: Input Validation');
    const resEmptyPrompt = await fetch(`${BASE_URL}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testToken}`,
      },
      body: JSON.stringify({ prompt: '   ' }),
    });
    assert(
      resEmptyPrompt.status === 400,
      'Empty prompt returns 400 status',
      `Got status ${resEmptyPrompt.status}`
    );
    const dataEmpty = (await resEmptyPrompt.json()) as any;
    assert(
      dataEmpty?.error?.code === 'VALIDATION',
      'Validation error code matches VALIDATION',
      `Got ${dataEmpty?.error?.code}`
    );

    // 3. Service configuration check (missing key returns 503)
    console.log('\nCase 3: Missing Key Graceful Degradation');
    const resValidReq = await fetch(`${BASE_URL}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testToken}`,
      },
      body: JSON.stringify({
        prompt: 'How does binary search work?',
        codeContext: 'def binary_search(arr, target): pass',
      }),
    });
    // In local dev without GROQ_API_KEY/GEMINI_API_KEY set, it should return 503 AI_KEY_MISSING
    assert(
      resValidReq.status === 503 || resValidReq.status === 200,
      'Valid request returns 503 (key unconfigured) or 200 (if key provided)',
      `Got status ${resValidReq.status}`
    );
    const dataValid = (await resValidReq.json()) as any;
    if (resValidReq.status === 503) {
      assert(
        dataValid?.error?.code === 'AI_KEY_MISSING',
        'Error code matches AI_KEY_MISSING',
        `Got ${dataValid?.error?.code}`
      );
    } else {
      assert(
        Boolean(dataValid?.response),
        'AI response text returned successfully',
        `Got response ${dataValid?.response?.slice(0, 50)}`
      );
    }

    console.log(`\n========================================`);
    console.log(`Results: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log(`========================================\n`);

    if (failedCount > 0) {
      process.exit(1);
    }
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

