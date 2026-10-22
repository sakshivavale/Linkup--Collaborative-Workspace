import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { app } from './app';
import { env } from './config/env';
import { socketAuthMiddleware } from './realtime/socketAuth';
import { getRoomForUser, NotAMemberError, closeDanglingAttendanceRecords, getActiveSession } from './lib/rooms';
import { recordLiveJoin, recordLiveLeave, recordSocketDisconnect } from './lib/attendance';
import type { Member } from '@linkup/shared';
import {
  addSocketToRoom,
  removeSocketFromRoom,
  handleSocketDisconnect,
  setUserLiveStatus,
  setUserHandStatus,
  setUserMediaStatus,
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
  getOrLoadCodeState,
  getPenHolder,
  setPenHolder,
  addPenRequest,
  removePenRequest,
  codeService,
  updateCodeState,
  validateCodeSize,
  persistCodeState,
  flushAllCodeState,
} from './realtime/codeWorkspace';
import {
  getWhiteboardElements,
  setWhiteboardElements,
  mergeWhiteboardElements,
  getOrLoadWhiteboardState,
  persistWhiteboardState,
  clearAndPersistWhiteboard,
  checkAndPersistWhiteboardOnLeave,
  flushAllWhiteboardState,
} from './realtime/whiteboard';
import { createChatMessage } from './lib/chat';

const server = http.createServer(app);


