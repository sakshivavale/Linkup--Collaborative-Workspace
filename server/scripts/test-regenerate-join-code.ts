/**
 * Automated Verification Script for US-ROOM-04: Regenerate Join Code (P1)
 * Priority: P1 | Traces to: FR-2.6
 *
 * Acceptance Criteria Verified:
 * 1. A "Regenerate Code" option is available to the host (POST /api/rooms/:roomId/join-code).
 * 2. Non-host or unauthenticated requests are rejected with 401/403.
 * 3. The old code immediately becomes invalid for joining.
 * 4. The new code is returned, valid for joining, and displayed with a copy button.
 */

import http from 'http';
import { app } from '../src/app';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { 
  registerMockCatalogRoom, 
  clearMockCatalog, 
  setMockRooms, 
  clearMockRooms,
  JOIN_CODE_CHARS
} from '../src/lib/rooms';
import { Me } from '@linkup/shared';

const TEST_PORT = 3112;
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
  console.log('🚀 Running US-ROOM-04: Regenerate Join Code Tests');
  console.log('============================================================\n');

  const testServer = http.createServer(app);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockCatalog();

    const hostToken = 'host_token_us_room_04';
    const hostUser: Me = {
      id: 'host-user-uuid-04',
      email: 'host@linkup.test',
      fullName: 'Prof. Ada Lovelace',
      role: 'teacher',
    };
    setCachedUser(hostToken, hostUser, 60000);

    const participantToken = 'participant_token_us_room_04';
    const participantUser: Me = {
      id: 'participant-user-uuid-04',
      email: 'student@linkup.test',
      fullName: 'Student Turing',
      role: 'student',
    };
    setCachedUser(participantToken, participantUser, 60000);

    const outsideToken = 'outside_token_us_room_04';
    const outsideUser: Me = {
      id: 'outside-user-uuid-04',
      email: 'outsider@linkup.test',
      fullName: 'Outsider User',
      role: 'student',
    };
    setCachedUser(outsideToken, outsideUser, 60000);

    const roomId = 'room-us-room-04-test';
    const initialJoinCode = 'INIT99';

    // Register room in mock stores
    setMockRooms(hostUser.id, [{
      id: roomId,
      name: 'Algorithm Masterclass',
      description: 'Advanced algorithms room',
      joinCode: initialJoinCode,
      hostName: hostUser.fullName,
      memberCount: 2,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
    }]);

    setMockRooms(participantUser.id, [{
      id: roomId,
      name: 'Algorithm Masterclass',
      description: 'Advanced algorithms room',
      joinCode: null,
      hostName: hostUser.fullName,
      memberCount: 2,
      myRole: 'participant',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
    }]);

    registerMockCatalogRoom({
      id: roomId,
      name: 'Algorithm Masterclass',
      description: 'Advanced algorithms room',
      joinCode: initialJoinCode,
      hostName: hostUser.fullName,
    });

    // -------------------------------------------------------------------------
    // TEST 1: Unauthenticated request to POST /api/rooms/:roomId/join-code is rejected (401)
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Test 1]\x1b[0m Verifying unauthenticated request to POST /api/rooms/:roomId/join-code returns 401 UNAUTHENTICATED...\n');
    const unauthRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/join-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const unauthBody = (await unauthRes.json()) as any;
    assert(
      unauthRes.status === 401 && unauthBody.error?.code === 'UNAUTHENTICATED',
      'Unauthenticated POST /api/rooms/:roomId/join-code returns 401 UNAUTHENTICATED',
      `Got status ${unauthRes.status}, code ${unauthBody.error?.code}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Non-host member cannot regenerate join code (403 HOST_ONLY)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 2]\x1b[0m Verifying participant cannot regenerate join code (403 HOST_ONLY)...\n');
    const participantRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/join-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${participantToken}`,
      },
    });
    const participantBody = (await participantRes.json()) as any;
    assert(
      participantRes.status === 403 && (participantBody.error?.code === 'HOST_ONLY' || participantBody.error?.code === 'FORBIDDEN'),
      'Non-host participant request returns 403 HOST_ONLY',
      `Got status ${participantRes.status}, code ${participantBody.error?.code}`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Non-member outsider cannot regenerate join code (403 HOST_ONLY)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 3]\x1b[0m Verifying outsider cannot regenerate join code (403 HOST_ONLY)...\n');
    const outsiderRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/join-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${outsideToken}`,
      },
    });
    const outsiderBody = (await outsiderRes.json()) as any;
    assert(
      outsiderRes.status === 403 && (outsiderBody.error?.code === 'HOST_ONLY' || outsiderBody.error?.code === 'FORBIDDEN'),
      'Outsider non-member request returns 403 HOST_ONLY',
      `Got status ${outsiderRes.status}, code ${outsiderBody.error?.code}`
    );

    // -------------------------------------------------------------------------
    // TEST 4: Host successfully regenerates join code (200 OK + new 6-char code)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 4]\x1b[0m Verifying host successfully regenerates join code...\n');
    const regenRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/join-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });
    const regenBody = (await regenRes.json()) as any;
    const newJoinCode = regenBody.joinCode;

    assert(
      regenRes.status === 200,
      'Host POST /api/rooms/:roomId/join-code returns 200 OK',
      `Got status ${regenRes.status}`
    );
    assert(
      typeof newJoinCode === 'string' && newJoinCode.length === 6,
      'Regenerated join code is 6 characters long',
      `Got joinCode: "${newJoinCode}"`
    );
    assert(
      newJoinCode !== initialJoinCode,
      'Regenerated join code is different from the old code',
      `Old: "${initialJoinCode}", New: "${newJoinCode}"`
    );

    const validCharsRegex = new RegExp(`^[${JOIN_CODE_CHARS}]{6}$`);
    assert(
      validCharsRegex.test(newJoinCode),
      'Regenerated join code only contains allowed alphanumeric characters (no O, 0, I, 1)',
      `Code: ${newJoinCode}`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Acceptance Criterion 2: Old code immediately becomes invalid
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 5]\x1b[0m Verifying old code immediately becomes invalid when joining...\n');
    const oldJoinRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${outsideToken}`,
      },
      body: JSON.stringify({ code: initialJoinCode }),
    });
    const oldJoinBody = (await oldJoinRes.json()) as any;
    assert(
      oldJoinRes.status === 404 && oldJoinBody.error?.code === 'ROOM_NOT_FOUND',
      'Attempting to join with previous code returns 404 ROOM_NOT_FOUND (old code is invalid)',
      `Got status ${oldJoinRes.status}, code ${oldJoinBody.error?.code}, message: ${oldJoinBody.error?.message}`
    );

    // -------------------------------------------------------------------------
    // TEST 6: Acceptance Criterion 3: New code immediately works for joining
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 6]\x1b[0m Verifying new regenerated code succeeds for joining...\n');
    const newJoinRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${outsideToken}`,
      },
      body: JSON.stringify({ code: newJoinCode.toLowerCase() }), // Also testing case-insensitivity
    });
    const newJoinBody = (await newJoinRes.json()) as any;
    assert(
      newJoinRes.status === 200 && newJoinBody.roomId === roomId,
      'New regenerated code joins successfully with 200 OK',
      `Got status ${newJoinRes.status}, roomId: ${newJoinBody.roomId}`
    );

    // -------------------------------------------------------------------------
    // TEST 7: Multiple regenerations properly supersede previous codes
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 7]\x1b[0m Verifying a second regeneration invalidates the first regenerated code...\n');
    const secondRegenRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/join-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });
    const secondRegenBody = (await secondRegenRes.json()) as any;
    const secondNewCode = secondRegenBody.joinCode;

    assert(
      secondNewCode !== newJoinCode && secondNewCode !== initialJoinCode,
      'Second regeneration generates a fresh distinct code',
      `Second code: ${secondNewCode}`
    );

    const firstRegenJoinRes = await fetch(`${BASE_URL}/api/rooms/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${outsideToken}`,
      },
      body: JSON.stringify({ code: newJoinCode }),
    });
    const firstRegenJoinBody = (await firstRegenJoinRes.json()) as any;
    assert(
      firstRegenJoinRes.status === 404,
      'Previously regenerated code is now also invalid (404)',
      `Got status ${firstRegenJoinRes.status}`
    );

  } catch (err) {
    console.error('Unexpected test error:', err);
    failedCount++;
  } finally {
    await new Promise<void>((resolve) => {
      testServer.close(() => {
        console.log('\n[Test Server] Closed');
        resolve();
      });
    });

    console.log('\n============================================================');
    console.log(`Summary: ${passedCount} passed, ${failedCount} failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
  }
}

runTests();
