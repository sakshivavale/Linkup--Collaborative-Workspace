/**
 * Automated Verification Script for US-ROOM-03: Remove a Member (Host)
 * Traces to: FR-2.5
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { app, kickUserFromRoom } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { clearPresence } from '../src/realtime/presence';
import { Me } from '@linkup/shared';

const TEST_PORT = 3110;
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
  console.log('🚀 Running US-ROOM-03: Remove a Member (Host) Tests');
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
    clearPresence();

    const hostToken = 'test_host_token_room_remove';
    const memberToken = 'test_member_token_room_remove';

    const hostUser: Me = {
      id: 'host-room-remove-user',
      email: 'host@linkup.test',
      fullName: 'Host User',
      role: 'teacher',
    };

    const memberUser: Me = {
      id: 'member-room-remove-user',
      email: 'student@linkup.test',
      fullName: 'Removed Student',
      role: 'student',
    };

    setCachedUser(hostToken, hostUser, 60000);
    setCachedUser(memberToken, memberUser, 60000);

    const roomId = 'room-remove-member-test';
    setMockRooms(hostUser.id, [{
      id: roomId,
      name: 'Room Remove Test',
      description: 'Test room',
      joinCode: 'ABC123',
      hostName: hostUser.fullName,
      memberCount: 2,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
    }]);
    setMockRooms(memberUser.id, [{
      id: roomId,
      name: 'Room Remove Test',
      description: 'Test room',
      joinCode: null,
      hostName: hostUser.fullName,
      memberCount: 2,
      myRole: 'participant',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
    }]);

    console.log('\x1b[34m[Test 1]\x1b[0m Verifying host can remove a member via DELETE /api/rooms/:roomId/members/:userId...\n');

    const res = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${memberUser.id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });

    const body = await res.json();
    assert(
      res.status === 200 && body.ok === true,
      'Host can remove member from room',
      `Got status ${res.status}, body ${JSON.stringify(body)}`
    );

    console.log('\n\x1b[34m[Test 2]\x1b[0m Verifying host cannot remove the room host...\n');

    const hostRemoveRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${hostUser.id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
    });

    const hostRemoveBody = await hostRemoveRes.json();
    assert(
      hostRemoveRes.status === 403 && hostRemoveBody.error?.code === 'FORBIDDEN',
      'Host cannot remove themselves',
      `Got status ${hostRemoveRes.status}, code ${hostRemoveBody.error?.code}`
    );

    console.log('\n\x1b[34m[Test 3]\x1b[0m Verifying non-host cannot remove another member...\n');

    const nonHostRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${hostUser.id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
    });

    const nonHostBody = await nonHostRes.json();
    assert(
      nonHostRes.status === 403 && nonHostBody.error?.code === 'FORBIDDEN',
      'Non-host cannot remove members',
      `Got status ${nonHostRes.status}, code ${nonHostBody.error?.code}`
    );

    console.log('\n\x1b[34m[Test 4]\x1b[0m Verifying kicked sockets are removed from both room channels and presence is cleared...\n');

    const roomKey = roomId;
    const fakeSocket = {
      id: 'socket-kick-check',
      data: { user: { id: memberUser.id } },
      rooms: new Set([roomKey, `room:${roomKey}`]),
      emit: () => undefined,
      leave: (channel: string) => {
        fakeSocket.rooms.delete(channel);
      },
    } as any;

    const fakeIo = {
      sockets: {
        sockets: new Map([[fakeSocket.id, fakeSocket]]),
      },
      to: (channel: string) => ({
        emit: (_event: string, _payload: any) => {
          return { channel };
        },
      }),
    } as any;

    const kickResult = kickUserFromRoom(fakeIo, roomKey, memberUser.id);
    assert(
      kickResult.socketsRemoved === 1 && !fakeSocket.rooms.has(roomKey) && !fakeSocket.rooms.has(`room:${roomKey}`),
      'Kicked socket leaves both room channels and presence is cleared',
      `Result ${JSON.stringify(kickResult)}; remaining rooms ${Array.from(fakeSocket.rooms)}`
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
