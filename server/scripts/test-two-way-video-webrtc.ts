/**
 * Verification Script for Two-Way WebRTC Video Calling
 *
 * Verifies:
 * 1. Teacher and student authenticate and join the room.
 * 2. Both users join the live call (live:joined).
 * 3. Both users update their camera status (live:media-state with cameraOn: true).
 * 4. WebRTC SDP offer is relayed from initiator to target peer (with streamType: 'video').
 * 5. WebRTC SDP answer is relayed back to initiator (with streamType: 'video').
 * 6. Bidirectional ICE candidates are relayed between teacher and student.
 * 7. Screen share webrtc offers (streamType: 'screen') are not confused with video offers.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/index';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { setMockRooms, clearMockRooms } from '../src/lib/rooms';
import { clearMockSessions } from '../src/lib/sessions';
import { clearPresence } from '../src/realtime/presence';
import { Me, RoomSummary } from '@linkup/shared';

const TEST_PORT = 3145;
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
  console.log('🚀 Running Two-Way WebRTC Video Calling Verification Tests');
  console.log('============================================================\n');

  const testServer = http.createServer(app);
  io.attach(testServer);

  await new Promise<void>((resolve) => {
    testServer.listen(TEST_PORT, () => {
      console.log(`[Test Server] Listening on port ${TEST_PORT}\n`);
      resolve();
    });
  });

  let teacherSocket: ClientSocketType | null = null;
  let studentSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearMockSessions();
    clearPresence();

    const teacherToken = 'test_teacher_video_token';
    const studentToken = 'test_student_video_token';

    const teacherUser: Me = {
      id: 'teacher-user-video-01',
      email: 'teacher@linkup.test',
      fullName: 'Prof. Richard Feynman',
      role: 'teacher',
    };

    const studentUser: Me = {
      id: 'student-user-video-01',
      email: 'student@linkup.test',
      fullName: 'Niels Bohr',
      role: 'student',
    };

    setCachedUser(teacherToken, teacherUser, 60000);
    setCachedUser(studentToken, studentUser, 60000);

    const roomId = 'room-test-two-way-video';

    const roomMembers = [
      {
        userId: teacherUser.id,
        fullName: teacherUser.fullName,
        userRole: teacherUser.role,
        memberRole: 'host' as const,
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
      {
        userId: studentUser.id,
        fullName: studentUser.fullName,
        userRole: studentUser.role,
        memberRole: 'participant' as const,
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
    ];

    const hostRoom: RoomSummary = {
      id: roomId,
      name: 'Quantum Physics Lecture',
      description: 'Two-way video conference',
      joinCode: 'PHYS01',
      hostName: teacherUser.fullName,
      memberCount: 2,
      myRole: 'host',
      activeSessionId: 'session-video-01',
      createdAt: new Date().toISOString(),
      members: roomMembers,
    };

    const studentRoom: RoomSummary = {
      ...hostRoom,
      myRole: 'participant',
    };

    setMockRooms(teacherUser.id, [hostRoom]);
    setMockRooms(studentUser.id, [studentRoom]);

    // Connect teacher and student sockets
    teacherSocket = ClientSocket(BASE_URL, {
      auth: { token: teacherToken },
      transports: ['websocket'],
    });

    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) => teacherSocket!.on('connect', () => resolve())),
      new Promise<void>((resolve) => studentSocket!.on('connect', () => resolve())),
    ]);

    // Join room channel
    await Promise.all([
      new Promise<void>((resolve) => teacherSocket!.emit('room:join', roomId, () => resolve())),
      new Promise<void>((resolve) => studentSocket!.emit('room:join', roomId, () => resolve())),
    ]);

    console.log('[Test 1] Both users join live call and turn on cameras...\n');

    let teacherPresence: any[] = [];
    teacherSocket.on('presence:update', (data) => {
      if (data.roomId === roomId) {
        teacherPresence = data.presence;
      }
    });

    teacherSocket.emit('live:joined', { roomId });
    studentSocket.emit('live:joined', { roomId });

    teacherSocket.emit('live:media-state', { roomId, cameraOn: true, micOn: true });
    studentSocket.emit('live:media-state', { roomId, cameraOn: true, micOn: true });

    await new Promise((r) => setTimeout(r, 200));

    assert(teacherPresence.length === 2, 'Both participants present in room presence list');
    const teacherInPresence = teacherPresence.find((p) => p.userId === teacherUser.id);
    const studentInPresence = teacherPresence.find((p) => p.userId === studentUser.id);

    assert(Boolean(teacherInPresence?.inLive && teacherInPresence?.cameraOn), 'Teacher is marked inLive with cameraOn = true');
    assert(Boolean(studentInPresence?.inLive && studentInPresence?.cameraOn), 'Student is marked inLive with cameraOn = true');

    console.log('\n[Test 2] WebRTC Offer relay from teacher (initiator) to student...\n');

    const dummyOfferSdp = { type: 'offer' as const, sdp: 'v=0\r\no=teacher 1234 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' };

    const offerReceivedPromise = new Promise<any>((resolve) => {
      studentSocket!.on('webrtc:offer', (data) => {
        resolve(data);
      });
    });

    teacherSocket.emit('webrtc:offer', {
      roomId,
      targetUserId: studentUser.id,
      sdp: dummyOfferSdp,
      streamType: 'video',
    });

    const receivedOffer = await offerReceivedPromise;
    assert(receivedOffer.roomId === roomId, 'Student received offer with matching roomId');
    assert(receivedOffer.fromUserId === teacherUser.id, 'Offer correctly identifies teacher as sender');
    assert(receivedOffer.streamType === 'video', 'Offer specifies streamType="video"');
    assert(receivedOffer.sdp.type === 'offer', 'Offer payload contains SDP offer');

    console.log('\n[Test 3] WebRTC Answer relay from student to teacher...\n');

    const dummyAnswerSdp = { type: 'answer' as const, sdp: 'v=0\r\no=student 5678 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' };

    const answerReceivedPromise = new Promise<any>((resolve) => {
      teacherSocket!.on('webrtc:answer', (data) => {
        resolve(data);
      });
    });

    studentSocket.emit('webrtc:answer', {
      roomId,
      targetUserId: teacherUser.id,
      targetSocketId: receivedOffer.fromSocketId,
      sdp: dummyAnswerSdp,
      streamType: 'video',
    });

    const receivedAnswer = await answerReceivedPromise;
    assert(receivedAnswer.roomId === roomId, 'Teacher received answer with matching roomId');
    assert(receivedAnswer.fromUserId === studentUser.id, 'Answer correctly identifies student as sender');
    assert(receivedAnswer.streamType === 'video', 'Answer specifies streamType="video"');
    assert(receivedAnswer.sdp.type === 'answer', 'Answer payload contains SDP answer');

    console.log('\n[Test 4] Bidirectional ICE Candidate exchange...\n');

    const studentCandidate = { candidate: 'candidate:1 1 UDP 2122260223 192.168.1.100 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
    const teacherCandidate = { candidate: 'candidate:2 1 UDP 2122260223 192.168.1.101 50001 typ host', sdpMid: '0', sdpMLineIndex: 0 };

    const teacherIcePromise = new Promise<any>((resolve) => {
      teacherSocket!.on('webrtc:ice-candidate', (data) => resolve(data));
    });
    const studentIcePromise = new Promise<any>((resolve) => {
      studentSocket!.on('webrtc:ice-candidate', (data) => resolve(data));
    });

    studentSocket.emit('webrtc:ice-candidate', {
      roomId,
      targetUserId: teacherUser.id,
      candidate: studentCandidate,
      streamType: 'video',
    });

    teacherSocket.emit('webrtc:ice-candidate', {
      roomId,
      targetUserId: studentUser.id,
      candidate: teacherCandidate,
      streamType: 'video',
    });

    const [teacherReceivedIce, studentReceivedIce] = await Promise.all([
      teacherIcePromise,
      studentIcePromise,
    ]);

    assert(teacherReceivedIce.candidate.candidate.includes('192.168.1.100'), 'Teacher received student ICE candidate');
    assert(studentReceivedIce.candidate.candidate.includes('192.168.1.101'), 'Student received teacher ICE candidate');
    assert(teacherReceivedIce.streamType === 'video', 'Teacher candidate has streamType="video"');
    assert(studentReceivedIce.streamType === 'video', 'Student candidate has streamType="video"');

    console.log('\n[Test 5] Video and Screen Share isolation...\n');

    // A screen share offer (streamType: 'screen' with no targetUserId) should be routed to room:host
    let hostReceivedScreenOffer = false;
    teacherSocket.on('webrtc:offer', (data) => {
      if (data.streamType === 'screen') {
        hostReceivedScreenOffer = true;
      }
    });

    studentSocket.emit('webrtc:offer', {
      roomId,
      sdp: { type: 'offer', sdp: 'screen-offer' },
      streamType: 'screen',
    });

    await new Promise((r) => setTimeout(r, 200));
    assert(hostReceivedScreenOffer, 'Host received screen share offer separately on room:host channel');

  } catch (err) {
    console.error('Test execution failed with error:', err);
    failedCount++;
  } finally {
    if (teacherSocket?.connected) teacherSocket.disconnect();
    if (studentSocket?.connected) studentSocket.disconnect();

    testServer.close();
  }

  console.log('\n============================================================');
  console.log(`Summary: ${passedCount} passed, ${failedCount} failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
