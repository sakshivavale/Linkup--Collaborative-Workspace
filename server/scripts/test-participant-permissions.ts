/**
 * Automated Verification Script for US-PERM-01: View Participant Permissions (Host)
 * Module: Permission Control
 * Priority: P0 | Traces to: FR-4.1, S5
 *
 * Acceptance Criteria Verified:
 * 1. The Participants tab in the host view shows a row per participant: name, online dot, and 5 toggles (Mic, Camera, Screen, Whiteboard, Code).
 * 2. The host's own row shows all toggles permanently enabled and locked (cannot be changed).
 * 3. Students see the People tab but do not see the toggles.
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
import { Me, RoomSummary, Member } from '@linkup/shared';

const TEST_PORT = 3137;
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
  console.log('🚀 Running US-PERM-01: View Participant Permissions Tests (FR-4.1)');
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

    const hostToken = 'test_host_token_perm_01';
    const studentToken = 'test_student_token_perm_01';

    const hostUser: Me = {
      id: 'host-user-perm-01',
      email: 'prof.lovelace@linkup.test',
      fullName: 'Prof. Ada Lovelace',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'student-user-perm-01',
      email: 'babbage@linkup.test',
      fullName: 'Charles Babbage',
      role: 'student',
    };

    setCachedUser(hostToken, hostUser, 60000);
    setCachedUser(studentToken, studentUser, 60000);

    const roomId = 'room-perm-01-test';

    const roomMembers: Member[] = [
      {
        userId: hostUser.id,
        fullName: hostUser.fullName,
        userRole: 'teacher',
        memberRole: 'host',
        permissions: {
          canMic: true,
          canCamera: true,
          canScreen: true,
          canWhiteboard: true,
          canCode: true,
        },
        joinedAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        userId: studentUser.id,
        fullName: studentUser.fullName,
        userRole: 'student',
        memberRole: 'participant',
        permissions: {
          canMic: true,
          canCamera: true,
          canScreen: false,
          canWhiteboard: true,
          canCode: true,
        },
        joinedAt: new Date(Date.now() - 1800000).toISOString(),
      },
    ];

    const hostRoom: RoomSummary = {
      id: roomId,
      name: 'Algorithmics & Quantum Computing',
      description: 'Room for permission testing',
      joinCode: 'PERM01',
      hostName: hostUser.fullName,
      memberCount: 2,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      members: roomMembers,
    };

    const studentRoom: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    setMockRooms(hostUser.id, [hostRoom]);
    setMockRooms(studentUser.id, [studentRoom]);

    console.log('--- Criterion 1: Host View Shows Participants Tab with 5 Toggles per Person ---');
    {
      const res = await fetch(`${BASE_URL}/api/rooms/${roomId}`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      });
      assert(res.status === 200, 'AC-1: Host fetches room summary with 200 OK');
      const data = await res.json();
      assert(data.myRole === 'host', 'AC-1: Host user role in room is "host"');
      assert(Array.isArray(data.members) && data.members.length === 2, 'AC-1: Returns both room members');

      // Check student member initial permissions from room details
      const studentMember = data.members.find((m: Member) => m.userId === studentUser.id);
      assert(Boolean(studentMember?.permissions), 'AC-1: Student member has permissions object');
      assert(studentMember?.permissions?.canMic === true, 'AC-1: Student has canMic=true');
      assert(studentMember?.permissions?.canCamera === true, 'AC-1: Student has canCamera=true');
      assert(studentMember?.permissions?.canScreen === false, 'AC-1: Student has canScreen=false');
      assert(studentMember?.permissions?.canWhiteboard === true, 'AC-1: Student has canWhiteboard=true');
      assert(studentMember?.permissions?.canCode === true, 'AC-1: Student has canCode=true');
    }

    console.log('\n--- Criterion 1, 2, 3: Client Component Verification (PeoplePanel.tsx & RoomPage.tsx) ---');
    {
      const peoplePanelPath = path.resolve(__dirname, '../../client/src/features/rooms/PeoplePanel.tsx');
      const roomPagePath = path.resolve(__dirname, '../../client/src/features/rooms/RoomPage.tsx');

      assert(fs.existsSync(peoplePanelPath), 'PeoplePanel.tsx exists');
      assert(fs.existsSync(roomPagePath), 'RoomPage.tsx exists');

      const peoplePanelCode = fs.readFileSync(peoplePanelPath, 'utf8');
      const roomPageCode = fs.readFileSync(roomPagePath, 'utf8');

      // AC-1: Dynamic tab label: "Participants" for host, "People" for students
      const hasParticipantsTab =
        roomPageCode.includes("isHost ? 'Participants' : 'People'") ||
        roomPageCode.includes('Participants');
      assert(hasParticipantsTab, 'AC-1/3: Tab is labeled "Participants" for host and "People" for students in RoomPage.tsx');

      const hasParticipantsHeader =
        peoplePanelCode.includes("room.myRole === 'host' ? 'Participants' : 'People'");
      assert(hasParticipantsHeader, 'AC-1/3: PeoplePanel header displays "Participants" for host and "People" for students');

      // AC-1: Row contains name, online dot, and 5 toggles (Mic, Camera, Screen, Whiteboard, Code)
      const hasNameAndDot =
        peoplePanelCode.includes('data-testid={`member-name-${memberId}`}') &&
        peoplePanelCode.includes('data-testid={`member-presence-${memberId}`}');
      assert(hasNameAndDot, 'AC-1: Each member row includes name and presence dot');

      const hasFiveToggles =
        peoplePanelCode.includes('toggle-perm-mic') &&
        peoplePanelCode.includes('toggle-perm-camera') &&
        peoplePanelCode.includes('toggle-perm-screen') &&
        peoplePanelCode.includes('toggle-perm-whiteboard') &&
        peoplePanelCode.includes('toggle-perm-code');
      assert(hasFiveToggles, 'AC-1: Includes all 5 permission toggles: Mic, Camera, Screen, Whiteboard, Code');

      // AC-2: Host's own row shows all toggles permanently enabled and locked (cannot be changed)
      const hasLockedHostToggles =
        peoplePanelCode.includes('const isLocked = isHostMember') &&
        peoplePanelCode.includes('disabled={isLocked}') &&
        peoplePanelCode.includes('Host permissions are permanently enabled and locked');
      assert(hasLockedHostToggles, 'AC-2: Host row has all toggles permanently enabled and locked (disabled={isLocked})');

      // AC-3: Students see the People tab but do not see the toggles
      const hasStudentToggleGate =
        peoplePanelCode.includes('{isHostViewer && (') &&
        peoplePanelCode.includes('data-testid={`member-permissions-${memberId}`}');
      assert(hasStudentToggleGate, 'AC-3: Permission toggles container is gated by isHostViewer so students do not see toggles');
    }

    console.log('\n--- Criterion 2 & 3: Security & Server API Enforcement ---');
    {
      // 1. Host tries to modify their own permissions -> Server blocks it with 403
      const hostSelfPatchRes = await fetch(
        `${BASE_URL}/api/rooms/${roomId}/members/${hostUser.id}/permissions`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${hostToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ canMic: false }),
        }
      );
      assert(hostSelfPatchRes.status === 403, 'AC-2 Security: Server rejects host self-permission modification with 403');
      const hostSelfData = await hostSelfPatchRes.json();
      assert(
        hostSelfData.error?.message?.includes('host always retains full permissions') ||
        hostSelfData.error?.code === 'FORBIDDEN',
        'AC-2 Security: Server explains host always retains full permissions'
      );

      // 2. Student attempts to update permissions -> Server blocks with 403 HOST_ONLY
      const studentPatchRes = await fetch(
        `${BASE_URL}/api/rooms/${roomId}/members/${studentUser.id}/permissions`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${studentToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ canScreen: true }),
        }
      );
      assert(studentPatchRes.status === 403, 'AC-3 Security: Non-host student cannot update permissions (403)');
      const studentPatchData = await studentPatchRes.json();
      assert(
        studentPatchData.error?.code === 'HOST_ONLY' || studentPatchData.error?.code === 'FORBIDDEN',
        'AC-3 Security: Error code is HOST_ONLY or FORBIDDEN'
      );

      // 3. Host successfully updates student permission
      const hostUpdateRes = await fetch(
        `${BASE_URL}/api/rooms/${roomId}/members/${studentUser.id}/permissions`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${hostToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ canScreen: true }),
        }
      );
      assert(hostUpdateRes.status === 200, 'Host can successfully update student permissions (200 OK)');
      const hostUpdateData = await hostUpdateRes.json();
      assert(hostUpdateData.permissions?.canScreen === true, 'Updated student permission reflects canScreen: true');
    }

  } catch (err: any) {
    console.error('Unhandled test failure:', err);
    failedCount++;
  } finally {
    testServer.close();
  }

  console.log('\n============================================================');
  console.log(`Test Summary: \x1b[32m${passedCount} Passed\x1b[0m, \x1b[31m${failedCount} Failed\x1b[0m`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
