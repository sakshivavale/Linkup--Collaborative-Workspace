/**
 * Automated Verification Script for US-PERM-07: Raise Hand
 * Module: Permission Control
 * Priority: P1 | Traces to: FR-4.8
 *
 * Acceptance Criteria Verified:
 * 1. A hand-raise button is available in the call control bar for all participants.
 * 2. Raising a hand emits hand:raise { raised: true } and all room members receive hand:changed;
 *    a hand icon appears on the student's participant row.
 * 3. The host can click a "Grant Mic" button next to the hand icon; this grants can_mic = true and lowers the hand.
 * 4. The student can lower their own hand at any time.
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
import { Me, RoomSummary, Member, PresenceEntry } from '@linkup/shared';

const TEST_PORT = 3139;
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
  console.log('🚀 Running US-PERM-07: Raise Hand Automated Tests (FR-4.8)');
  console.log('============================================================\n');

  const testServer = http.createServer(app);
  io.attach(testServer);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  let hostSocket: ClientSocketType | null = null;
  let studentSocket: ClientSocketType | null = null;
  let otherStudentSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();

    const hostToken = 'test_host_token_perm_07';
    const studentToken = 'test_student_token_perm_07';
    const otherStudentToken = 'test_other_student_token_perm_07';

    const hostUser: Me = {
      id: 'host-user-perm-07',
      email: 'teacher.hand@linkup.test',
      fullName: 'Dr. Turing',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'student-user-perm-07',
      email: 'student.lovelace@linkup.test',
      fullName: 'Ada Lovelace',
      role: 'student',
    };

    const otherStudentUser: Me = {
      id: 'other-student-perm-07',
      email: 'student.babbage@linkup.test',
      fullName: 'Charles Babbage',
      role: 'student',
    };

    setCachedUser(hostToken, hostUser, 60000);
    setCachedUser(studentToken, studentUser, 60000);
    setCachedUser(otherStudentToken, otherStudentUser, 60000);

    const roomId = 'room-perm-07-test';

    const initialMembers: Member[] = [
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
          canMic: false, // Student starts without mic permission
          canCamera: true,
          canScreen: false,
          canWhiteboard: true,
          canCode: true,
        },
        joinedAt: new Date(Date.now() - 1800000).toISOString(),
      },
      {
        userId: otherStudentUser.id,
        fullName: otherStudentUser.fullName,
        userRole: 'student',
        memberRole: 'participant',
        permissions: {
          canMic: false,
          canCamera: true,
          canScreen: false,
          canWhiteboard: true,
          canCode: true,
        },
        joinedAt: new Date(Date.now() - 900000).toISOString(),
      },
    ];

    const testRoom: RoomSummary = {
      id: roomId,
      name: 'Computer Science 101',
      description: 'Permissions and Hand Raise Testing Room',
      joinCode: 'HAND07',
      hostName: hostUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: 'session-perm-07',
      createdAt: new Date().toISOString(),
      members: initialMembers,
      presence: [
        { userId: hostUser.id, fullName: hostUser.fullName, inLive: true, handRaised: false },
        { userId: studentUser.id, fullName: studentUser.fullName, inLive: true, handRaised: false },
        { userId: otherStudentUser.id, fullName: otherStudentUser.fullName, inLive: true, handRaised: false },
      ],
    };

    setMockRooms(hostUser.id, [{ ...testRoom, myRole: 'host' }]);
    setMockRooms(studentUser.id, [{ ...testRoom, myRole: 'participant' }]);
    setMockRooms(otherStudentUser.id, [{ ...testRoom, myRole: 'participant' }]);

    // Connect sockets
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: hostToken },
      transports: ['websocket'],
    });

    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    otherStudentSocket = ClientSocket(BASE_URL, {
      auth: { token: otherStudentToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((r) => hostSocket!.on('connect', () => r())),
      new Promise<void>((r) => studentSocket!.on('connect', () => r())),
      new Promise<void>((r) => otherStudentSocket!.on('connect', () => r())),
    ]);

    // Join room channel
    await new Promise<void>((r) => {
      hostSocket!.emit('room:join', { roomId }, () => r());
    });
    await new Promise<void>((r) => {
      studentSocket!.emit('room:join', { roomId }, () => r());
    });
    await new Promise<void>((r) => {
      otherStudentSocket!.emit('room:join', { roomId }, () => r());
    });

    // ─── Test 1: Acceptance Criteria 1 — Hand-raise button in call control bar ─────
    console.log('[Test 1] Acceptance Criteria 1: A hand-raise button is available in the call control bar for all participants...');
    {
      const liveTabPath = path.resolve(__dirname, '../../client/src/features/rooms/LiveTab.tsx');
      assert(fs.existsSync(liveTabPath), 'LiveTab.tsx component exists');

      const liveTabCode = fs.readFileSync(liveTabPath, 'utf-8');
      assert(
        liveTabCode.includes('id="room-hand-raise-toggle"') &&
        liveTabCode.includes('data-testid="room-hand-raise-toggle"'),
        'AC-1: Call control bar contains button with id="room-hand-raise-toggle" and data-testid="room-hand-raise-toggle"'
      );

      assert(
        liveTabCode.includes('handleToggleHandRaise'),
        'AC-1: Hand-raise button triggers handleToggleHandRaise click handler'
      );

      assert(
        liveTabCode.includes("aria-label={isHandRaised ? 'Lower hand' : 'Raise hand'}") ||
        liveTabCode.includes('isHandRaised ? "Lower hand" : "Raise hand"'),
        'AC-1: Button provides accessible title and aria-label toggling between "Raise hand" and "Lower hand"'
      );

      assert(
        !liveTabCode.includes('!isHost && <button id="room-hand-raise-toggle"') &&
        !liveTabCode.includes('!isHost && \n') &&
        liveTabCode.includes('room-hand-raise-toggle'),
        'AC-1: Hand-raise toggle is accessible for all participants (not hidden for hosts or students)'
      );
    }

    // ─── Test 2: Acceptance Criteria 2 — Raising hand emits hand:raise and broadcasts hand:changed ───
    console.log('\n[Test 2] Acceptance Criteria 2: Raising hand emits hand:raise { raised: true } and broadcasts hand:changed...');
    {
      let hostReceivedHandChanged: any = null;
      let studentReceivedHandChanged: any = null;
      let otherStudentReceivedHandChanged: any = null;
      let hostReceivedPresenceUpdate: any = null;

      hostSocket!.on('hand:changed', (data) => {
        hostReceivedHandChanged = data;
      });

      studentSocket!.on('hand:changed', (data) => {
        studentReceivedHandChanged = data;
      });

      otherStudentSocket!.on('hand:changed', (data) => {
        otherStudentReceivedHandChanged = data;
      });

      hostSocket!.on('presence:update', (data) => {
        hostReceivedPresenceUpdate = data;
      });

      // Student raises hand
      studentSocket!.emit('hand:raise', { roomId, raised: true });

      // Wait for broadcast
      await new Promise((r) => setTimeout(r, 200));

      assert(
        hostReceivedHandChanged !== null &&
        hostReceivedHandChanged.roomId === roomId &&
        hostReceivedHandChanged.userId === studentUser.id &&
        hostReceivedHandChanged.raised === true,
        'AC-2: Host receives hand:changed { roomId, userId: studentId, raised: true }'
      );

      assert(
        studentReceivedHandChanged !== null &&
        studentReceivedHandChanged.userId === studentUser.id &&
        studentReceivedHandChanged.raised === true,
        'AC-2: Raising student receives hand:changed confirmation'
      );

      assert(
        otherStudentReceivedHandChanged !== null &&
        otherStudentReceivedHandChanged.userId === studentUser.id &&
        otherStudentReceivedHandChanged.raised === true,
        'AC-2: Other student in room receives hand:changed event'
      );

      assert(
        hostReceivedPresenceUpdate !== null &&
        Array.isArray(hostReceivedPresenceUpdate.presence) &&
        hostReceivedPresenceUpdate.presence.some(
          (p: PresenceEntry) => p.userId === studentUser.id && p.handRaised === true
        ),
        'AC-2: presence:update broadcast updates student handRaised status to true'
      );

      // Verify PeoplePanel.tsx renders hand icon
      const peoplePanelPath = path.resolve(__dirname, '../../client/src/features/rooms/PeoplePanel.tsx');
      assert(fs.existsSync(peoplePanelPath), 'PeoplePanel.tsx component exists');

      const peoplePanelCode = fs.readFileSync(peoplePanelPath, 'utf-8');
      assert(
        peoplePanelCode.includes('member-hand-icon-') &&
        peoplePanelCode.includes('data-testid={`member-hand-icon-${memberId}`}') &&
        peoplePanelCode.includes('isHandRaised'),
        'AC-2: Student participant row in PeoplePanel renders hand icon badge (member-hand-icon-${memberId}) when hand is raised'
      );

      assert(
        peoplePanelCode.includes("socket.on('hand:changed'"),
        'AC-2: PeoplePanel listens for hand:changed socket event to update presence dynamically'
      );
    }

    // ─── Test 3: Acceptance Criteria 3 — Host clicks "Grant Mic" button ───────────
    console.log('\n[Test 3] Acceptance Criteria 3: Host clicks "Grant Mic" button; grants can_mic = true and lowers the hand...');
    {
      const peoplePanelPath = path.resolve(__dirname, '../../client/src/features/rooms/PeoplePanel.tsx');
      const peoplePanelCode = fs.readFileSync(peoplePanelPath, 'utf-8');

      assert(
        peoplePanelCode.includes('member-grant-mic-btn-') &&
        peoplePanelCode.includes('Grant Mic') &&
        peoplePanelCode.includes('isHostViewer && isHandRaised && !isHostMember'),
        'AC-3: "Grant Mic" button is rendered next to hand icon exclusively for host viewing student with hand raised'
      );

      assert(
        peoplePanelCode.includes('handleGrantMic'),
        'AC-3: "Grant Mic" button triggers handleGrantMic action'
      );

      let hostReceivedLowerHand: any = null;
      let studentReceivedLowerHand: any = null;
      let studentReceivedPermChanged: any = null;

      hostSocket!.removeAllListeners('hand:changed');
      studentSocket!.removeAllListeners('hand:changed');
      studentSocket!.removeAllListeners('perm:changed');

      hostSocket!.on('hand:changed', (data) => {
        hostReceivedLowerHand = data;
      });

      studentSocket!.on('hand:changed', (data) => {
        studentReceivedLowerHand = data;
      });

      studentSocket!.on('perm:changed', (data) => {
        studentReceivedPermChanged = data;
      });

      // Host grants mic to student via PATCH /api/rooms/:roomId/members/:userId/permissions
      const patchRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${studentUser.id}/permissions`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ canMic: true }),
      });

      const patchBody = (await patchRes.json()) as any;
      assert(patchRes.status === 200, 'AC-3: Host PATCH permissions endpoint returns 200 OK');
      assert(patchBody.permissions?.canMic === true, 'AC-3: Permissions response confirms canMic is now true');

      // Wait for broadcast
      await new Promise((r) => setTimeout(r, 200));

      assert(
        hostReceivedLowerHand !== null &&
        hostReceivedLowerHand.userId === studentUser.id &&
        hostReceivedLowerHand.raised === false,
        'AC-3: Host receives hand:changed { raised: false } lowering the hand upon granting mic'
      );

      assert(
        studentReceivedLowerHand !== null &&
        studentReceivedLowerHand.userId === studentUser.id &&
        studentReceivedLowerHand.raised === false,
        'AC-3: Student receives hand:changed { raised: false } lowering their hand'
      );

      assert(
        studentReceivedPermChanged !== null &&
        studentReceivedPermChanged.userId === studentUser.id &&
        studentReceivedPermChanged.permissions?.canMic === true,
        'AC-3: Student receives perm:changed granting canMic = true'
      );
    }

    // ─── Test 4: Acceptance Criteria 4 — Student lowers their own hand at any time ──
    console.log('\n[Test 4] Acceptance Criteria 4: Student can lower their own hand at any time...');
    {
      const peoplePanelPath = path.resolve(__dirname, '../../client/src/features/rooms/PeoplePanel.tsx');
      const peoplePanelCode = fs.readFileSync(peoplePanelPath, 'utf-8');

      assert(
        peoplePanelCode.includes('member-lower-hand-btn-') &&
        peoplePanelCode.includes('Lower Hand') &&
        peoplePanelCode.includes('member.isSelf && isHandRaised'),
        'AC-4: Student sees "Lower Hand" button on their own row when hand is raised'
      );

      // Student raises hand again
      studentSocket!.emit('hand:raise', { roomId, raised: true });
      await new Promise((r) => setTimeout(r, 150));

      let studentLowerEvent: any = null;
      let hostLowerEvent: any = null;

      studentSocket!.removeAllListeners('hand:changed');
      hostSocket!.removeAllListeners('hand:changed');

      studentSocket!.on('hand:changed', (data) => {
        studentLowerEvent = data;
      });
      hostSocket!.on('hand:changed', (data) => {
        hostLowerEvent = data;
      });

      // Student lowers their own hand
      studentSocket!.emit('hand:raise', { roomId, raised: false });
      await new Promise((r) => setTimeout(r, 150));

      assert(
        studentLowerEvent !== null &&
        studentLowerEvent.userId === studentUser.id &&
        studentLowerEvent.raised === false,
        'AC-4: Student successfully lowers own hand, receiving hand:changed { raised: false }'
      );

      assert(
        hostLowerEvent !== null &&
        hostLowerEvent.userId === studentUser.id &&
        hostLowerEvent.raised === false,
        'AC-4: Host receives hand:changed { raised: false } reflecting student lowered hand'
      );

      // Test fallback roomId extraction (payload: { raised: false })
      let fallbackEvent: any = null;
      hostSocket!.removeAllListeners('hand:changed');
      hostSocket!.on('hand:changed', (data) => {
        fallbackEvent = data;
      });

      studentSocket!.emit('hand:raise', { raised: true });
      await new Promise((r) => setTimeout(r, 150));

      assert(
        fallbackEvent !== null && fallbackEvent.raised === true,
        'AC-2/4: hand:raise without explicit roomId extracts roomId from joined socket rooms'
      );
    }

    // ─── Test 5: Video Grid Tile Indicator ────────────────────────────────────────
    console.log('\n[Test 5] VideoGrid and ParticipantTile Hand Raised Indicator...');
    {
      const participantTilePath = path.resolve(__dirname, '../../client/src/features/rooms/ParticipantTile.tsx');
      const tileCode = fs.readFileSync(participantTilePath, 'utf-8');

      assert(
        tileCode.includes('participant-hand-raised-') &&
        tileCode.includes('participant.handRaised'),
        'ParticipantTile displays floating hand indicator badge when participant.handRaised is true'
      );
    }

    // ─── Test 6: Security Checks ──────────────────────────────────────────────────
    console.log('\n[Test 6] Security: Non-host student cannot call PATCH permissions...');
    {
      const unauthRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/members/${studentUser.id}/permissions`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${studentToken}`, // Student attempting host action
        },
        body: JSON.stringify({ canMic: true }),
      });

      assert(unauthRes.status === 403, 'Non-host attempting to grant mic receives 403 Forbidden');
    }

  } finally {
    if (hostSocket) hostSocket.disconnect();
    if (studentSocket) studentSocket.disconnect();
    if (otherStudentSocket) otherStudentSocket.disconnect();
    testServer.close();
  }

  console.log('\n============================================================');
  console.log(`Summary: ${passedCount} passed, ${failedCount} failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test run failed with error:', err);
  process.exit(1);
});
