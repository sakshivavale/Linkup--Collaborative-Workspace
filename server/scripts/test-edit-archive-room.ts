/**
 * Automated Verification Script for US-ROOM-05: Edit Room Name/Description and Archive (P1)
 * Priority: P1 | Traces to: FR-2.7
 *
 * Acceptance Criteria Verified:
 * 1. PATCH /api/rooms/:roomId accepts { name?, description? } and updates the room.
 * 2. Validation: name cannot be empty or > 80 chars, description cannot exceed 500 chars.
 * 3. Only the host can edit or archive a room; other users get 403 HOST_ONLY.
 * 4. Archived rooms do not appear on any user's dashboard (GET /api/rooms).
 * 5. POST /api/rooms/:roomId/archive provides explicit archiving capability.
 * 6. Unauthenticated requests get 401 UNAUTHENTICATED.
 */

import http from 'http';
import { app } from '../src/app';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { 
  registerMockCatalogRoom, 
  clearMockCatalog, 
  setMockRooms, 
  clearMockRooms 
} from '../src/lib/rooms';
import { Me } from '@linkup/shared';

const TEST_PORT = 3115;
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
  console.log('🚀 Running US-ROOM-05: Edit Room & Archive Tests');
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

    const hostToken = 'host_token_us_room_05';
    const hostUser: Me = {
      id: 'host-user-uuid-05',
      email: 'host05@linkup.test',
      fullName: 'Prof. Grace Hopper',
      role: 'teacher',
    };
    setCachedUser(hostToken, hostUser, 60000);

    const participantToken = 'participant_token_us_room_05';
    const participantUser: Me = {
      id: 'participant-user-uuid-05',
      email: 'student05@linkup.test',
      fullName: 'Student Knuth',
      role: 'student',
    };
    setCachedUser(participantToken, participantUser, 60000);

    const outsideToken = 'outside_token_us_room_05';
    const outsideUser: Me = {
      id: 'outside-user-uuid-05',
      email: 'outsider05@linkup.test',
      fullName: 'Outsider Dijkstra',
      role: 'student',
    };
    setCachedUser(outsideToken, outsideUser, 60000);

    const roomId = 'room-us-room-05-test';
    const initialName = 'Compilers & Languages';
    const initialDesc = 'Introduction to compiler construction and grammars.';
    const joinCode = 'COMP99';

    // Register room in mock stores for host and participant
    setMockRooms(hostUser.id, [{
      id: roomId,
      name: initialName,
      description: initialDesc,
      joinCode: joinCode,
      hostName: hostUser.fullName,
      memberCount: 2,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
    }]);

    setMockRooms(participantUser.id, [{
      id: roomId,
      name: initialName,
      description: initialDesc,
      joinCode: null,
      hostName: hostUser.fullName,
      memberCount: 2,
      myRole: 'participant',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
    }]);

    registerMockCatalogRoom({
      id: roomId,
      name: initialName,
      description: initialDesc,
      joinCode: joinCode,
      hostName: hostUser.fullName,
    });

    console.log('--- Test Suite 1: Authentication & Authorization Enforcements ---');

    // 1. Unauthenticated request to PATCH /api/rooms/:roomId
    {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });
      const data = await res.json();
      assert(res.status === 401, 'Unauthenticated PATCH request rejected with 401');
      assert(data.error?.code === 'UNAUTHENTICATED', 'Error code is UNAUTHENTICATED');
    }

    // 2. Participant attempt to edit room name -> 403 HOST_ONLY
    {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${participantToken}`,
        },
        body: JSON.stringify({ name: 'Hacked Name By Participant' }),
      });
      const data = await res.json();
      assert(res.status === 403, 'Participant PATCH request rejected with 403');
      assert(data.error?.code === 'HOST_ONLY', 'Participant gets error code HOST_ONLY');
    }

    // 3. Outside user attempt to edit room -> 403 HOST_ONLY
    {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${outsideToken}`,
        },
        body: JSON.stringify({ name: 'Hacked Name By Outsider' }),
      });
      const data = await res.json();
      assert(res.status === 403, 'Outsider PATCH request rejected with 403');
      assert(data.error?.code === 'HOST_ONLY', 'Outsider gets error code HOST_ONLY');
    }

    console.log('\n--- Test Suite 2: Payload Validation ---');

    // 4. Empty payload -> 400 VALIDATION
    {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      assert(res.status === 400, 'Empty update payload rejected with 400');
      assert(data.error?.code === 'VALIDATION', 'Error code is VALIDATION');
    }

    // 5. Empty name -> 400 VALIDATION
    {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ name: '   ' }),
      });
      const data = await res.json();
      assert(res.status === 400, 'Whitespace name rejected with 400');
      assert(data.error?.code === 'VALIDATION', 'Error code is VALIDATION');
    }

    // 6. Name exceeding 80 characters -> 400 VALIDATION
    {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ name: 'A'.repeat(81) }),
      });
      const data = await res.json();
      assert(res.status === 400, 'Name > 80 chars rejected with 400');
      assert(data.error?.code === 'VALIDATION', 'Error code is VALIDATION');
    }

    // 7. Description exceeding 500 characters -> 400 VALIDATION
    {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ description: 'D'.repeat(501) }),
      });
      const data = await res.json();
      assert(res.status === 400, 'Description > 500 chars rejected with 400');
      assert(data.error?.code === 'VALIDATION', 'Error code is VALIDATION');
    }

    console.log('\n--- Test Suite 3: Successful Room Updates (Host) ---');

    // 8. Host edits room name and description
    const updatedName = 'Advanced Compilers & Optimization';
    const updatedDesc = 'Graduate seminar covering LLVM and JIT compilation techniques.';
    {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ name: updatedName, description: updatedDesc }),
      });
      const data = await res.json();
      assert(res.status === 200, 'Host PATCH returns 200 OK');
      assert(data.name === updatedName, 'Room name updated to new name');
      assert(data.description === updatedDesc, 'Room description updated to new description');
    }

    // 9. Verify dashboard shows updated room name and description for all room members
    {
      const hostDashRes = await fetch(`${BASE_URL}/api/rooms`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      });
      const hostRooms = await hostDashRes.json();
      const hostRoom = hostRooms.find((r: any) => r.id === roomId);
      assert(hostRoom?.name === updatedName, "Host dashboard shows updated name");

      const studentDashRes = await fetch(`${BASE_URL}/api/rooms`, {
        headers: { Authorization: `Bearer ${participantToken}` },
      });
      const studentRooms = await studentDashRes.json();
      const studentRoom = studentRooms.find((r: any) => r.id === roomId);
      assert(studentRoom?.name === updatedName, "Student dashboard shows updated name");
    }

    // 10. Description can be cleared with null
    {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ description: null }),
      });
      const data = await res.json();
      assert(res.status === 200, 'Description can be set to null');
      assert(data.description === null, 'Room description successfully cleared');
    }

    console.log('\n--- Test Suite 4: Archive Room & Dashboard Removal ---');

    // 11. Non-host cannot archive room -> 403 HOST_ONLY
    {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${participantToken}`,
        },
        body: JSON.stringify({ archived: true }),
      });
      const data = await res.json();
      assert(res.status === 403, 'Participant cannot archive room (403)');
      assert(data.error?.code === 'HOST_ONLY', 'Error code is HOST_ONLY');
    }

    // 12. Non-host cannot archive via POST /api/rooms/:roomId/archive -> 403 HOST_ONLY
    {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}/archive`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${participantToken}`,
        },
      });
      const data = await res.json();
      assert(res.status === 403, 'Participant cannot call /archive endpoint (403)');
      assert(data.error?.code === 'HOST_ONLY', 'Error code is HOST_ONLY');
    }

    // 13. Host archives room
    {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}/archive`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${hostToken}`,
        },
      });
      const data = await res.json();
      assert(res.status === 200, 'Host successfully archives room (200 OK)');
      assert(data.archived === true, 'Response confirms archived: true');
    }

    // 14. Acceptance Criteria: Archived rooms do not appear on ANY user dashboard
    {
      const hostDashRes = await fetch(`${BASE_URL}/api/rooms`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      });
      const hostRooms = await hostDashRes.json();
      const hostFound = hostRooms.some((r: any) => r.id === roomId);
      assert(!hostFound, "Archived room DOES NOT appear on host's dashboard");

      const studentDashRes = await fetch(`${BASE_URL}/api/rooms`, {
        headers: { Authorization: `Bearer ${participantToken}` },
      });
      const studentRooms = await studentDashRes.json();
      const studentFound = studentRooms.some((r: any) => r.id === roomId);
      assert(!studentFound, "Archived room DOES NOT appear on student's dashboard");
    }

    console.log('\n============================================================');
    console.log(`Results: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error running tests:', err);
    process.exit(1);
  } finally {
    testServer.close();
  }
}

runTests();