export const io = new SocketIOServer(server, {
  cors: {
    // Accept env.CORS_ORIGIN (production Render URL), any localhost, or private-network (RFC 1918) origin.
    // Matches 192.168.x.x, 10.x.x.x, 172.16-31.x.x and localhost.
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // server-to-server
      // Allow production frontend URL from env (Render deployment)
      if ((env.CORS_ORIGIN && origin === env.CORS_ORIGIN) || (process.env.CORS_ORIGIN && origin === process.env.CORS_ORIGIN)) {
        return callback(null, true);
      }
      const allowed = [
        /^https?:\/\/localhost(:\d+)?$/,
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
        /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
        /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
        /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
        /^https:\/\/.*\.onrender\.com$/,
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
  if (user?.id) {
    socket.join(`user:${user.id}`);
  }

  /**
   * Helper to extract roomId from either string or object payload
   */
  const extractRoomId = (payload: any): string => {
    if (typeof payload === 'string') return payload.trim();
    if (payload && typeof payload === 'object' && typeof payload.roomId === 'string') {
      return payload.roomId.trim();
    }
    // Fallback: search rooms that socket is currently in (ignoring user private rooms)
    for (const room of socket.rooms) {
      if (room !== socket.id && !room.startsWith('room:') && !room.startsWith('user:')) {
        return room;
      }
      if (room.startsWith('room:') && !room.startsWith('room:user:')) {
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
      if (room.myRole === 'host') {
        await socket.join(`room:${roomId}:host`);
      }

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

      const hostMember = room.members?.find((m: Member) => m.memberRole === 'host');
      const defaultHostId = hostMember?.userId || (room as any).owner_id || (room.myRole === 'host' ? user.id : null);
      const codeSnapshot = await getOrLoadCodeState(roomId, defaultHostId);
      const boardSnapshot = await getOrLoadWhiteboardState(roomId);

      // US-LIVE-07 AC-3: Full state snapshot returned on room:join (FR-3.8, api-contract §4.2)
      const snapshot = {
        roomId,
        room,
        me: room.members?.find((m: Member) => m.userId === user.id) || null,
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

      // US-ATT-01: Record live leave if user was in live call
      if (user?.id) {
        recordLiveLeave(roomId, user.id, socket.id).catch((err) => {
          console.warn('[Socket] Failed to record live leave on room:leave:', err);
        });
      }

      io.to(`room:${roomId}`).to(roomId).emit('presence:update', {
        roomId,
        presence,
      });

      // US-CODE-06: Persist code state on last member leave
      if (presence.length === 0) {
        persistCodeState(roomId).catch((err) => {
          console.warn(`[Socket] Failed to persist code on room leave:`, err);
        });
      }

      // US-WB-03: Persist whiteboard state on last editor leave
      checkAndPersistWhiteboardOnLeave(roomId, user?.id).catch((err) => {
        console.warn(`[Socket] Failed to persist whiteboard on room leave:`, err);
      });

      if (typeof ack === 'function') ack({ ok: true });
    }
  });

  /**
   * live:joined — user enters the live call (US-ROOM-02 AC-3, US-LIVE-07 AC-4, US-ATT-01 AC-1, AC-3, US-SEC-01)
   */
  socket.on('live:joined', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    if (!roomId || !user?.id) {
      if (typeof ack === 'function') ack({ ok: false, error: 'roomId and authenticated user required' });
      return;
    }

    try {
      // US-SEC-01: Re-check membership and flags from DB/cache on every event
      await getRoomForUser(user.id, roomId);

      // US-ERR-02: User cannot join live if no session is active (FR-3.2, api-contract §4.2)
      const activeSession = await getActiveSession(roomId);
      if (!activeSession) {
        if (typeof ack === 'function') {
          ack({
            ok: false,
            error: {
              code: 'NO_ACTIVE_SESSION',
              message: 'Waiting for the teacher to start the session.',
            },
          });
        }
        return;
      }

      const presence = setUserLiveStatus(roomId, user.id, true, socket.id);
      const record = await recordLiveJoin(roomId, user.id, socket.id, user.fullName);

      if (presence) {
        io.to(`room:${roomId}`).to(roomId).emit('presence:update', {
          roomId,
          presence,
        });
      }
      if (typeof ack === 'function') ack({ ok: true, data: record, record });
    } catch (err: any) {
      const code = err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' ? 'NOT_A_MEMBER' : 'INTERNAL_SERVER_ERROR';
      const notMemberErr = { code, message: err.message || 'You are not a member of this room' };
      socket.emit('room:error', notMemberErr);
      socket.emit('error', notMemberErr);
      if (typeof ack === 'function') ack({ ok: false, error: notMemberErr });
    }
  });

  /**
   * live:left — user leaves the live call (US-ROOM-02 AC-3, US-LIVE-07 AC-4, US-ATT-01 AC-2, US-SEC-01)
   */
  socket.on('live:left', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    if (!roomId || !user?.id) {
      if (typeof ack === 'function') ack({ ok: false, error: 'roomId and authenticated user required' });
      return;
    }

    try {
      // US-SEC-01: Re-check membership and flags from DB/cache on every event
      await getRoomForUser(user.id, roomId);

      const presence = setUserLiveStatus(roomId, user.id, false, socket.id);
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
    } catch (err: any) {
      const code = err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' ? 'NOT_A_MEMBER' : 'INTERNAL_SERVER_ERROR';
      const notMemberErr = { code, message: err.message || 'You are not a member of this room' };
      socket.emit('room:error', notMemberErr);
      socket.emit('error', notMemberErr);
      if (typeof ack === 'function') ack({ ok: false, error: notMemberErr });
    }
  });

  /**
   * screen:start — user requests to share their screen (US-LIVE-04, FR-3.5, US-SEC-01)
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
      // US-SEC-01: Re-check membership and flags from DB/cache on every event
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
      const code = err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' ? 'NOT_A_MEMBER' : 'INTERNAL_SERVER_ERROR';
      const serverErr = { code, message: err.message || 'Failed to start screen share' };
      socket.emit('screen:error', serverErr);
      socket.emit('room:error', serverErr);
      if (typeof ack === 'function') ack({ ok: false, error: serverErr });
    }
  });

  /**
   * screen:stop — user or host stops active screen share (US-LIVE-04, FR-3.5, US-SEC-01)
   */
  socket.on('screen:stop', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    if (!roomId || !user?.id) {
      if (typeof ack === 'function') ack({ ok: false, error: { code: 'VALIDATION' } });
      return;
    }

    try {
      // US-SEC-01: Re-check membership and flags from DB/cache on every event
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
      const code = err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' ? 'NOT_A_MEMBER' : 'INTERNAL_SERVER_ERROR';
      const serverErr = { code, message: err.message || 'Failed to stop screen share' };
      socket.emit('screen:error', serverErr);
      if (typeof ack === 'function') ack({ ok: false, error: serverErr });
    }
  });

  /**
   * webrtc:offer — relays SDP offer for screen-share or peer video.
   * If targetSocketId or targetUserId is specified, relays directly to that peer.
   * If neither is specified, relays to room host (screen-share default).
   */
  socket.on('webrtc:offer', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    if (!roomId || !user?.id || !payload?.sdp) {
      if (typeof ack === 'function') ack({ ok: false, error: { code: 'VALIDATION', message: 'Room ID and sdp required' } });
      return;
    }

    try {
      await getRoomForUser(user.id, roomId);
      const targetUserId = payload?.targetUserId;
      const targetSocketId = payload?.targetSocketId;
      const streamType = payload?.streamType || (targetUserId || targetSocketId ? 'video' : 'screen');

      const relayData = {
        roomId,
        sdp: payload.sdp,
        fromSocketId: socket.id,
        fromUserId: user.id,
        streamType,
      };

      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc:offer', relayData);
      } else if (targetUserId) {
        io.to(`user:${targetUserId}`).emit('webrtc:offer', relayData);
      } else {
        io.to(`room:${roomId}:host`).emit('webrtc:offer', relayData);
      }

      if (typeof ack === 'function') ack({ ok: true });
    } catch (err: any) {
      const code = err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' ? 'NOT_A_MEMBER' : 'INTERNAL_SERVER_ERROR';
      if (typeof ack === 'function') ack({ ok: false, error: { code, message: err.message || 'Failed to relay offer' } });
    }
  });

  /**
   * webrtc:answer — answers a specific peer's offer (relay only).
   */
  socket.on('webrtc:answer', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    const targetSocketId = payload?.targetSocketId;
    const targetUserId = payload?.targetUserId;
    if (!roomId || !user?.id || !payload?.sdp || (!targetSocketId && !targetUserId)) {
      if (typeof ack === 'function') ack({ ok: false, error: { code: 'VALIDATION', message: 'Room ID, sdp, and target destination required' } });
      return;
    }

    try {
      await getRoomForUser(user.id, roomId);
      const streamType = payload?.streamType || 'video';
      const relayData = {
        roomId,
        sdp: payload.sdp,
        fromSocketId: socket.id,
        fromUserId: user.id,
        streamType,
      };

      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc:answer', relayData);
      } else if (targetUserId) {
        io.to(`user:${targetUserId}`).emit('webrtc:answer', relayData);
      }

      if (typeof ack === 'function') ack({ ok: true });
    } catch (err: any) {
      const code = err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' ? 'NOT_A_MEMBER' : 'INTERNAL_SERVER_ERROR';
      if (typeof ack === 'function') ack({ ok: false, error: { code, message: err.message || 'Failed to relay answer' } });
    }
  });

  /**
   * webrtc:ice-candidate — bidirectional ICE candidate relay between peers (relay only).
   */
  socket.on('webrtc:ice-candidate', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    const targetSocketId = payload?.targetSocketId;
    const targetUserId = payload?.targetUserId;
    if (!roomId || !user?.id || !payload?.candidate || (!targetSocketId && !targetUserId)) {
      if (typeof ack === 'function') ack({ ok: false, error: { code: 'VALIDATION', message: 'Room ID, candidate, and target destination required' } });
      return;
    }

    try {
      await getRoomForUser(user.id, roomId);
      const streamType = payload?.streamType || 'video';
      const relayData = {
        roomId,
        candidate: payload.candidate,
        fromSocketId: socket.id,
        fromUserId: user.id,
        streamType,
      };

      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc:ice-candidate', relayData);
      } else if (targetUserId) {
        io.to(`user:${targetUserId}`).emit('webrtc:ice-candidate', relayData);
      }

      if (typeof ack === 'function') ack({ ok: true });
    } catch (err: any) {
      const code = err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' ? 'NOT_A_MEMBER' : 'INTERNAL_SERVER_ERROR';
      if (typeof ack === 'function') ack({ ok: false, error: { code, message: err.message || 'Failed to relay ICE candidate' } });
    }
  });

  /**
   * hand:raise — raise or lower hand in live session (US-PERM-07, FR-4.8, US-SEC-01)
   */
  socket.on('hand:raise', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    const raised = Boolean(payload?.raised);
    const targetUserId =
      payload?.userId && (payload?.asHost || user?.role === 'teacher' || socket.data.isHost)
        ? String(payload.userId)
        : user?.id;

    if (!roomId || !targetUserId || !user?.id) {
      if (typeof ack === 'function') ack({ ok: false, error: { code: 'VALIDATION', message: 'Room ID required' } });
      return;
    }

    try {
      // US-SEC-01: Re-check membership and flags from DB/cache on every event
      await getRoomForUser(user.id, roomId);

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

      if (typeof ack === 'function') ack({ ok: true });
    } catch (err: any) {
      console.warn(`[Socket] Error in hand:raise for room ${roomId}:`, err);
      const code = err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' ? 'NOT_A_MEMBER' : 'INTERNAL_SERVER_ERROR';
      const notMemberErr = { code, message: err.message || 'You are not a member of this room' };
      socket.emit('room:error', notMemberErr);
      socket.emit('error', notMemberErr);
      if (typeof ack === 'function') ack({ ok: false, error: notMemberErr });
    }
  });

  /**
   * live:media-state — broadcast a user's mic/camera on-off toggle to the room (presence sync)
   */
  socket.on('live:media-state', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    if (!roomId || !user?.id) {
      if (typeof ack === 'function') ack({ ok: false, error: { code: 'VALIDATION', message: 'Room ID required' } });
      return;
    }

    const patch: { micOn?: boolean; cameraOn?: boolean } = {};
    if (typeof payload?.micOn === 'boolean') patch.micOn = payload.micOn;
    if (typeof payload?.cameraOn === 'boolean') patch.cameraOn = payload.cameraOn;

    try {
      await getRoomForUser(user.id, roomId);

      const presence = setUserMediaStatus(roomId, user.id, patch);
      if (presence) {
        io.to(`room:${roomId}`).to(roomId).emit('presence:update', {
          roomId,
          presence,
        });
      }

      if (typeof ack === 'function') ack({ ok: true });
    } catch (err: any) {
      const code = err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' ? 'NOT_A_MEMBER' : 'INTERNAL_SERVER_ERROR';
      if (typeof ack === 'function') ack({ ok: false, error: { code, message: err.message || 'Failed to update media state' } });
    }
  });

  /**
   * chat:send — send a new chat message in a room (US-CHAT-01, US-CHAT-02, FR-3.11)
   */
  socket.on('chat:send', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    const body =
      typeof payload?.body === 'string'
        ? payload.body
        : typeof payload?.text === 'string'
        ? payload.text
        : typeof payload?.content === 'string'
        ? payload.content
        : '';
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

      // Permitted: merge elements into cache by id and broadcast to room except sender
      mergeWhiteboardElements(roomId, elements);
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
      const code = err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' ? 'NOT_A_MEMBER' : 'FORBIDDEN';
      const errPayload = { code, message: err.message || 'Access denied', event: 'wb:update' };
      socket.emit('error', errPayload);
      if (typeof ack === 'function') ack({ ok: false, error: errPayload });
    }
  });

  /**
   * wb:clear — host clears the entire whiteboard (US-WB-05, FR-5.14, api-contract §4.2, §4.3, US-SEC-01)
   * Acceptance Criteria:
   * 1. A "Clear Board" button is visible to the host only.
   * 2. Clicking shows a confirmation dialog.
   * 3. On confirm, the server emits wb:cleared to the room; all clients reset the canvas to empty.
   * 4. The cleared state is persisted.
   */
  socket.on('wb:clear', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);

    if (!roomId || !user?.id) {
      const err = { code: 'VALIDATION', message: 'Room ID required', event: 'wb:clear' };
      socket.emit('error', err);
      if (typeof ack === 'function') ack({ ok: false, error: err });
      return;
    }

    try {
      const room = await getRoomForUser(user.id, roomId);
      const isHost = room.myRole === 'host';

      if (!isHost) {
        console.warn(`[Socket] wb:clear rejected: user ${user.id} is not host in room ${roomId}`);
        const err = {
          code: 'FORBIDDEN',
          message: 'Only the room host can clear the whiteboard',
          event: 'wb:clear',
        };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, error: err });
        return;
      }

      // Reset whiteboard elements and persist immediately (US-WB-05 AC-3, AC-4)
      await clearAndPersistWhiteboard(roomId);

      // Emit wb:cleared to the room (including host)
      io.to(`room:${roomId}`).to(roomId).emit('wb:cleared', {
        roomId,
      });

      if (typeof ack === 'function') {
        ack({ ok: true });
      }
    } catch (err: any) {
      console.warn(`[Socket] Error in wb:clear for room ${roomId}:`, err);
      const code = err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' ? 'NOT_A_MEMBER' : (err.code || 'FORBIDDEN');
      const errPayload = {
        code,
        message: err.message || 'Access denied',
        event: 'wb:clear',
      };
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
      const defaultHostId = hostMember?.userId || (room as any).owner_id || (room.myRole === 'host' ? user.id : '');
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

      // Check max 64 KB source size (US-CODE-03 AC-4, FR-5.2, api-contract §4.2)
      const sizeValidation = validateCodeSize(content);
      if (!sizeValidation.valid) {
        console.warn(`[Socket] code:update rejected: payload size ${sizeValidation.sizeBytes} exceeds 64 KB limit in room ${roomId}`);
        const sizeErr = {
          code: 'PAYLOAD_TOO_LARGE',
          status: 413,
          message: sizeValidation.error || 'Source code exceeds the 64 KB limit.',
          event: 'code:update',
        };
        socket.emit('error', sizeErr);
        if (typeof ack === 'function') ack({ ok: false, error: sizeErr });
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
      const code = err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' ? 'NOT_A_MEMBER' : 'FORBIDDEN';
      const errPayload = { code, message: err.message || 'Access denied', event: 'code:update' };
      socket.emit('error', errPayload);
      if (typeof ack === 'function') ack({ ok: false, error: errPayload });
    }
  });

  /**
   * code:pen — assign code editor pen holder (US-PERM-05, US-CODE-02, architecture doc §5.5, US-SEC-01)
   */
  socket.on('code:pen', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    const targetHolderId =
      typeof payload?.holderId === 'string' && payload.holderId.trim()
        ? payload.holderId.trim()
        : user?.id || '';

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
      const isTargetHost =
        targetHolderId === user.id ||
        targetMember?.memberRole === 'host' ||
        (room as any).owner_id === targetHolderId;

      if (!targetMember && !isTargetHost) {
        const err = { code: 'NOT_FOUND', message: 'Target member not found in room' };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, error: err });
        return;
      }

      const canCode = isTargetHost || Boolean(targetMember?.permissions?.canCode);
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
        ack({ ok: true, data: { holderId: targetHolderId } });
      }
    } catch (err: any) {
      console.warn(`[Socket] Error in code:pen for room ${roomId}:`, err);
      const code = err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' ? 'NOT_A_MEMBER' : 'INTERNAL_SERVER_ERROR';
      const errPayload = { code, message: err.message || 'Failed to assign pen' };
      socket.emit('error', errPayload);
      if (typeof ack === 'function') ack({ ok: false, error: errPayload });
    }
  });

  /**
   * code:request-pen — student requests the edit pen (US-CODE-08, FR-5.9, api-contract §4.2, US-SEC-01)
   * Acceptance Criteria:
   * 1. A participant with can_code who does not hold the pen emits code:request-pen.
   * 2. The server sends code:pen-requested to the host's sockets.
   * 3. The host sees a badge indicating the student's request.
   */
  socket.on('code:request-pen', async (payload: any, ack?: (res: any) => void) => {
    const rawRoomId = typeof payload === 'string' ? payload : payload?.roomId;
    const roomId = typeof rawRoomId === 'string' && rawRoomId.trim() ? rawRoomId.trim() : '';
    if (!roomId || !user?.id) {
      const err = { code: 'VALIDATION', message: 'Room ID required', event: 'code:request-pen' };
      socket.emit('error', err);
      if (typeof ack === 'function') ack({ ok: false, error: err });
      return;
    }

    try {
      const room = await getRoomForUser(user.id, roomId);
      const myMember = room.members?.find((m) => m.userId === user.id);
      const isHost = room.myRole === 'host';
      const canCode = isHost || Boolean(myMember?.permissions?.canCode);

      if (!canCode) {
        const err = {
          code: 'FORBIDDEN',
          message: 'You do not have code permission',
          event: 'code:request-pen',
        };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, error: err });
        return;
      }

      const hostMember = room.members?.find((m) => m.memberRole === 'host');
      const defaultHostId = hostMember?.userId || (room as any).owner_id || (room.myRole === 'host' ? user.id : '');
      const currentHolderId = getPenHolder(roomId, defaultHostId);

      if (currentHolderId === user.id) {
        const err = {
          code: 'ALREADY_PEN_HOLDER',
          message: 'You already hold the edit pen',
          event: 'code:request-pen',
        };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, error: err });
        return;
      }

      // Record pending pen request
      addPenRequest(roomId, user.id);

      const hostUserId = hostMember?.userId || (room as any).owner_id;
      const penRequestedPayload = {
        roomId,
        userId: user.id,
        userName: user.fullName || user.email || 'Student',
      };

      // Target all sockets belonging to host in this room
      const allSockets = Array.from(io.sockets?.sockets?.values?.() ?? []);
      const targetSockets = new Set<any>();

      for (const s of allSockets) {
        if (s.data?.user?.id === hostUserId) {
          if (
            s.rooms.has(roomId) ||
            s.rooms.has(`room:${roomId}`) ||
            s.rooms.has(`room:${roomId}:host`)
          ) {
            targetSockets.add(s);
          }
        }
      }

      // Also target any socket in room:roomId:host
      const hostRoomSockets = io.sockets.adapter.rooms.get(`room:${roomId}:host`);
      if (hostRoomSockets) {
        for (const sId of hostRoomSockets) {
          const s = io.sockets.sockets.get(sId);
          if (s) targetSockets.add(s);
        }
      }

      // Fallback: if no room-specific socket found, deliver to host sockets matching user ID
      if (targetSockets.size === 0) {
        for (const s of allSockets) {
          if (s.data?.user?.id === hostUserId) {
            targetSockets.add(s);
          }
        }
      }

      for (const hostSocket of targetSockets) {
        hostSocket.emit('code:pen-requested', penRequestedPayload);
      }

      console.log(
        `[Socket] User ${user.fullName} (${user.id}) requested pen in room ${roomId} -> sent to host (${hostUserId}) sockets (${targetSockets.size})`
      );

      if (typeof ack === 'function') {
        ack({ ok: true, data: penRequestedPayload });
      }
    } catch (err: any) {
      console.warn(`[Socket] Error in code:request-pen for room ${roomId}:`, err);
      const code = err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' ? 'NOT_A_MEMBER' : (err.code || 'FORBIDDEN');
      const errPayload = {
        code,
        message: err.message || 'Failed to request edit pen',
        event: 'code:request-pen',
      };
      socket.emit('error', errPayload);
      if (typeof ack === 'function') ack({ ok: false, error: errPayload });
    }
  });

  /**
   * code:run-started — broadcast code execution start to room (US-CODE-05 AC-3, FR-5.5, US-SEC-01)
   */
  socket.on('code:run-started', async (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    if (!roomId || !user?.id) {
      if (typeof ack === 'function') ack({ ok: false, error: { code: 'VALIDATION', message: 'Room ID required' } });
      return;
    }

    try {
      // US-SEC-01: Re-check membership and flags from DB/cache on every event
      const room = await getRoomForUser(user.id, roomId);
      const hostMember = room.members?.find((m) => m.memberRole === 'host');
      const defaultHostId = hostMember?.userId || (room as any).owner_id || (room.myRole === 'host' ? user.id : '');
      const currentHolderId = getPenHolder(roomId, defaultHostId);

      const isHost = room.myRole === 'host' || user.id === defaultHostId;
      const isHolder = currentHolderId === user.id;

      if (!isHost && !isHolder) {
        const notHolderErr = {
          code: 'NOT_PEN_HOLDER',
          message: 'Only the current pen holder or room host can broadcast code run',
          event: 'code:run-started',
        };
        socket.emit('error', notHolderErr);
        if (typeof ack === 'function') ack({ ok: false, error: notHolderErr });
        return;
      }

      const language = payload?.language;
      io.to(`room:${roomId}`).to(roomId).emit('code:run-started', {
        roomId,
        by: user?.fullName || user?.id || 'Unknown',
        language,
      });

      if (typeof ack === 'function') ack({ ok: true });
    } catch (err: any) {
      console.warn(`[Socket] Error in code:run-started for room ${roomId}:`, err);
      const code = err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' ? 'NOT_A_MEMBER' : 'FORBIDDEN';
      const errPayload = { code, message: err.message || 'Access denied', event: 'code:run-started' };
      socket.emit('error', errPayload);
      if (typeof ack === 'function') ack({ ok: false, error: errPayload });
    }
  });

  socket.on('disconnect', async (reason) => {

    console.log(`[Socket] User disconnected: ${user?.fullName} (${user?.id}) - Reason: ${reason}`);
    await recordSocketDisconnect(socket.id, undefined, user?.id);

    const affectedRooms = handleSocketDisconnect(socket.id);
    for (const { roomId, presence } of affectedRooms) {
      io.to(`room:${roomId}`).to(roomId).emit('presence:update', {
        roomId,
        presence,
      });

      // US-CODE-06: Persist code state on last member leave
      if (presence.length === 0) {
        persistCodeState(roomId).catch((err) => {
          console.warn(`[Socket] Failed to persist code on disconnect:`, err);
        });
      }

      // US-WB-03: Persist whiteboard state on last editor leave
      checkAndPersistWhiteboardOnLeave(roomId, user?.id).catch((err) => {
        console.warn(`[Socket] Failed to persist whiteboard on disconnect:`, err);
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

      for (const { roomId } of affectedRooms) {
        const holder = getPenHolder(roomId);
        if (holder === user.id) {
          getRoomForUser(user.id, roomId)
            .then((r) => {
              const hostMember = r.members?.find((m: Member) => m.memberRole === 'host');
              const hostId = hostMember?.userId || (r as any).owner_id || null;
              codeService.setPen(roomId, hostId);
              io.to(`room:${roomId}`).to(roomId).emit('code:pen', {
                roomId,
                holderId: hostId,
                by: 'SYSTEM',
              });
            })
            .catch(() => {});
        }
      }
    }
  });
});

