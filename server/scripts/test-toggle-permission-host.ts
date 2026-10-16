/*
 * Automated Verification Script for US-PERM-02: Toggle a Permission (Host)
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { Me } from '@linkup/shared';

const TEST_PORT = 3120;
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
  console.log('🚀 Running US-PERM-02: Toggle a Permission (Host) Tests');
  console.log('============================================================\n');

  const testServer = http.createServer(app);
  io.attach(testServer);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  try {
    clearTokenCache();
    clearMockRooms();

    const hostToken = 'test_host_token_perm_toggle';
    const memberToken = 'test_member_token_perm_toggle';

    const hostUser: Me = {
      id: 'host-perm-toggle-user',
      email: 'host@linkup.test',
      fullName: 'Host User',
      role: 'teacher',
    };

    const memberUser: Me = {
      id: 'member-perm-toggle-user',
      email: 'member@linkup.test',
      fullName: 'Member User',
      role: 'student',
    };

    setCachedUser(hostToken, hostUser, 60000);
    setCachedUser(memberToken, memberUser, 60000);

    const roomId = 'room-perm-toggle-test';
    setMockRooms(hostUser.id, [{
      id: roomId,
      name: 'Permission Toggle Test',
      description: 'Test room',
      joinCode: 'XYZ123',
      hostName: hostUser.fullName,
      memberCount: 2,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      members: [{
        userId: hostUser.id,
        fullName: hostUser.fullName,
        userRole: 'teacher',
        memberRole: 'host',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      }, {
        userId: memberUser.id,
        fullName: memberUser.fullName,
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      }],
    }]);
    setMockRooms(memberUser.id, [{
      id: roomId,
      name: 'Permission Toggle Test',
      description: 'Test room',
      joinCode: null,
      hostName: hostUser.fullName,
      memberCount: 2,
      myRole: 'participant',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      members: [{
        userId: hostUser.id,
        fullName: hostUser.fullName,
        userRole: 'teacher',
        memberRole: 'host',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      }, {
        userId: memberUser.id,
        fullName: memberUser.fullName,
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      }],
    }]);

    console.log('\x1b[34m[Test 1]\x1b[0m Verifying host can toggle a participant permission via PATCH /api/rooms/:roomId/members/:userId/permissions...\n');
    const res = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${memberUser.id}/permissions`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ canMic: false }),
    });

    const body = await res.json();
    assert(
      res.status === 200 && body.permissions?.canMic === false,
      'Host can toggle a participant permission',
      `Got status ${res.status}, body ${JSON.stringify(body)}`
    );

    console.log('\n\x1b[34m[Test 2]\x1b[0m Verifying non-host cannot change permissions...\n');
    const nonHostRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${memberUser.id}/permissions`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ canCamera: false }),
    });

    const nonHostBody = await nonHostRes.json();
    assert(
      nonHostRes.status === 403 && nonHostBody.error?.code === 'HOST_ONLY',
      'Non-host cannot toggle permissions',
      `Got status ${nonHostRes.status}, code ${nonHostBody.error?.code}`
    );

    console.log('\n\x1b[34m[Test 3]\x1b[0m Verifying host cannot toggle their own fixed permissions...\n');
    const hostSelfRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${hostUser.id}/permissions`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ canScreen: false }),
    });

    const hostSelfBody = await hostSelfRes.json();
    assert(
      hostSelfRes.status === 403 && hostSelfBody.error?.code === 'FORBIDDEN',
      'Host cannot toggle their own permissions',
      `Got status ${hostSelfRes.status}, code ${hostSelfBody.error?.code}`
    );

    console.log(`\nSummary: ${passedCount} passed, ${failedCount} failed`);
    if (failedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    clearMockRooms();
    clearTokenCache();
    testServer.close();
  }
}

runTests();
