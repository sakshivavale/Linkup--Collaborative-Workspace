import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { app } from './app';
import { env } from './config/env';
import { socketAuthMiddleware } from './realtime/socketAuth';
import { getRoomForUser, NotAMemberError, closeDanglingAttendanceRecords } from './lib/rooms';
import {
  addSocketToRoom,
  removeSocketFromRoom,
  handleSocketDisconnect,
  setUserLiveStatus,
  setUserHandStatus,
} from './realtime/presence';

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
      await getRoomForUser(user.id, roomId);
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

      socket.emit('room:joined', { roomId, presence });
      if (typeof ack === 'function') {
        ack({ ok: true, data: { roomId, presence } });
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
   * live:joined — user enters the live call (US-ROOM-02 AC-3)
   */
  socket.on('live:joined', (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    if (roomId && user?.id) {
      const presence = setUserLiveStatus(roomId, user.id, true);
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
   * live:left — user leaves the live call (US-ROOM-02 AC-3)
   */
  socket.on('live:left', (payload: any, ack?: (res: any) => void) => {
    const roomId = extractRoomId(payload);
    if (roomId && user?.id) {
      const presence = setUserLiveStatus(roomId, user.id, false);
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
   * hand:raise — raise or lower hand in live session
   */
  socket.on('hand:raise', (payload: any) => {
    const roomId = extractRoomId(payload);
    const raised = Boolean(payload?.raised);
    if (roomId && user?.id) {
      const presence = setUserHandStatus(roomId, user.id, raised);
      if (presence) {
        io.to(`room:${roomId}`).to(roomId).emit('presence:update', {
          roomId,
          presence,
        });
        io.to(`room:${roomId}`).to(roomId).emit('hand:changed', {
          roomId,
          userId: user.id,
          raised,
        });
      }
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Socket] User disconnected: ${user?.fullName} (${user?.id}) - Reason: ${reason}`);
    const affectedRooms = handleSocketDisconnect(socket.id);
    for (const { roomId, presence } of affectedRooms) {
      io.to(`room:${roomId}`).to(roomId).emit('presence:update', {
        roomId,
        presence,
      });
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
