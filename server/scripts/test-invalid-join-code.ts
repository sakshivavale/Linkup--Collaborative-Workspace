/**
 * Automated Verification Script for US-ERR-01: Invalid Join Code
 * Module: Error States & System Resilience
 * Priority: P0 | Traces to: FRD Section 7
 *
 * Acceptance Criteria Verified:
 * 1. The UI/API returns: "No room found with that code." for any non-existent or invalid join code.
 * 2. Entering an invalid code does not crash or disable the retry flow; retry with a valid code succeeds.
 * 3. Case-insensitive lookup preserves resilience: unknown code in lowercase or mixed case still returns "No room found with that code."
 * 4. Empty or short join code returns 400 VALIDATION.
 */

import http from 'http';
import { app } from '../src/app';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import {
  registerMockCatalogRoom,
  clearMockCatalog,
  setMockRooms,
  clearMockRooms,
} from '../src/lib/rooms';
import { Me } from '@linkup/shared';

const TEST_PORT = 3105;
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
  console.log('🚀 Running US-ERR-01: Invalid Join Code Tests');
  console.log('============================================================\n');

  const testServer = http.createServer(app);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------------------
    // SETUP: Set up test user and sample room
    // -------------------------------------------------------------------------
    const studentToken = 'student_token_us_err_01';
    const testStudent: Me = {
      id: 'student-us-err-01',
      fullName: 'Rohit Sharma',
      email: 'rohit@example.com',
      role: 'student',
    };

    setCachedUser(studentToken, testStudent);
    clearMockRooms();
    clearMockCatalog();

    const studentHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${studentToken}`,
    };

    // Register a valid room in mock catalog
    const validRoomId = 'valid-room-err-01';
    const validJoinCode = 'VALID9';
    registerMockCatalogRoom({
      id: validRoomId,
      name: 'Algorithm Mastery',
      description: 'Test Room for US-ERR-01',
      joinCode: validJoinCode,
      hostName: 'Dr. Test',
    });

    // -------------------------------------------------------------------------
    // TEST 1: Acceptance Criterion 1 — Unknown 6-character code returns 404 ROOM_NOT_FOUND
    // with exact message "No room found with that code."
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Test 1]\x1b[0m Verifying unknown join code returns exact message: "No room found with that code." (AC-1)...\n');

    const unknownRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ code: 'ZZZZ99' }),
    });

    const unknownBody = (await unknownRes.json()) as { error?: { code?: string; message?: string } };

    assert(
      unknownRes.status === 404,
      'POST /api/rooms/join with unknown code returns 404 status',
      `Got status ${unknownRes.status}`
    );

    assert(
      unknownBody.error?.code === 'ROOM_NOT_FOUND',
      'Error code is ROOM_NOT_FOUND',
      `Got code: ${unknownBody.error?.code}`
    );

    assert(
      unknownBody.error?.message === 'No room found with that code.',
      'Error message is exactly "No room found with that code."',
      `Got message: "${unknownBody.error?.message}"`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Lowercase unknown join code normalises and returns "No room found with that code."
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 2]\x1b[0m Verifying lowercase unknown code ("wrong1") returns "No room found with that code."...\n');

    const lowercaseUnknownRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ code: 'wrong1' }),
    });

    const lowercaseUnknownBody = (await lowercaseUnknownRes.json()) as { error?: { code?: string; message?: string } };

    assert(
      lowercaseUnknownRes.status === 404 &&
      lowercaseUnknownBody.error?.message === 'No room found with that code.',
      'Lowercase unknown code correctly returns 404 with "No room found with that code."',
      `Got status ${lowercaseUnknownRes.status}, message: "${lowercaseUnknownBody.error?.message}"`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Short or malformed join code returns 400 VALIDATION error
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 3]\x1b[0m Verifying short/malformed code returns 400 VALIDATION...\n');

    const shortCodeRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ code: 'ABC' }),
    });

    const shortCodeBody = (await shortCodeRes.json()) as { error?: { code?: string } };

    assert(
      shortCodeRes.status === 400 && shortCodeBody.error?.code === 'VALIDATION',
      'Short code (< 6 characters) returns 400 VALIDATION',
      `Got status ${shortCodeRes.status}, code: ${shortCodeBody.error?.code}`
    );

    const emptyCodeRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ code: '' }),
    });

    const emptyCodeBody = (await emptyCodeRes.json()) as { error?: { code?: string } };

    assert(
      emptyCodeRes.status === 400 && emptyCodeBody.error?.code === 'VALIDATION',
      'Empty code returns 400 VALIDATION',
      `Got status ${emptyCodeRes.status}, code: ${emptyCodeBody.error?.code}`
    );

    // -------------------------------------------------------------------------
    // TEST 4: Acceptance Criterion 2 — Successful retry after invalid code failure
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 4]\x1b[0m Verifying retry with valid code succeeds after invalid code attempt (AC-2)...\n');

    const retryValidRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ code: validJoinCode }),
    });

    const retryValidBody = (await retryValidRes.json()) as { roomId?: string };

    assert(
      retryValidRes.status === 200,
      'Retry with valid code returns 200 OK',
      `Got status ${retryValidRes.status}`
    );

    assert(
      retryValidBody.roomId === validRoomId,
      'Retry correctly returns joined roomId',
      `Got roomId: ${retryValidBody.roomId}`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Unauthenticated join code attempt returns 401 UNAUTHENTICATED
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 5]\x1b[0m Verifying unauthenticated request returns 401 UNAUTHENTICATED...\n');

    const unauthRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ZZZZ99' }),
    });

    const unauthBody = (await unauthRes.json()) as { error?: { code?: string } };

    assert(
      unauthRes.status === 401 && unauthBody.error?.code === 'UNAUTHENTICATED',
      'Unauthenticated request returns 401 UNAUTHENTICATED',
      `Got status ${unauthRes.status}`
    );

  } finally {
    clearTokenCache();
    clearMockRooms();
    clearMockCatalog();
    testServer.close();
    console.log('[Test Server] Shut down.\n');
  }

  console.log('============================================================');
  console.log(`Summary: ${passedCount} passed, ${failedCount} failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
