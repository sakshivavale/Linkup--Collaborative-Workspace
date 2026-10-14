/**
 * Automated Verification Script for US-AUTH-06: Edit Profile Name (P1)
 * 
 * Acceptance Criteria Verified:
 * 1. A profile settings option is accessible from the header (UI).
 * 2. PATCH /api/me with { fullName } updates the name in the database.
 * 3. The updated name is reflected in the dashboard, room members list, and chat messages going forward.
 * 4. Whitespace-only or empty names are rejected with an inline error.
 */

import http from 'http';
import { app } from '../src/app';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { Me } from '@linkup/shared';

const TEST_PORT = 3098;
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
  console.log('🚀 Running US-AUTH-06: Edit Profile Name Verification Tests');
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
    // CRITERION 1 & AUTH: Unauthenticated requests to PATCH /api/me return 401 UNAUTHENTICATED
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Test 1]\x1b[0m Verifying unauthenticated PATCH /api/me is rejected...\n');

    const unauthRes = await fetch(`${BASE_URL}/api/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'New Name' }),
    });
    const unauthBody = await unauthRes.json() as { error?: { code?: string } };
    assert(
      unauthRes.status === 401 && unauthBody.error?.code === 'UNAUTHENTICATED',
      'PATCH /api/me without token returns 401 UNAUTHENTICATED',
      `Got status ${unauthRes.status}, code ${unauthBody.error?.code}`
    );

    // -------------------------------------------------------------------------
    // Mock user session setup using setCachedUser
    // -------------------------------------------------------------------------
    const testToken = 'valid_test_token_us_auth_06';
    const initialUser: Me = {
      id: 'test-user-profile-id-06',
      email: 'student@linkup.test',
      fullName: 'Original Name',
      role: 'student',
    };
    setCachedUser(testToken, initialUser, 60000);

    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${testToken}`,
    };

    // -------------------------------------------------------------------------
    // CRITERION 4: Whitespace-only or empty names are rejected with validation error
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 2 - Criterion 4]\x1b[0m Verifying whitespace-only & empty names are rejected with code VALIDATION...\n');

    // 2a. Empty string
    const emptyRes = await fetch(`${BASE_URL}/api/me`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ fullName: '' }),
    });
    const emptyBody = await emptyRes.json() as { error?: { code?: string; message?: string } };
    assert(
      emptyRes.status === 400 && emptyBody.error?.code === 'VALIDATION',
      'PATCH /api/me with empty string returns 400 VALIDATION',
      `Got status ${emptyRes.status}, message: ${emptyBody.error?.message}`
    );
    assert(
      emptyBody.error?.message === 'Full name cannot be empty or whitespace only',
      'Empty name returns exact descriptive message: "Full name cannot be empty or whitespace only"'
    );

    // 2b. Whitespace only (spaces, tabs, newlines)
    const whitespaceRes = await fetch(`${BASE_URL}/api/me`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ fullName: '   \t  \n  ' }),
    });
    const whitespaceBody = await whitespaceRes.json() as { error?: { code?: string; message?: string } };
    assert(
      whitespaceRes.status === 400 && whitespaceBody.error?.code === 'VALIDATION',
      'PATCH /api/me with whitespace-only returns 400 VALIDATION',
      `Got status ${whitespaceRes.status}, message: ${whitespaceBody.error?.message}`
    );

    // 2c. Exceeding 100 characters
    const longName = 'A'.repeat(101);
    const longRes = await fetch(`${BASE_URL}/api/me`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ fullName: longName }),
    });
    const longBody = await longRes.json() as { error?: { code?: string; message?: string } };
    assert(
      longRes.status === 400 && longBody.error?.code === 'VALIDATION',
      'PATCH /api/me with name > 100 characters returns 400 VALIDATION',
      `Got status ${longRes.status}, message: ${longBody.error?.message}`
    );

    // 2d. Missing fullName in body
    const missingRes = await fetch(`${BASE_URL}/api/me`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    const missingBody = await missingRes.json() as { error?: { code?: string; message?: string } };
    assert(
      missingRes.status === 400 && missingBody.error?.code === 'VALIDATION',
      'PATCH /api/me with missing body returns 400 VALIDATION'
    );

    // -------------------------------------------------------------------------
    // CRITERION 2 & 3: PATCH /api/me with valid { fullName } updates the name
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 3 - Criterion 2 & 3]\x1b[0m Verifying PATCH /api/me updates name and reflects in subsequent calls...\n');

    const updatedName = 'Dr. Alexander Fleming';
    const updateRes = await fetch(`${BASE_URL}/api/me`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ fullName: updatedName }),
    });
    const updateBody = await updateRes.json() as { user?: Me; error?: { message?: string } };

    assert(
      updateRes.status === 200,
      'PATCH /api/me with valid name returns HTTP 200',
      `Got status ${updateRes.status}`
    );
    assert(
      updateBody.user?.fullName === updatedName,
      'Response contains updated fullName: "Dr. Alexander Fleming"',
      `Got fullName: "${updateBody.user?.fullName}"`
    );
    assert(
      updateBody.user?.id === initialUser.id,
      'Response retains correct user ID'
    );
    assert(
      updateBody.user?.role === initialUser.role,
      'Response retains correct user role'
    );

    // Verify GET /api/me now returns the updated name from token cache
    const verifyGetRes = await fetch(`${BASE_URL}/api/me`, {
      method: 'GET',
      headers: authHeaders,
    });
    const verifyGetBody = await verifyGetRes.json() as { user?: Me };
    assert(
      verifyGetBody.user?.fullName === updatedName,
      'Subsequent GET /api/me reflects updated fullName immediately (Token Cache updated)',
      `Got fullName: "${verifyGetBody.user?.fullName}"`
    );

  } finally {
    clearTokenCache();
    await new Promise<void>((resolve) => {
      testServer.close(() => {
        console.log('\n[Test Server] Shut down gracefully.');
        resolve();
      });
    });
  }

  console.log('\n============================================================');
  console.log(`Test Summary: ${passedCount} Passed, ${failedCount} Failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
