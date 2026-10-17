import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { app } from './app';
import { env } from './config/env';
import { socketAuthMiddleware } from './realtime/socketAuth';
import { getRoomForUser, NotAMemberError, closeDanglingAttendanceRecords, getActiveSession } from './lib/rooms';
import { recordLiveJoin, recordLiveLeave, recordSocketDisconnect } from './lib/attendance';
import {
  addSocketToRoom,
  removeSocketFromRoom,
  handleSocketDisconnect,
  setUserLiveStatus,
  setUserHandStatus,
} from './realtime/presence';
import {
  getActiveScreenShare,
  startScreenShare,
  stopScreenShare,
  forceStopScreenShare,
  handleUserDisconnectScreenShare,
} from './realtime/screenShare';
import {
  getCodeState,
  getPenHolder,
  setPenHolder,
  updateCodeState,
} from './realtime/codeWorkspace';
import {
  getWhiteboardElements,
  setWhiteboardElements,
} from './realtime/whiteboard';
import { createChatMessage } from './lib/chat';

const server = http.createServer(app);


export const io = new SocketIOServer(server, {
  cors: {
    // Accept any localhost or private-network (RFC 1918) origin.
    // Matches 192.168.x.x, 10.x.x.x, 172.16-31.x.x and localhost.
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // server-to-server
      const allowed = [
        /^http:\/\/localhost:\d+$/,
        /^http:\/\/127\.0\.0\.1:\d+$/,
        /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:\d+$/,
        /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/,
        /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}:\d+$/,
      ];
      if (allowed.some((re) => re.test(origin))) {
        callback(null, true);
      } else {
        callback(new Error(`Socket.IO CORS: origin '${origin}' not allowed`));
      }
    },
    credentials: true,
  },
});

// Attach io to express app for route handlers
app.set('io', io);

// Enforce Socket.IO authentication middleware (US-AUTH-05)
io.use(socketAuthMiddleware);

