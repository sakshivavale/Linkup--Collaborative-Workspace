/**
 * Automated Verification Script for US-SEC-01: All API Routes Authenticated (P0, NFR-1.1)
 *
 * Acceptance Criteria Verified:
 * 1. requireAuth middleware is applied to every route except GET /health.
 * 2. requireMember is applied to every /rooms/:id/* route.
 * 3. requireHost is applied to host-only routes (start/end session, permission changes, remove member).
 * 4. Socket handlers re-check membership and flags from DB/cache on every event, not just on room:join.
 */

import http from 'http';
import { io as ClientSocketIO, Socket as ClientSocket } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser } from '../src/lib/supabase';
import { setMockRooms, RoomSummary, clearMockSessions, getMockSessions } from '../src/lib/rooms';
import { Me } from '@linkup/shared';
import { setPenHolder } from '../src/realtime/codeWorkspace';

const TEST_PORT = 3199;
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

// Setup test users
const hostUser: Me = {
  id: 'user-sec-host-01',
  email: 'host@linkup.test',
  fullName: 'Prof. Security Host',
  role: 'teacher',
};
const hostToken = 'token_sec_host_01';

const participantUser: Me = {
  id: 'user-sec-participant-01',
  email: 'student@linkup.test',
  fullName: 'Alice Participant',
  role: 'student',
};
const participantToken = 'token_sec_participant_01';

const outsiderUser: Me = {
  id: 'user-sec-outsider-01',
  email: 'outsider@linkup.test',
  fullName: 'Bob Outsider',
  role: 'student',
};
const outsiderToken = 'token_sec_outsider_01';

const targetMemberUser: Me = {
  id: 'user-sec-target-01',
  email: 'target@linkup.test',
  fullName: 'Charlie Member',
  role: 'student',
};

const testRoomId = 'c0000000-0000-4000-a000-000000000001';

const hostRoomSummary: RoomSummary = {
  id: testRoomId,
  name: 'Security Test Room',
  description: 'Test Room for US-SEC-01',
  joinCode: 'SEC101',
  hostName: hostUser.fullName,
  memberCount: 3,
  isLive: true,
  myRole: 'host',
  members: [
    {
      userId: hostUser.id,
      fullName: hostUser.fullName,
      email: hostUser.email,
      role: 'teacher',
      memberRole: 'host',
      joinedAt: new Date().toISOString(),
      permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
    },
    {
      userId: participantUser.id,
      fullName: participantUser.fullName,
      email: participantUser.email,
      role: 'student',
      memberRole: 'participant',
      joinedAt: new Date().toISOString(),
      permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: false, canCode: false },
    },
    {
      userId: targetMemberUser.id,
      fullName: targetMemberUser.fullName,
      email: targetMemberUser.email,
      role: 'student',
      memberRole: 'participant',
      joinedAt: new Date().toISOString(),
      permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: false, canCode: false },
    },
  ],
};

const participantRoomSummary: RoomSummary = {
  ...hostRoomSummary,
  myRole: 'participant',
};

