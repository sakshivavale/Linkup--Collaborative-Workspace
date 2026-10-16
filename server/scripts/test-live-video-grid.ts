/**
 * Automated Verification Script for US-LIVE-03: Video Grid with Participant Tiles
 * Priority: P0 | Traces to: FR-3.4
 *
 * Acceptance Criteria Verified:
 * 1. Each participant tile shows their name, a mute icon when their mic is off, and a camera-off icon when their camera is off.
 * 2. The currently speaking participant's tile is visually highlighted (active speaker highlight).
 * 3. Tiles update dynamically as participants join/leave.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocketIO, Socket as ClientSocket } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { clearPresence } from '../src/realtime/presence';
import { Me, PresenceEntry, RoomSummary } from '@linkup/shared';

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
  console.log('🚀 Running US-LIVE-03: Video Grid with Participant Tiles Tests');
  console.log('============================================================\n');

  const testServer = http.createServer(app);
  io.attach(testServer);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  const socketsToClose: ClientSocket[] = [];

  try {
    clearTokenCache();
    clearMockRooms();
    clearPresence();

    const teacherToken = 'test_teacher_video_grid_token';
    const student1Token = 'test_student1_video_grid_token';
    const student2Token = 'test_student2_video_grid_token';

    const teacherUser: Me = {
      id: 'teacher-grid-1',
      email: 'ada@linkup.test',
      fullName: 'Prof. Ada Lovelace',
      role: 'teacher',
    };

    const student1User: Me = {
      id: 'student-grid-1',
      email: 'alan@linkup.test',
      fullName: 'Alan Turing',
      role: 'student',
    };

    const student2User: Me = {
      id: 'student-grid-2',
      email: 'grace@linkup.test',
      fullName: 'Grace Hopper',
      role: 'student',
    };

    setCachedUser(teacherToken, teacherUser, 60000);
    setCachedUser(student1Token, student1User, 60000);
    setCachedUser(student2Token, student2User, 60000);

    const roomId = 'room-video-grid-test';
    const activeSessionId = 'session-video-grid-123';

    const testRoom: RoomSummary = {
      id: roomId,
      name: 'Advanced Computing Live Lab',
      description: 'Room for live video grid testing',
      joinCode: 'GRID01',
      hostName: teacherUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId,
      createdAt: new Date().toISOString(),
      members: [
        {
          userId: teacherUser.id,
          fullName: teacherUser.fullName,
          userRole: 'teacher',
          memberRole: 'host',
          permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
          joinedAt: new Date().toISOString(),
        },
        {
          userId: student1User.id,
          fullName: student1User.fullName,
          userRole: 'student',
          memberRole: 'participant',
          permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
          joinedAt: new Date().toISOString(),
        },
        {
          userId: student2User.id,
          fullName: student2User.fullName,
          userRole: 'student',
          memberRole: 'participant',
          permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
          joinedAt: new Date().toISOString(),
        },
      ],
    };

    setMockRooms(teacherUser.id, [testRoom]);
    setMockRooms(student1User.id, [{ ...testRoom, myRole: 'participant', joinCode: null }]);
    setMockRooms(student2User.id, [{ ...testRoom, myRole: 'participant', joinCode: null }]);

    // Connect Teacher and Student sockets
    console.log('\x1b[34m[Setup]\x1b[0m Connecting Teacher and Student 1 sockets to room channel...\n');

    const teacherSocket = ClientSocketIO(BASE_URL, {
      auth: { token: teacherToken },
      transports: ['websocket'],
    });
    socketsToClose.push(teacherSocket);

    const student1Socket = ClientSocketIO(BASE_URL, {
      auth: { token: student1Token },
      transports: ['websocket'],
    });
    socketsToClose.push(student1Socket);

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        teacherSocket.on('connect', () => {
          teacherSocket.emit('room:join', { roomId }, (ack: any) => {
            if (ack?.ok) resolve();
            else reject(new Error('Teacher room:join failed'));
          });
        });
      }),
      new Promise<void>((resolve, reject) => {
        student1Socket.on('connect', () => {
          student1Socket.emit('room:join', { roomId }, (ack: any) => {
            if (ack?.ok) resolve();
            else reject(new Error('Student 1 room:join failed'));
          });
        });
      }),
    ]);

    assert(teacherSocket.connected && student1Socket.connected, 'Both sockets connected to room channel');

    // -------------------------------------------------------------------------
    // CRITERION 1: Participant tile shows name, mute icon, camera-off icon
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Criterion 1]\x1b[0m Verifying participant tile shows name, mute icon when mic is off, and camera-off icon when camera is off...\n');

    // Teacher enters call with mic off and camera off (US-LIVE-02 AC-3 default)
    const teacherJoinPromise = new Promise<{ presence: PresenceEntry[]; participantEvent?: any }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for live:joined presence')), 3000);
      let participantEvent: any = null;

      student1Socket.on('live:participant-joined', (payload: any) => {
        if (payload.roomId === roomId && payload.participant.userId === teacherUser.id) {
          participantEvent = payload.participant;
        }
      });

      student1Socket.on('presence:update', (data: { roomId: string; presence: PresenceEntry[] }) => {
        const teacherP = data.presence.find((p) => p.userId === teacherUser.id);
        if (teacherP && teacherP.inLive) {
          clearTimeout(timeout);
          resolve({ presence: data.presence, participantEvent });
        }
      });
    });

    teacherSocket.emit('live:joined', { roomId, micOn: false, cameraOn: false });
    const teacherJoinResult = await teacherJoinPromise;

    const teacherTile = teacherJoinResult.presence.find((p) => p.userId === teacherUser.id);
    assert(Boolean(teacherTile), 'Teacher tile is present in live participants list');
    assert(
      teacherTile?.fullName === teacherUser.fullName,
      `Participant tile shows correct name: "${teacherTile?.fullName}"`
    );
    assert(
      teacherTile?.micOn === false,
      'Participant tile indicates mic is off (mute icon displayed)'
    );
    assert(
      teacherTile?.cameraOn === false,
      'Participant tile indicates camera is off (camera-off icon displayed)'
    );

    // Test updating mic status: Teacher un-mutes microphone
    const teacherUnmutePromise = new Promise<PresenceEntry>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for mic unmute')), 3000);
      student1Socket.on('presence:update', (data: { roomId: string; presence: PresenceEntry[] }) => {
        const teacherP = data.presence.find((p) => p.userId === teacherUser.id);
        if (teacherP && teacherP.micOn === true) {
          clearTimeout(timeout);
          resolve(teacherP);
        }
      });
    });

    teacherSocket.emit('live:media-state', { roomId, micOn: true });
    const unmutedTile = await teacherUnmutePromise;
    assert(unmutedTile.micOn === true, 'Tile dynamically updates to unmuted when mic is turned on');

    // Test updating camera status: Teacher turns on camera
    const teacherCamOnPromise = new Promise<PresenceEntry>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for camera on')), 3000);
      student1Socket.on('presence:update', (data: { roomId: string; presence: PresenceEntry[] }) => {
        const teacherP = data.presence.find((p) => p.userId === teacherUser.id);
        if (teacherP && teacherP.cameraOn === true) {
          clearTimeout(timeout);
          resolve(teacherP);
        }
      });
    });

    teacherSocket.emit('live:media-state', { roomId, cameraOn: true });
    const camOnTile = await teacherCamOnPromise;
    assert(camOnTile.cameraOn === true, 'Tile dynamically updates camera state when camera is turned on');

    // -------------------------------------------------------------------------
    // CRITERION 2: Currently speaking participant's tile is visually highlighted
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Criterion 2]\x1b[0m Verifying currently speaking participant tile is visually highlighted (active speaker)...\n');

    // Teacher begins speaking
    const speakingPromise = new Promise<{ presence: PresenceEntry; speakerEvent?: any }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for live:speaking')), 3000);
      let speakerEvent: any = null;

      student1Socket.on('live:speaker-changed', (payload: any) => {
        if (payload.roomId === roomId && payload.userId === teacherUser.id) {
          speakerEvent = payload;
        }
      });

      student1Socket.on('presence:update', (data: { roomId: string; presence: PresenceEntry[] }) => {
        const teacherP = data.presence.find((p) => p.userId === teacherUser.id);
        if (teacherP && teacherP.isSpeaking === true) {
          clearTimeout(timeout);
          resolve({ presence: teacherP, speakerEvent });
        }
      });
    });

    teacherSocket.emit('live:speaking', { roomId, isSpeaking: true });
    const speakingResult = await speakingPromise;

    assert(
      speakingResult.presence.isSpeaking === true,
      'Tile has isSpeaking=true (active speaker highlight triggered)'
    );

    // Teacher stops speaking
    const stopSpeakingPromise = new Promise<PresenceEntry>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for stop speaking')), 3000);
      student1Socket.on('presence:update', (data: { roomId: string; presence: PresenceEntry[] }) => {
        const teacherP = data.presence.find((p) => p.userId === teacherUser.id);
        if (teacherP && teacherP.isSpeaking === false) {
          clearTimeout(timeout);
          resolve(teacherP);
        }
      });
    });

    teacherSocket.emit('live:speaking', { roomId, isSpeaking: false });
    const stoppedTile = await stopSpeakingPromise;
    assert(
      stoppedTile.isSpeaking === false,
      'Tile active speaker highlight is cleared when participant stops speaking'
    );

    // -------------------------------------------------------------------------
    // CRITERION 3: Tiles update dynamically as participants join/leave
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Criterion 3]\x1b[0m Verifying tiles update dynamically as participants join and leave...\n');

    // Student 1 joins the live session
    const student1JoinPromise = new Promise<PresenceEntry[]>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for student 1 live:joined')), 3000);
      teacherSocket.on('presence:update', (data: { roomId: string; presence: PresenceEntry[] }) => {
        const liveMembers = data.presence.filter((p) => p.inLive);
        if (liveMembers.some((p) => p.userId === student1User.id)) {
          clearTimeout(timeout);
          resolve(liveMembers);
        }
      });
    });

    student1Socket.emit('live:joined', { roomId, micOn: false, cameraOn: false });
    const twoParticipantsList = await student1JoinPromise;

    assert(
      twoParticipantsList.length >= 2,
      `Video grid updates dynamically: 2 participants now active in call (${twoParticipantsList.map((p) => p.fullName).join(', ')})`
    );

    // Student 2 connects and joins the live session
    const student2Socket = ClientSocketIO(BASE_URL, {
      auth: { token: student2Token },
      transports: ['websocket'],
    });
    socketsToClose.push(student2Socket);

    await new Promise<void>((resolve, reject) => {
      student2Socket.on('connect', () => {
        student2Socket.emit('room:join', { roomId }, (ack: any) => {
          if (ack?.ok) resolve();
          else reject(new Error('Student 2 room:join failed'));
        });
      });
    });

    const student2JoinPromise = new Promise<PresenceEntry[]>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for student 2 live:joined')), 3000);
      teacherSocket.on('presence:update', (data: { roomId: string; presence: PresenceEntry[] }) => {
        const liveMembers = data.presence.filter((p) => p.inLive);
        if (liveMembers.some((p) => p.userId === student2User.id)) {
          clearTimeout(timeout);
          resolve(liveMembers);
        }
      });
    });

    student2Socket.emit('live:joined', { roomId, micOn: false, cameraOn: true });
    const threeParticipantsList = await student2JoinPromise;

    assert(
      threeParticipantsList.length === 3,
      `Video grid updates dynamically: 3 participants now active in call (${threeParticipantsList.map((p) => p.fullName).join(', ')})`
    );

    // Student 2 leaves the live call (live:left)
    const student2LeavePromise = new Promise<{ liveCount: number; student2InLive: boolean }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for student 2 live:left')), 3000);
      teacherSocket.on('presence:update', (data: { roomId: string; presence: PresenceEntry[] }) => {
        const student2P = data.presence.find((p) => p.userId === student2User.id);
        const liveCount = data.presence.filter((p) => p.inLive).length;
        if (student2P && !student2P.inLive) {
          clearTimeout(timeout);
          resolve({ liveCount, student2InLive: student2P.inLive });
        }
      });
    });

    student2Socket.emit('live:left', { roomId });
    const leaveResult = await student2LeavePromise;

    assert(
      leaveResult.student2InLive === false,
      'Student 2 inLive set to false on live:left'
    );
    assert(
      leaveResult.liveCount === 2,
      'Video grid dynamically removes participant tile (2 tiles remaining)'
    );

    console.log('\n============================================================');
    console.log(`Summary: ${passedCount} passed, ${failedCount} failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    for (const socket of socketsToClose) {
      if (socket.connected) socket.disconnect();
    }
    clearMockRooms();
    clearPresence();
    clearTokenCache();
    testServer.close();
  }
}

runTests();