io.on('connection', (socket) => {
  const user = socket.data.user;
  console.log(`[Socket] Authenticated user connected: ${user?.fullName} (${user?.id}) - Socket ID: ${socket.id}`);

  /**
   * Helper to extract roomId from either string or object payload
   */
  const extractRoomId = (payload: any): string => {
    if (typeof payload === 'string') return payload.trim();
    if (payload && typeof payload === 'object' && typeof payload.roomId === 'string') {
      return payload.roomId.trim();
    }
    // Fallback: search rooms that socket is currently in
    for (const room of socket.rooms) {
      if (room !== socket.id && !room.startsWith('room:')) {
        return room;
      }
      if (room.startsWith('room:')) {
        return room.replace('room:', '');
      }
    }
    return '';
  };

  /**
   * room:join — client requests to join a room's Socket.IO channel.
   * Membership is checked server-side. Non-members receive room:error NOT_A_MEMBER
   * and are NOT subscribed to the room channel (US-ROOM-01 AC-2, FR-2.4).
   * Presence is tracked and broadcast immediately (<1s) (US-ROOM-02, FR-2.4).
   */
  socket.on('room:join', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    if (!user?.id || !roomId) {
      const errRes = { code: 'VALIDATION', message: 'Invalid room ID' };
      socket.emit('room:error', errRes);
      if (typeof ack === 'function') ack({ ok: false, error: errRes });
      return;
    }

    try {
      const room = await getRoomForUser(user.id, roomId);
      // Membership confirmed — subscribe socket to room channels (both roomId and room:roomId)
      await socket.join(roomId);
      await socket.join(`room:${roomId}`);

      // Register presence for US-ROOM-02
      const presence = addSocketToRoom(roomId, socket.id, user);

      console.log(`[Socket] User ${user.fullName} joined room channel: ${roomId} (${presence.length} online)`);

      // Broadcast presence:update immediately to all room members
      io.to(`room:${roomId}`).to(roomId).emit('presence:update', {
        roomId,
        presence,
      });

      const activeScreen = getActiveScreenShare(roomId);
      const activeSession = await getActiveSession(roomId);

      const hostMember = room.members?.find((m) => m.memberRole === 'host');
      const defaultHostId = hostMember?.userId || room.owner_id || (room.myRole === 'host' ? user.id : null);
      const codeSnapshot = getCodeState(roomId, defaultHostId);
      const boardSnapshot = { elements: getWhiteboardElements(roomId) };

      // US-LIVE-07 AC-3: Full state snapshot returned on room:join (FR-3.8, api-contract §4.2)
      const snapshot = {
        roomId,
        room,
        me: room.members?.find((m) => m.userId === user.id) || null,
        members: room.members || [],
        presence,
        session: activeSession,
        screenShare: activeScreen,
        code: codeSnapshot,
        board: boardSnapshot,
      };


      socket.emit('room:joined', {
        roomId,
        presence,
        screenShare: activeScreen,
        session: activeSession,
        snapshot,
      });

      if (typeof ack === 'function') {
        ack({
          ok: true,
          snapshot,
          data: {
            ...snapshot,
            roomId,
            presence,
            screenShare: activeScreen,
            session: activeSession,
          },
        });
      }
    } catch (err: any) {
      if (err instanceof NotAMemberError) {
        console.warn(`[Socket] User ${user.fullName} (${user.id}) NOT_A_MEMBER for room ${roomId}`);
        const notMemberErr = { code: 'NOT_A_MEMBER', message: err.message };
        socket.emit('room:error', notMemberErr);
        if (typeof ack === 'function') ack({ ok: false, error: notMemberErr });
      } else {
        console.error(`[Socket] Error joining room ${roomId}:`, err);
        const internalErr = { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to join room' };
        socket.emit('room:error', internalErr);
        if (typeof ack === 'function') ack({ ok: false, error: internalErr });
      }
    }
  });

  socket.on('room:leave', (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    if (roomId) {
      socket.leave(roomId);
      socket.leave(`room:${roomId}`);
      const presence = removeSocketFromRoom(roomId, socket.id);
      console.log(`[Socket] User ${user?.fullName} left room channel: ${roomId} (${presence.length} online)`);

      io.to(`room:${roomId}`).to(roomId).emit('presence:update', {
        roomId,
        presence,
      });

      if (typeof ack === 'function') ack({ ok: true });
    }
  });

  /**
   * live:joined — user enters the live call (US-ROOM-02 AC-3, US-LIVE-07 AC-4)
   */
  socket.on('live:joined', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    if (roomId && user?.id) {
      const presence = setUserLiveStatus(roomId, user.id, true);
      await recordLiveJoin(roomId, user.id, socket.id);

      if (presence) {
        io.to(`room:${roomId}`).to(roomId).emit('presence:update', {
          roomId,
          presence,
        });
      }
      if (typeof ack === 'function') ack({ ok: true });
    }
  });

  /**
   * live:left — user leaves the live call (US-ROOM-02 AC-3, US-LIVE-07 AC-4)
   */
  socket.on('live:left', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    if (roomId && user?.id) {
      const presence = setUserLiveStatus(roomId, user.id, false);
      await recordLiveLeave(roomId, user.id, socket.id);

      if (presence) {
        io.to(`room:${roomId}`).to(roomId).emit('presence:update', {
          roomId,
          presence,
        });
      }

      // If user was sharing screen, stop sharing
      const stopped = stopScreenShare(roomId, user.id);
      if (stopped) {
        io.to(`room:${roomId}`).to(roomId).emit('screen:stopped', {
          roomId,
          userId: user.id,
          reason: 'USER_STOPPED',
        });
      }

      if (typeof ack === 'function') ack({ ok: true });
    }
  });

  /**
   * screen:start — user requests to share their screen (US-LIVE-04, FR-3.5)
   * Acceptance Criteria:
   * 1. Enabled only if can_screen = true (or user is the host).
   * 2. Screen share appears as focused tile for all participants; other tiles move to a strip below.
   * 3. Only one screen share is active at a time.
   */
  socket.on('screen:start', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    if (!roomId || !user?.id) {
      const err = { code: 'VALIDATION', message: 'Room ID required' };
      socket.emit('screen:error', err);
      if (typeof ack === 'function') ack({ ok: false, error: err });
      return;
    }

    try {
      const room = await getRoomForUser(user.id, roomId);
      const isHost = room.myRole === 'host';
      const member = room.members?.find((m) => m.userId === user.id);
      const canScreen = isHost || Boolean(member?.permissions?.canScreen);

      // Criterion 1: Enabled only if can_screen = true (or user is host)
      if (!canScreen) {
        const forbiddenErr = {
          code: 'FORBIDDEN',
          message: 'Screen sharing permission required. Ask the room host for access.',
        };
        socket.emit('screen:error', forbiddenErr);
        if (typeof ack === 'function') ack({ ok: false, error: forbiddenErr });
        return;
      }

      // Criterion 3: Only one screen share is active at a time
      const result = startScreenShare(roomId, user.id, user.fullName || 'Participant');
      if (!result.success) {
        const activeErr = {
          code: 'SCREEN_SHARE_ACTIVE',
          message: 'Only one screen share is active at a time. Another participant is currently sharing.',
        };
        socket.emit('screen:error', activeErr);
        if (typeof ack === 'function') ack({ ok: false, error: activeErr });
        return;
      }

      console.log(`[Socket] Screen share started by ${user.fullName} in room ${roomId}`);

      // Criterion 2: Screen share appears as the focused tile for all participants
      io.to(`room:${roomId}`).to(roomId).emit('screen:started', {
        roomId,
        userId: user.id,
        userName: user.fullName,
      });

      if (typeof ack === 'function') {
        ack({ ok: true, data: result.screenShare });
      }
    } catch (err: any) {
      console.error(`[Socket] Error starting screen share in room ${roomId}:`, err);
      const serverErr = { code: 'INTERNAL_SERVER_ERROR', message: err.message || 'Failed to start screen share' };
      socket.emit('screen:error', serverErr);
      if (typeof ack === 'function') ack({ ok: false, error: serverErr });
    }
  });

  /**
   * screen:stop — user or host stops active screen share (US-LIVE-04, FR-3.5)
   */
  socket.on('screen:stop', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    if (!roomId || !user?.id) {
      if (typeof ack === 'function') ack({ ok: false, error: { code: 'VALIDATION' } });
      return;
    }

    try {
      const room = await getRoomForUser(user.id, roomId);
      const isHost = room.myRole === 'host';
      const stopped = isHost ? forceStopScreenShare(roomId) : stopScreenShare(roomId, user.id);

      if (stopped) {
        console.log(`[Socket] Screen share stopped in room ${roomId}`);
        io.to(`room:${roomId}`).to(roomId).emit('screen:stopped', {
          roomId,
          userId: stopped.userId,
          reason: 'USER_STOPPED',
        });
      }

      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    } catch (err: any) {
      console.warn(`[Socket] Error stopping screen share in room ${roomId}:`, err);
      if (typeof ack === 'function') ack({ ok: true });
    }
  });

  /**
   * hand:raise — raise or lower hand in live session (US-PERM-07, FR-4.8)
   */
  socket.on('hand:raise', (payload: any) => {
    const roomId = extractRoomId(payload);
    const raised = Boolean(payload?.raised);
    const targetUserId =
      payload?.userId && (payload?.asHost || user?.role === 'teacher' || socket.data.isHost)
        ? String(payload.userId)
        : user?.id;

    if (roomId && targetUserId) {
      let presence = setUserHandStatus(roomId, targetUserId, raised);
      if (!presence && targetUserId === user?.id && user) {
        addSocketToRoom(roomId, socket.id, user);
        presence = setUserHandStatus(roomId, targetUserId, raised);
      }
      if (presence) {
        io.to(`room:${roomId}`).to(roomId).emit('presence:update', {
          roomId,
          presence,
        });
      }
      io.to(`room:${roomId}`).to(roomId).emit('hand:changed', {
        roomId,
        userId: targetUserId,
        raised,
      });
    }
  });

  /**
   * chat:send — send a new chat message in a room (US-CHAT-01, US-CHAT-02, FR-3.11)
   */
  socket.on('chat:send', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    const body = typeof payload?.body === 'string' ? payload.body : '';
    const clientId = typeof payload?.clientId === 'string' ? payload.clientId : undefined;

    if (!roomId || !user?.id) {
      const err = { code: 'VALIDATION', message: 'Room ID required' };
      socket.emit('chat:error', err);
      if (typeof ack === 'function') ack({ ok: false, error: err });
      return;
    }

    try {
      const message = await createChatMessage(user.id, roomId, body);
      const broadcastPayload = clientId ? { ...message, clientId } : message;
      // Broadcast to room channel (both room:roomId and roomId)
      io.to(`room:${roomId}`).to(roomId).emit('chat:new', broadcastPayload);
      io.to(`room:${roomId}`).to(roomId).emit('chat:new message', broadcastPayload);

      if (typeof ack === 'function') {
        ack({ ok: true, data: broadcastPayload });
      }
    } catch (err: any) {
      console.warn(`[Socket] Error sending chat message in room ${roomId}:`, err.message || err);
      const code = err.code || (err instanceof NotAMemberError ? 'NOT_A_MEMBER' : 'INTERNAL_SERVER_ERROR');
      const errorPayload = { code, message: err.message || 'Failed to send message' };
      socket.emit('chat:error', errorPayload);
      if (typeof ack === 'function') {
        ack({ ok: false, error: errorPayload });
      }
    }
  });

  /**
   * wb:update — update whiteboard canvas elements (US-PERM-05 AC-2, FR-4.6, BR-5, api-contract §4.2)
   * Acceptance Criteria:
   * "A socket wb:update event from a student without can_whiteboard:
   * the server drops the event and emits error { code: "FORBIDDEN" } back to the sender;
   * no other clients receive the update."
   */
  socket.on('wb:update', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    const elements = payload?.elements;

    if (!roomId || !user?.id || !Array.isArray(elements)) {
      const err = { code: 'VALIDATION', message: 'Room ID and elements array required' };
      socket.emit('error', err);
      if (typeof ack === 'function') ack({ ok: false, error: err });
      return;
    }

    try {
      const room = await getRoomForUser(user.id, roomId);
      const isHost = room.myRole === 'host';
      const member = room.members?.find((m) => m.userId === user.id);
      const canWhiteboard = isHost || Boolean(member?.permissions?.canWhiteboard);

      if (!canWhiteboard) {
        console.warn(`[Socket] wb:update dropped: user ${user.id} lacks can_whiteboard in room ${roomId}`);
        const forbiddenErr = {
          code: 'FORBIDDEN',
          message: 'Whiteboard edit permission required. Ask the room host for access.',
          event: 'wb:update',
        };
        // Server drops event and emits error { code: "FORBIDDEN" } back to sender ONLY
        socket.emit('error', forbiddenErr);
        if (typeof ack === 'function') ack({ ok: false, error: forbiddenErr });
        return;
      }

      // Permitted: store elements and broadcast to room except sender
      setWhiteboardElements(roomId, elements);
      socket.to(roomId).to(`room:${roomId}`).emit('wb:update', {
        roomId,
        elements,
        by: user.id,
      });

      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    } catch (err: any) {
      console.warn(`[Socket] Error in wb:update for room ${roomId}:`, err);
      const errPayload = { code: 'FORBIDDEN', message: err.message || 'Access denied', event: 'wb:update' };
      socket.emit('error', errPayload);
      if (typeof ack === 'function') ack({ ok: false, error: errPayload });
    }
  });

  /**
   * code:update — update shared code editor content (US-PERM-05 AC-3, FR-4.6, BR-5, api-contract §4.2)
   * Acceptance Criteria:
   * "A socket code:update event from a user who is not the current pen holder:
   * server drops it with error { code: "NOT_PEN_HOLDER" }."
   */
  socket.on('code:update', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    const content = typeof payload?.content === 'string' ? payload.content : '';
    const language = typeof payload?.language === 'string' ? payload.language : undefined;

    if (!roomId || !user?.id) {
      const err = { code: 'VALIDATION', message: 'Room ID required' };
      socket.emit('error', err);
      if (typeof ack === 'function') ack({ ok: false, error: err });
      return;
    }

    try {
      const room = await getRoomForUser(user.id, roomId);
      const hostMember = room.members?.find((m) => m.memberRole === 'host');
      const defaultHostId = hostMember?.userId || room.owner_id || (room.myRole === 'host' ? user.id : '');
      const currentHolderId = getPenHolder(roomId, defaultHostId);

      if (currentHolderId !== user.id) {
        console.warn(`[Socket] code:update dropped: user ${user.id} is not pen holder (${currentHolderId}) in room ${roomId}`);
        const notHolderErr = {
          code: 'NOT_PEN_HOLDER',
          message: 'Only the current pen holder can edit code',
          event: 'code:update',
        };
        // Server drops it with error { code: "NOT_PEN_HOLDER" } to sender ONLY
        socket.emit('error', notHolderErr);
        if (typeof ack === 'function') ack({ ok: false, error: notHolderErr });
        return;
      }

      // Permitted: update code state and broadcast to room except sender
      const updatedState = updateCodeState(roomId, content, language as any, user.id);
      socket.to(roomId).to(`room:${roomId}`).emit('code:state', {
        roomId,
        content: updatedState.content,
        language: updatedState.language,
        rev: updatedState.rev,
        holderId: updatedState.holderId,
      });

      if (typeof ack === 'function') {
        ack({ ok: true, data: { rev: updatedState.rev } });
      }
    } catch (err: any) {
      console.warn(`[Socket] Error in code:update for room ${roomId}:`, err);
      const errPayload = { code: 'FORBIDDEN', message: err.message || 'Access denied', event: 'code:update' };
      socket.emit('error', errPayload);
      if (typeof ack === 'function') ack({ ok: false, error: errPayload });
    }
  });

  /**
   * code:pen — assign code editor pen holder (US-PERM-05, architecture doc §5.5)
   */
  socket.on('code:pen', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    const targetHolderId = typeof payload?.holderId === 'string' ? payload.holderId.trim() : '';

    if (!roomId || !user?.id || !targetHolderId) {
      const err = { code: 'VALIDATION', message: 'Room ID and holderId required' };
      socket.emit('error', err);
      if (typeof ack === 'function') ack({ ok: false, error: err });
      return;
    }

    try {
      const room = await getRoomForUser(user.id, roomId);
      const isHost = room.myRole === 'host';

      if (!isHost) {
        const err = { code: 'HOST_ONLY', message: 'Only the room host can assign the pen' };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, error: err });
        return;
      }

      const targetMember = room.members?.find((m) => m.userId === targetHolderId);
      if (!targetMember) {
        const err = { code: 'NOT_FOUND', message: 'Target member not found in room' };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, error: err });
        return;
      }

      const canCode = targetMember.memberRole === 'host' || Boolean(targetMember.permissions?.canCode);
      if (!canCode) {
        const err = { code: 'FORBIDDEN', message: 'Target member does not have code permission' };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, error: err });
        return;
      }

      setPenHolder(roomId, targetHolderId);

      io.to(`room:${roomId}`).to(roomId).emit('code:pen', {
        roomId,
        holderId: targetHolderId,
        by: user.id,
      });

      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    } catch (err: any) {
      console.warn(`[Socket] Error in code:pen for room ${roomId}:`, err);
      const errPayload = { code: 'INTERNAL_SERVER_ERROR', message: err.message || 'Failed to assign pen' };
      socket.emit('error', errPayload);
      if (typeof ack === 'function') ack({ ok: false, error: errPayload });
    }
  });

  socket.on('disconnect', async (reason) => {

    console.log(`[Socket] User disconnected: ${user?.fullName} (${user?.id}) - Reason: ${reason}`);
    await recordSocketDisconnect(socket.id);

    const affectedRooms = handleSocketDisconnect(socket.id);
    for (const { roomId, presence } of affectedRooms) {
      io.to(`room:${roomId}`).to(roomId).emit('presence:update', {
        roomId,
        presence,
      });
    }

    if (user?.id) {
      const stoppedShares = handleUserDisconnectScreenShare(user.id);
      for (const { roomId } of stoppedShares) {
        io.to(`room:${roomId}`).to(roomId).emit('screen:stopped', {
          roomId,
          userId: user.id,
          reason: 'DISCONNECTED',
        });
      }
    }
  });
});

const isDirectExecution =
  process.argv[1] &&
  (/src[\\/]index\.ts$/.test(process.argv[1]) || /dist[\\/]index\.js$/.test(process.argv[1]));

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[Server] Port ${env.PORT} already in use; skipping direct server.listen`);
  } else {
    throw err;
  }
});

if (isDirectExecution && process.env.NODE_ENV !== 'test') {
  server.listen(env.PORT, () => {
    console.log(`[Server] LinkUp API server running on port ${env.PORT}`);
    console.log(`[Server] Health check available at http://localhost:${env.PORT}/health`);
    console.log(`[Server] Protected API routes mounted at http://localhost:${env.PORT}/api/*`);
    closeDanglingAttendanceRecords().catch(() => {});
  });
}

export { server };