const isDirectExecution =
  require.main === module ||
  (Boolean(process.argv[1]) &&
    (/(?:src|dist)[\\/](?:.*[\\/])?index\.[jt]s$/.test(process.argv[1]) ||
      process.argv[1].endsWith('index.js') ||
      process.argv[1].endsWith('index.ts')));

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[Server] Port ${env.PORT} already in use; skipping direct server.listen`);
  } else {
    throw err;
  }
});

const HOST = '0.0.0.0';

if (isDirectExecution && process.env.NODE_ENV !== 'test') {
  server.listen(env.PORT, HOST, () => {
    console.log(`[Server] LinkUp API server running on http://${HOST}:${env.PORT}`);
    console.log(`[Server] Health check available at http://${HOST}:${env.PORT}/health`);
    console.log(`[Server] Protected API routes mounted at http://${HOST}:${env.PORT}/api/*`);
    closeDanglingAttendanceRecords().catch(() => {});
  });
}

// Graceful shutdown: flush code & whiteboard cache before exit
process.on('SIGTERM', async () => {
  await Promise.all([flushAllCodeState(), flushAllWhiteboardState()]);
  process.exit(0);
});

process.on('SIGINT', async () => {
  await Promise.all([flushAllCodeState(), flushAllWhiteboardState()]);
  process.exit(0);
});

export { server };
