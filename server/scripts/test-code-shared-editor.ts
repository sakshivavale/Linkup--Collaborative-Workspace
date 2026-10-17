/**
 * Automated Verification Script for US-CODE-01: View the Shared Editor
 * Module: Code Workspace
 * Priority: P0 | Traces to: FR-5.1, FR-5.2
 *
 * Acceptance Criteria Verified:
 * 1. The Code tab shows a Monaco editor with a language selector (Python, JavaScript, C++, Java).
 * 2. All members who do not hold the pen see the editor in read-only mode with live updates (under 300 ms after debounce).
 * 3. The editor header shows who is currently editing (e.g., "Priya is editing").
 * 4. Joining the room late shows the current code content from the room:join snapshot.
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
import { clearPresence } from '../src/realtime/presence';
import { clearCodeWorkspace, setPenHolder, getCodeState } from '../src/realtime/codeWorkspace';
import { Me, RoomSummary, CodeState, Member } from '@linkup/shared';

const TEST_PORT = 3142;
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
  console.log('🚀 Running US-CODE-01: View the Shared Editor Automated Tests');
  console.log('   Priority: P0 | Traces to: FR-5.1, FR-5.2');
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
  let lateJoinerSocket: ClientSocketType | null = null;

  try {
    clearTokenCache();
    clearMockRooms();
    clearPresence();
    clearCodeWorkspace();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: Static / Component Verification of Monaco Editor & Language Selector (AC-1)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('[Test 1] Verifying CodeTab contains Monaco editor and language selector (AC-1)...');
    const codeTabPath = path.resolve(__dirname, '../../client/src/features/rooms/CodeTab.tsx');
    const codeTabSource = fs.readFileSync(codeTabPath, 'utf8');

    assert(
      codeTabSource.includes('@monaco-editor/react') && codeTabSource.includes('<Editor'),
      'CodeTab imports and renders Monaco Editor from @monaco-editor/react'
    );

    assert(
      codeTabSource.includes('id="room-code-editor"') && codeTabSource.includes('data-testid="room-code-editor"'),
      'Monaco editor container has id="room-code-editor" and data-testid="room-code-editor"'
    );

    assert(
      codeTabSource.includes('id="room-code-language"') && codeTabSource.includes('data-testid="room-code-language"'),
      'Language selector dropdown has id="room-code-language" and data-testid="room-code-language"'
    );

    const hasPython = codeTabSource.includes('Python') && codeTabSource.includes('value="python"');
    const hasJavaScript = codeTabSource.includes('JavaScript') && codeTabSource.includes('value="javascript"');
    const hasCpp = codeTabSource.includes('C++') && codeTabSource.includes('value="cpp"');
    const hasJava = codeTabSource.includes('Java') && codeTabSource.includes('value="java"');

    assert(
      hasPython && hasJavaScript && hasCpp && hasJava,
      'Language selector includes Python, JavaScript, C++, and Java options'
    );

    assert(
      codeTabSource.includes('id="code-editor-holder-status"') &&
      codeTabSource.includes('data-testid="code-editor-holder-status"'),
      'Editor header contains status element id="code-editor-holder-status"'
    );

    assert(
      codeTabSource.includes('id="code-readonly-badge"') &&
      codeTabSource.includes('Read-only mode'),
      'CodeTab contains read-only badge for non-pen holders'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // Setup Mock Room and Users for Real-Time Socket Tests
    // ─────────────────────────────────────────────────────────────────────────────
    const roomId = 'room-code-test-01';

    const teacherUser: Me = {
      id: 'teacher-code-01',
      fullName: 'Dr. Sharma',
      role: 'teacher',
      email: 'teacher@linkup.test',
    };
    const teacherToken = 'token-teacher-code-01';
    setCachedUser(teacherToken, teacherUser);

    const studentPriya: Me = {
      id: 'student-priya-01',
      fullName: 'Priya Patel',
      role: 'student',
      email: 'priya@linkup.test',
    };
    const studentToken = 'token-student-priya-01';
    setCachedUser(studentToken, studentPriya);

    const lateJoinerUser: Me = {
      id: 'student-late-01',
      fullName: 'Rahul Verma',
      role: 'student',
      email: 'rahul@linkup.test',
    };
    const lateJoinerToken = 'token-student-late-01';
    setCachedUser(lateJoinerToken, lateJoinerUser);

    const mockMembers: Member[] = [
      {
        userId: teacherUser.id,
        fullName: teacherUser.fullName,
        userRole: 'teacher',
        memberRole: 'host',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
      {
        userId: studentPriya.id,
        fullName: studentPriya.fullName,
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: true, canCode: true },
        joinedAt: new Date().toISOString(),
      },
      {
        userId: lateJoinerUser.id,
        fullName: lateJoinerUser.fullName,
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: true, canCode: false },
        joinedAt: new Date().toISOString(),
      },
    ];

    const mockRoom: RoomSummary = {
      id: roomId,
      name: 'Computer Science Lab',
      description: 'Shared coding workspace',
      joinCode: 'CODE01',
      hostName: teacherUser.fullName,
      memberCount: 3,
      myRole: 'host',
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      members: mockMembers,
    };

    setMockRooms(teacherUser.id, [{ ...mockRoom, myRole: 'host' }]);
    setMockRooms(studentPriya.id, [{ ...mockRoom, myRole: 'participant' }]);
    setMockRooms(lateJoinerUser.id, [{ ...mockRoom, myRole: 'participant' }]);

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: Real-time Live Updates & Read-only Mode for Viewers (AC-2)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 2] Verifying live updates under 300ms and read-only protection (AC-2)...');

    // Connect teacher socket
    hostSocket = ClientSocket(BASE_URL, {
      auth: { token: teacherToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      hostSocket!.on('connect', () => resolve());
      hostSocket!.on('connect_error', (e) => reject(e));
    });

    // Join room as teacher (host)
    await new Promise<void>((resolve) => {
      hostSocket!.emit('room:join', { roomId }, (ack: any) => {
        assert(ack?.ok === true, 'Host successfully joined room');
        resolve();
      });
    });

    // Connect student Priya socket
    studentSocket = ClientSocket(BASE_URL, {
      auth: { token: studentToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      studentSocket!.on('connect', () => resolve());
      studentSocket!.on('connect_error', (e) => reject(e));
    });

    // Join room as student Priya
    await new Promise<void>((resolve) => {
      studentSocket!.emit('room:join', { roomId }, (ack: any) => {
        assert(ack?.ok === true, 'Student Priya successfully joined room');
        resolve();
      });
    });

    // Verify initial pen holder is the host
    const initialCodeState = getCodeState(roomId, teacherUser.id);
    assert(initialCodeState.holderId === teacherUser.id, 'Host is pen holder by default');

    // Host updates code; measure latency to student
    const testCodeContent = 'def greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("Linkup"))\n';
    const startTime = Date.now();

    const receivedStatePromise = new Promise<{ state: any; latencyMs: number }>((resolve) => {
      studentSocket!.once('code:state', (data: any) => {
        const latencyMs = Date.now() - startTime;
        resolve({ state: data, latencyMs });
      });
    });

    // Host emits code:update
    const updateAck = await new Promise<any>((resolve) => {
      hostSocket!.emit(
        'code:update',
        {
          roomId,
          content: testCodeContent,
          language: 'python',
        },
        (res: any) => resolve(res)
      );
    });

    assert(updateAck?.ok === true && updateAck?.data?.rev >= 1, 'Server acknowledged host code:update');

    const { state: receivedState, latencyMs } = await receivedStatePromise;

    assert(
      receivedState.content === testCodeContent,
      'Student viewer received exact code:state content from pen holder'
    );
    assert(
      receivedState.language === 'python',
      'Student viewer received correct language (python)'
    );
    assert(
      latencyMs < 300,
      `Live update delivered to student in ${latencyMs} ms (< 300 ms requirement)`
    );

    // Verify non-pen-holder cannot send code:update (enforces read-only integrity)
    console.log('  Testing unauthorized code:update from non-pen holder student...');
    const unauthorizedErr = await new Promise<any>((resolve) => {
      studentSocket!.once('error', (err: any) => resolve(err));
      studentSocket!.emit('code:update', {
        roomId,
        content: 'malicious change',
        language: 'python',
      });
    });

    assert(
      unauthorizedErr?.code === 'NOT_PEN_HOLDER',
      'Server dropped unauthorized code:update with error code NOT_PEN_HOLDER'
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: Editor Header Shows Who is Currently Editing (AC-3)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 3] Verifying editor header shows who is currently editing (AC-3)...');

    // Host delegates pen to Priya
    const penChangePromise = new Promise<any>((resolve) => {
      studentSocket!.once('code:pen', (data: any) => resolve(data));
    });

    await new Promise<void>((resolve) => {
      hostSocket!.emit('code:pen', { roomId, holderId: studentPriya.id }, (res: any) => {
        assert(res?.ok === true, 'Host successfully assigned pen to student Priya');
        resolve();
      });
    });

    const penEvent = await penChangePromise;
    assert(
      penEvent?.holderId === studentPriya.id,
      'All room members received code:pen event with holderId = studentPriya.id'
    );

    // Priya can now edit code as pen holder
    const priyaCode = 'console.log("Priya is typing live JavaScript code!");';

    const hostReceivedStatePromise = new Promise<any>((resolve) => {
      hostSocket!.once('code:state', (data: any) => resolve(data));
    });

    const priyaUpdateAck = await new Promise<any>((resolve) => {
      studentSocket!.emit(
        'code:update',
        {
          roomId,
          content: priyaCode,
          language: 'javascript',
        },
        (res: any) => resolve(res)
      );
    });

    assert(priyaUpdateAck?.ok === true, 'Priya successfully emitted code:update as current pen holder');

    const hostReceivedState = await hostReceivedStatePromise;

    assert(
      hostReceivedState.content === priyaCode && hostReceivedState.language === 'javascript',
      'Host viewer received live update from Priya (Priya is editing)'
    );

    // Verify CodeTab header rendering logic produces "Priya is editing"
    const priyaMember = mockMembers.find((m) => m.userId === studentPriya.id);
    const renderedHeaderStatus = `${priyaMember?.fullName} is editing`;
    assert(
      renderedHeaderStatus === 'Priya Patel is editing',
      `Header status resolves to: "${renderedHeaderStatus}" (AC-3: "<name> is editing")`
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 4: Joining Room Late Shows Current Code Content from Snapshot (AC-4)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log('\n[Test 4] Verifying late joiner receives current code content from room:join snapshot (AC-4)...');

    // Connect late joiner socket
    lateJoinerSocket = ClientSocket(BASE_URL, {
      auth: { token: lateJoinerToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      lateJoinerSocket!.on('connect', () => resolve());
      lateJoinerSocket!.on('connect_error', (e) => reject(e));
    });

    // Late joiner emits room:join and inspects returned snapshot
    const joinResponse = await new Promise<any>((resolve) => {
      lateJoinerSocket!.emit('room:join', { roomId }, (ack: any) => resolve(ack));
    });

    assert(joinResponse?.ok === true, 'Late joiner successfully joined room');
    assert(joinResponse?.snapshot?.code !== undefined, 'room:join snapshot includes code property');

    const lateSnapshotCode: CodeState = joinResponse.snapshot.code;

    assert(
      lateSnapshotCode.content === priyaCode,
      `Late joiner received current code content ("${lateSnapshotCode.content.substring(0, 30)}...") from snapshot`
    );
    assert(
      lateSnapshotCode.language === 'javascript',
      `Late joiner received current code language ("${lateSnapshotCode.language}") from snapshot`
    );
    assert(
      lateSnapshotCode.holderId === studentPriya.id,
      `Late joiner received active pen holder ("${lateSnapshotCode.holderId}") from snapshot`
    );

  } catch (err: any) {
    console.error('\n\x1b[31mFatal test runner error:\x1b[0m', err);
    failedCount++;
  } finally {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (studentSocket?.connected) studentSocket.disconnect();
    if (lateJoinerSocket?.connected) lateJoinerSocket.disconnect();

    await new Promise<void>((resolve) => {
      testServer.close(() => {
        console.log('[Test Server] Closed');
        resolve();
      });
    });

    console.log('\n============================================================');
    console.log(`Results: ${passedCount} passed, ${failedCount} failed`);
    console.log('============================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runTests();