async function runTests() {
  console.log('\n============================================================');
  console.log('🔒 Running US-SEC-01 Acceptance Criteria Verification Tests');
  console.log('   Priority: P0 | Traces to: NFR-1.1');
  console.log('============================================================\n');

  // Cache test users
  setCachedUser(hostToken, hostUser);
  setCachedUser(participantToken, participantUser);
  setCachedUser(outsiderToken, outsiderUser);

  // Configure mock store for room membership
  setMockRooms(hostUser.id, [hostRoomSummary]);
  setMockRooms(participantUser.id, [participantRoomSummary]);
  setMockRooms(outsiderUser.id, []); // Outsider has NO rooms

  // Setup active session
  clearMockSessions();
  getMockSessions().set(testRoomId, {
    id: 'session-sec-01',
    room_id: testRoomId,
    livekit_room: `linkup-${testRoomId}`,
    started_by: hostUser.id,
    started_at: new Date().toISOString(),
    status: 'active',
  });

  const testServer = http.createServer(app);
  io.attach(testServer);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------------------
    // CRITERION 1: requireAuth middleware applied to every route except GET /health
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Criterion 1]\x1b[0m requireAuth middleware applied to every route except GET /health...\n');

    // 1a. GET /health returns 200 without token
    const healthRes = await fetch(`${BASE_URL}/health`);
    assert(healthRes.status === 200, 'GET /health returns 200 without token');

    // 1b. POST /health requires auth (returns 401 UNAUTHENTICATED)
    const postHealthRes = await fetch(`${BASE_URL}/health`, { method: 'POST' });
    const postHealthBody = (await postHealthRes.json()) as any;
    assert(
      postHealthRes.status === 401 && postHealthBody.error?.code === 'UNAUTHENTICATED',
      'POST /health without token returns 401 UNAUTHENTICATED'
    );

    // 1c. GET /api/me requires auth
    const meRes = await fetch(`${BASE_URL}/api/me`);
    const meBody = (await meRes.json()) as any;
    assert(
      meRes.status === 401 && meBody.error?.code === 'UNAUTHENTICATED',
      'GET /api/me without token returns 401 UNAUTHENTICATED'
    );

    // 1d. GET /rooms/:id requires auth
    const roomNoAuthRes = await fetch(`${BASE_URL}/rooms/${testRoomId}`);
    const roomNoAuthBody = (await roomNoAuthRes.json()) as any;
    assert(
      roomNoAuthRes.status === 401 && roomNoAuthBody.error?.code === 'UNAUTHENTICATED',
      'GET /rooms/:id without token returns 401 UNAUTHENTICATED'
    );

    // 1e. GET /runtimes without auth requires token
    const runtimesNoAuthRes = await fetch(`${BASE_URL}/runtimes`);
    const runtimesNoAuthBody = (await runtimesNoAuthRes.json()) as any;
    assert(
      runtimesNoAuthRes.status === 401 && runtimesNoAuthBody.error?.code === 'UNAUTHENTICATED',
      'GET /runtimes without token returns 401 UNAUTHENTICATED'
    );

    // 1f. POST /execute without auth requires token
    const executeNoAuthRes = await fetch(`${BASE_URL}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'python', code: 'print("hello")' }),
    });
    const executeNoAuthBody = (await executeNoAuthRes.json()) as any;
    assert(
      executeNoAuthRes.status === 401 && executeNoAuthBody.error?.code === 'UNAUTHENTICATED',
      'POST /execute without token returns 401 UNAUTHENTICATED'
    );

    // 1g. Unmatched route without auth returns 401 UNAUTHENTICATED (not 404 bypass)
    const unmatchedNoAuthRes = await fetch(`${BASE_URL}/some/unknown/route`);
    const unmatchedNoAuthBody = (await unmatchedNoAuthRes.json()) as any;
    assert(
      unmatchedNoAuthRes.status === 401 && unmatchedNoAuthBody.error?.code === 'UNAUTHENTICATED',
      'Any unmatched route without token returns 401 UNAUTHENTICATED'
    );

    // 1h. Valid token succeeds on GET /api/me
    const meAuthedRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    const meAuthedBody = (await meAuthedRes.json()) as any;
    assert(
      meAuthedRes.status === 200 && meAuthedBody.user?.id === hostUser.id,
      'GET /api/me with valid Bearer token returns 200 and user object'
    );

    // -------------------------------------------------------------------------
    // CRITERION 2: requireMember applied to every /rooms/:id/* route
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Criterion 2]\x1b[0m requireMember applied to every /rooms/:id/* route...\n');

    // 2a. Outsider non-member GET /rooms/:id -> 403 NOT_A_MEMBER
    const outsiderGetRoomRes = await fetch(`${BASE_URL}/rooms/${testRoomId}`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    const outsiderGetRoomBody = (await outsiderGetRoomRes.json()) as any;
    assert(
      outsiderGetRoomRes.status === 403 && outsiderGetRoomBody.error?.code === 'NOT_A_MEMBER',
      'Outsider calling GET /rooms/:id returns 403 NOT_A_MEMBER',
      `Got status ${outsiderGetRoomRes.status}, code ${outsiderGetRoomBody.error?.code}`
    );

    // 2b. Outsider non-member GET /api/rooms/:id -> 403 NOT_A_MEMBER
    const outsiderGetApiRoomRes = await fetch(`${BASE_URL}/api/rooms/${testRoomId}`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    const outsiderGetApiRoomBody = (await outsiderGetApiRoomRes.json()) as any;
    assert(
      outsiderGetApiRoomRes.status === 403 && outsiderGetApiRoomBody.error?.code === 'NOT_A_MEMBER',
      'Outsider calling GET /api/rooms/:id returns 403 NOT_A_MEMBER'
    );

    // 2c. Outsider non-member GET /rooms/:id/code -> 403 NOT_A_MEMBER
    const outsiderCodeRes = await fetch(`${BASE_URL}/rooms/${testRoomId}/code`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    const outsiderCodeBody = (await outsiderCodeRes.json()) as any;
    assert(
      outsiderCodeRes.status === 403 && outsiderCodeBody.error?.code === 'NOT_A_MEMBER',
      'Outsider calling GET /rooms/:id/code returns 403 NOT_A_MEMBER'
    );

    // 2d. Outsider non-member GET /rooms/:id/whiteboard -> 403 NOT_A_MEMBER
    const outsiderWbRes = await fetch(`${BASE_URL}/rooms/${testRoomId}/whiteboard`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    const outsiderWbBody = (await outsiderWbRes.json()) as any;
    assert(
      outsiderWbRes.status === 403 && outsiderWbBody.error?.code === 'NOT_A_MEMBER',
      'Outsider calling GET /rooms/:id/whiteboard returns 403 NOT_A_MEMBER'
    );

    // 2e. Outsider non-member GET /rooms/:id/screen-share -> 403 NOT_A_MEMBER
    const outsiderScreenRes = await fetch(`${BASE_URL}/rooms/${testRoomId}/screen-share`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    const outsiderScreenBody = (await outsiderScreenRes.json()) as any;
    assert(
      outsiderScreenRes.status === 403 && outsiderScreenBody.error?.code === 'NOT_A_MEMBER',
      'Outsider calling GET /rooms/:id/screen-share returns 403 NOT_A_MEMBER'
    );

    // 2f. Outsider non-member GET /rooms/:id/messages -> 403 NOT_A_MEMBER
    const outsiderMsgRes = await fetch(`${BASE_URL}/rooms/${testRoomId}/messages`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    const outsiderMsgBody = (await outsiderMsgRes.json()) as any;
    assert(
      outsiderMsgRes.status === 403 && outsiderMsgBody.error?.code === 'NOT_A_MEMBER',
      'Outsider calling GET /rooms/:id/messages returns 403 NOT_A_MEMBER'
    );

    // 2g. Outsider non-member POST /rooms/:id/messages -> 403 NOT_A_MEMBER
    const outsiderSendMsgRes = await fetch(`${BASE_URL}/rooms/${testRoomId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${outsiderToken}`,
      },
      body: JSON.stringify({ body: 'Unauthorized message' }),
    });
    const outsiderSendMsgBody = (await outsiderSendMsgRes.json()) as any;
    assert(
      outsiderSendMsgRes.status === 403 && outsiderSendMsgBody.error?.code === 'NOT_A_MEMBER',
      'Outsider calling POST /rooms/:id/messages returns 403 NOT_A_MEMBER'
    );

    // 2h. Member successfully accesses room resource
    const memberGetRoomRes = await fetch(`${BASE_URL}/rooms/${testRoomId}`, {
      headers: { Authorization: `Bearer ${participantToken}` },
    });
    const memberGetRoomBody = (await memberGetRoomRes.json()) as any;
    assert(
      memberGetRoomRes.status === 200 && memberGetRoomBody.id === testRoomId,
      'Valid room member can access /rooms/:id'
    );

    // -------------------------------------------------------------------------
    // CRITERION 3: requireHost applied to host-only routes
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Criterion 3]\x1b[0m requireHost applied to host-only routes...\n');

    // 3a. Participant cannot start a session -> 403 HOST_ONLY
    const studentStartRes = await fetch(`${BASE_URL}/rooms/${testRoomId}/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${participantToken}` },
    });
    const studentStartBody = (await studentStartRes.json()) as any;
    assert(
      studentStartRes.status === 403 && studentStartBody.error?.code === 'HOST_ONLY',
      'Non-host participant calling POST /rooms/:id/sessions returns 403 HOST_ONLY',
      `Got status ${studentStartRes.status}, code ${studentStartBody.error?.code}`
    );

    // 3b. Participant cannot end a session -> 403 HOST_ONLY
    const studentEndRes = await fetch(`${BASE_URL}/rooms/${testRoomId}/sessions/session-sec-01/end`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${participantToken}` },
    });
    const studentEndBody = (await studentEndRes.json()) as any;
    assert(
      studentEndRes.status === 403 && studentEndBody.error?.code === 'HOST_ONLY',
      'Non-host participant calling POST end session returns 403 HOST_ONLY'
    );

    // 3c. Participant cannot change member permissions -> 403 HOST_ONLY
    const studentPermRes = await fetch(
      `${BASE_URL}/rooms/${testRoomId}/members/${targetMemberUser.id}/permissions`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${participantToken}`,
        },
        body: JSON.stringify({ canMic: false }),
      }
    );
    const studentPermBody = (await studentPermRes.json()) as any;
    assert(
      studentPermRes.status === 403 && studentPermBody.error?.code === 'HOST_ONLY',
      'Non-host participant calling PATCH permissions returns 403 HOST_ONLY'
    );

    // 3d. Participant cannot bulk-update permissions -> 403 HOST_ONLY
    const studentBulkPermRes = await fetch(`${BASE_URL}/rooms/${testRoomId}/permissions/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${participantToken}`,
      },
      body: JSON.stringify({ updates: [{ userId: targetMemberUser.id, canMic: false }] }),
    });
    const studentBulkPermBody = (await studentBulkPermRes.json()) as any;
    assert(
      studentBulkPermRes.status === 403 && studentBulkPermBody.error?.code === 'HOST_ONLY',
      'Non-host participant calling POST permissions/bulk returns 403 HOST_ONLY'
    );

    // 3e. Participant cannot remove a member -> 403 FORBIDDEN / HOST_ONLY
    const studentRemoveRes = await fetch(`${BASE_URL}/rooms/${testRoomId}/members/${targetMemberUser.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${participantToken}` },
    });
    const studentRemoveBody = (await studentRemoveRes.json()) as any;
    assert(
      studentRemoveRes.status === 403 &&
        (studentRemoveBody.error?.code === 'FORBIDDEN' || studentRemoveBody.error?.code === 'HOST_ONLY'),
      'Non-host participant calling DELETE member returns 403 FORBIDDEN/HOST_ONLY'
    );

    // 3f. Participant cannot regenerate join code -> 403 HOST_ONLY
    const studentJoinCodeRes = await fetch(`${BASE_URL}/rooms/${testRoomId}/join-code`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${participantToken}` },
    });
    const studentJoinCodeBody = (await studentJoinCodeRes.json()) as any;
    assert(
      studentJoinCodeRes.status === 403 && studentJoinCodeBody.error?.code === 'HOST_ONLY',
      'Non-host participant calling POST /rooms/:id/join-code returns 403 HOST_ONLY'
    );

    // 3g. Participant cannot archive room -> 403 HOST_ONLY
    const studentArchiveRes = await fetch(`${BASE_URL}/rooms/${testRoomId}/archive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${participantToken}` },
    });
    const studentArchiveBody = (await studentArchiveRes.json()) as any;
    assert(
      studentArchiveRes.status === 403 && studentArchiveBody.error?.code === 'HOST_ONLY',
      'Non-host participant calling POST /rooms/:id/archive returns 403 HOST_ONLY'
    );

    // 3h. Participant cannot view session list -> 403 HOST_ONLY
    const studentSessionsRes = await fetch(`${BASE_URL}/rooms/${testRoomId}/sessions`, {
      headers: { Authorization: `Bearer ${participantToken}` },
    });
    const studentSessionsBody = (await studentSessionsRes.json()) as any;
    assert(
      studentSessionsRes.status === 403 && studentSessionsBody.error?.code === 'HOST_ONLY',
      'Non-host participant calling GET /rooms/:id/sessions returns 403 HOST_ONLY'
    );

    // 3i. Participant cannot export attendance CSV -> 403 HOST_ONLY
    const studentCsvRes = await fetch(`${BASE_URL}/rooms/${testRoomId}/sessions/session-sec-01/attendance.csv`, {
      headers: { Authorization: `Bearer ${participantToken}` },
    });
    const studentCsvBody = (await studentCsvRes.json()) as any;
    assert(
      studentCsvRes.status === 403 && studentCsvBody.error?.code === 'HOST_ONLY',
      'Non-host participant calling GET attendance.csv returns 403 HOST_ONLY'
    );

    // -------------------------------------------------------------------------
    // CRITERION 4: Socket handlers re-check membership & flags on every event
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Criterion 4]\x1b[0m Socket handlers re-check membership & flags on every event...\n');

    // Connect outsider socket
    const outsiderSocket: ClientSocket = ClientSocketIO(BASE_URL, {
      auth: { token: outsiderToken },
      reconnection: false,
    });

    await new Promise<void>((resolve) => {
      outsiderSocket.on('connect', () => resolve());
    });

    // 4a. Outsider emitting live:joined -> rejected with NOT_A_MEMBER
    await new Promise<void>((resolve) => {
      outsiderSocket.emit('live:joined', { roomId: testRoomId }, (res: any) => {
        assert(
          res?.ok === false && res?.error?.code === 'NOT_A_MEMBER',
          'Socket live:joined from non-member rejected with NOT_A_MEMBER'
        );
        resolve();
      });
    });

    // 4b. Outsider emitting screen:start -> rejected with NOT_A_MEMBER
    await new Promise<void>((resolve) => {
      outsiderSocket.emit('screen:start', { roomId: testRoomId }, (res: any) => {
        assert(
          res?.ok === false && (res?.error?.code === 'NOT_A_MEMBER' || res?.error?.code === 'FORBIDDEN'),
          'Socket screen:start from non-member rejected with NOT_A_MEMBER/FORBIDDEN'
        );
        resolve();
      });
    });

    // 4c. Outsider emitting hand:raise -> rejected with NOT_A_MEMBER
    await new Promise<void>((resolve) => {
      outsiderSocket.emit('hand:raise', { roomId: testRoomId, raised: true }, (res: any) => {
        assert(
          res?.ok === false && res?.error?.code === 'NOT_A_MEMBER',
          'Socket hand:raise from non-member rejected with NOT_A_MEMBER'
        );
        resolve();
      });
    });

    // 4d. Outsider emitting chat:send -> rejected with NOT_A_MEMBER
    await new Promise<void>((resolve) => {
      outsiderSocket.emit('chat:send', { roomId: testRoomId, body: 'Intruder message' }, (res: any) => {
        assert(
          res?.ok === false && res?.error?.code === 'NOT_A_MEMBER',
          'Socket chat:send from non-member rejected with NOT_A_MEMBER'
        );
        resolve();
      });
    });

    // 4e. Outsider emitting wb:update -> rejected with NOT_A_MEMBER
    await new Promise<void>((resolve) => {
      outsiderSocket.emit('wb:update', { roomId: testRoomId, elements: [{ id: 'el-1' }] }, (res: any) => {
        assert(
          res?.ok === false && (res?.error?.code === 'NOT_A_MEMBER' || res?.error?.code === 'FORBIDDEN'),
          'Socket wb:update from non-member rejected with NOT_A_MEMBER/FORBIDDEN'
        );
        resolve();
      });
    });

    // 4f. Outsider emitting code:update -> rejected with NOT_A_MEMBER
    await new Promise<void>((resolve) => {
      outsiderSocket.emit('code:update', { roomId: testRoomId, content: 'x = 1' }, (res: any) => {
        assert(
          res?.ok === false && (res?.error?.code === 'NOT_A_MEMBER' || res?.error?.code === 'FORBIDDEN'),
          'Socket code:update from non-member rejected with NOT_A_MEMBER/FORBIDDEN'
        );
        resolve();
      });
    });

    // 4g. Outsider emitting code:run-started -> rejected with NOT_A_MEMBER
    await new Promise<void>((resolve) => {
      outsiderSocket.emit('code:run-started', { roomId: testRoomId, language: 'python' }, (res: any) => {
        assert(
          res?.ok === false && (res?.error?.code === 'NOT_A_MEMBER' || res?.error?.code === 'FORBIDDEN'),
          'Socket code:run-started from non-member rejected with NOT_A_MEMBER/FORBIDDEN'
        );
        resolve();
      });
    });

    // 4h. Outsider emitting code:request-pen -> rejected with NOT_A_MEMBER
    await new Promise<void>((resolve) => {
      outsiderSocket.emit('code:request-pen', { roomId: testRoomId }, (res: any) => {
        assert(
          res?.ok === false && (res?.error?.code === 'NOT_A_MEMBER' || res?.error?.code === 'FORBIDDEN'),
          'Socket code:request-pen from non-member rejected with NOT_A_MEMBER/FORBIDDEN'
        );
        resolve();
      });
    });

    outsiderSocket.disconnect();

    // Connect participant socket (member of room, but without whiteboard or pen)
    const participantSocket: ClientSocket = ClientSocketIO(BASE_URL, {
      auth: { token: participantToken },
      reconnection: false,
    });

    await new Promise<void>((resolve) => {
      participantSocket.on('connect', () => resolve());
    });

    // 4i. Participant without can_whiteboard emitting wb:update -> dropped with FORBIDDEN
    await new Promise<void>((resolve) => {
      participantSocket.emit('wb:update', { roomId: testRoomId, elements: [{ id: 'shape-1' }] }, (res: any) => {
        assert(
          res?.ok === false && res?.error?.code === 'FORBIDDEN',
          'Socket wb:update from member without can_whiteboard dropped with FORBIDDEN'
        );
        resolve();
      });
    });

    // 4j. Participant without pen emitting code:update -> dropped with NOT_PEN_HOLDER
    setPenHolder(testRoomId, hostUser.id); // Host holds pen
    await new Promise<void>((resolve) => {
      participantSocket.emit('code:update', { roomId: testRoomId, content: 'int main() {}' }, (res: any) => {
        assert(
          res?.ok === false && res?.error?.code === 'NOT_PEN_HOLDER',
          'Socket code:update from non-pen holder dropped with NOT_PEN_HOLDER'
        );
        resolve();
      });
    });

    participantSocket.disconnect();

  } finally {
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
