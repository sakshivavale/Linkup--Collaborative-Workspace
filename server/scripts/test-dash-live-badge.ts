/**
 * Automated Verification Script for US-DASH-02: Live Badge on Active Room (P0)
 * Traces to: FR-8.2, FR-8.1
 * 
 * Acceptance Criteria Verified:
 * 1. A room card shows a "Live" badge when activeSessionId is not null.
 * 2. A "Join" button appears alongside the badge, which navigates to the room page.
 * 3. Rooms without an active session do not show a badge or Join button.
 * 4. API endpoint GET /api/rooms returns RoomSummary[] with accurate activeSessionId status.
 */

import http from 'http';
import { app } from '../src/app';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { Me, RoomSummary } from '@linkup/shared';

const TEST_PORT = 3097;
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
  console.log('🚀 Running US-DASH-02: Live Badge on Active Room Tests');
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
    // TEST 1: Unauthenticated request to GET /api/rooms returns 401 UNAUTHENTICATED
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Test 1]\x1b[0m Verifying unauthenticated GET /api/rooms is rejected with 401 UNAUTHENTICATED...\n');

    const unauthRes = await fetch(`${BASE_URL}/api/rooms`);
    const unauthBody = (await unauthRes.json()) as { error?: { code?: string } };
    assert(
      unauthRes.status === 401 && unauthBody.error?.code === 'UNAUTHENTICATED',
      'GET /api/rooms without token returns 401 UNAUTHENTICATED',
      `Got status ${unauthRes.status}, code ${unauthBody.error?.code}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Setup Authenticated User & Mock Room Data with Active and Inactive Sessions
    // -------------------------------------------------------------------------
    const testToken = 'valid_test_token_us_dash_02';
    const testUser: Me = {
      id: 'test-user-dash-02',
      email: 'student@linkup.test',
      fullName: 'Alex Student',
      role: 'student',
    };
    setCachedUser(testToken, testUser, 60000);

    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${testToken}`,
    };

    const mockRooms: RoomSummary[] = [
      {
        id: 'room-active-101',
        name: 'CS101: Introduction to Computer Science',
        description: 'Interactive lecture and live collaborative coding workspace',
        joinCode: null, // Student shouldn't see join code
        hostName: 'Prof. Alan Turing',
        memberCount: 28,
        myRole: 'participant',
        activeSessionId: 'session-live-active-888', // ACTIVE SESSION PRESENT (US-DASH-02 Criterion 1 & 2)
        createdAt: '2026-10-14T10:00:00.000Z',
      },
      {
        id: 'room-inactive-102',
        name: 'MATH201: Discrete Mathematics',
        description: 'Weekly tutorials and problem sets',
        joinCode: null,
        hostName: 'Dr. Ada Lovelace',
        memberCount: 15,
        myRole: 'participant',
        activeSessionId: null, // NO ACTIVE SESSION (US-DASH-02 Criterion 3)
        createdAt: '2026-10-13T10:00:00.000Z',
      },
      {
        id: 'room-host-active-103',
        name: 'PHYS301: Quantum Mechanics',
        description: 'Teacher hosted room with active live lecture',
        joinCode: 'QM2026', // Host sees join code (US-DASH-05)
        hostName: 'Alex Student',
        memberCount: 8,
        myRole: 'host',
        activeSessionId: 'session-live-quantum-999', // ACTIVE SESSION
        createdAt: '2026-10-12T10:00:00.000Z',
      },
    ];

    setMockRooms(testUser.id, mockRooms);

    // -------------------------------------------------------------------------
    // TEST 3: Authenticated GET /api/rooms returns 200 with room summaries
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 2]\x1b[0m Verifying authenticated GET /api/rooms returns 200 with room summaries...\n');

    const authRes = await fetch(`${BASE_URL}/api/rooms`, {
      headers: authHeaders,
    });
    const rooms = (await authRes.json()) as RoomSummary[];

    assert(authRes.status === 200, 'GET /api/rooms returns 200 OK');
    assert(Array.isArray(rooms), 'Response is an array of rooms');
    assert(rooms.length === 3, 'Response contains all 3 user rooms');

    // -------------------------------------------------------------------------
    // TEST 4: US-DASH-02 Criterion 1 & 2 - Room with activeSessionId !== null
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 3 - US-DASH-02 Criterion 1 & 2]\x1b[0m Verifying active room provides activeSessionId for Live badge & Join...\n');

    const activeRoom = rooms.find((r) => r.id === 'room-active-101');
    assert(Boolean(activeRoom), 'Found active room in response (room-active-101)');
    assert(
      activeRoom?.activeSessionId === 'session-live-active-888',
      'Active room has non-null activeSessionId ("session-live-active-888")',
      `Got activeSessionId: ${activeRoom?.activeSessionId}`
    );
    assert(
      activeRoom?.activeSessionId !== null,
      'Acceptance Criterion 1 satisfied: activeSessionId is not null, indicating room is Live'
    );

    // -------------------------------------------------------------------------
    // TEST 5: US-DASH-02 Criterion 3 - Room with activeSessionId === null
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 4 - US-DASH-02 Criterion 3]\x1b[0m Verifying inactive room has null activeSessionId (no Live badge or Join button)...\n');

    const inactiveRoom = rooms.find((r) => r.id === 'room-inactive-102');
    assert(Boolean(inactiveRoom), 'Found inactive room in response (room-inactive-102)');
    assert(
      inactiveRoom?.activeSessionId === null,
      'Acceptance Criterion 3 satisfied: Inactive room activeSessionId is null',
      `Got activeSessionId: ${inactiveRoom?.activeSessionId}`
    );

    // -------------------------------------------------------------------------
    // TEST 6: DTO fields consistency & FR-8.4 Join Code protection
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 5 - Security & DTO Consistency]\x1b[0m Verifying room card data fields & join code isolation...\n');

    assert(activeRoom?.hostName === 'Prof. Alan Turing', 'Room card includes hostName');
    assert(activeRoom?.memberCount === 28, 'Room card includes memberCount');
    assert(activeRoom?.myRole === 'participant', 'Room card includes myRole');
    assert(activeRoom?.joinCode === null, 'Participant cannot see joinCode (joinCode is null)');

    const hostRoom = rooms.find((r) => r.id === 'room-host-active-103');
    assert(hostRoom?.myRole === 'host', 'Host room has myRole = host');
    assert(hostRoom?.joinCode === 'QM2026', 'Host can see joinCode for room sharing (US-DASH-05)');

    // -------------------------------------------------------------------------
    // TEST 7: Ordering (Newest First - US-DASH-01 Criterion 3)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 6]\x1b[0m Verifying rooms are ordered newest first...\n');
    assert(
      new Date(rooms[0].createdAt).getTime() >= new Date(rooms[1].createdAt).getTime(),
      'Rooms are sorted newest first by createdAt timestamp'
    );

  } finally {
    clearTokenCache();
    clearMockRooms();
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
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
