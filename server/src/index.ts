import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { app } from './app';
import { env } from './config/env';
import { socketAuthMiddleware } from './realtime/socketAuth';
import { getRoomForUser, NotAMemberError } from './lib/rooms';

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

// Enforce Socket.IO authentication middleware (US-AUTH-05)
io.use(socketAuthMiddleware);

io.on('connection', (socket) => {
  const user = socket.data.user;
  console.log(`[Socket] Authenticated user connected: ${user?.fullName} (${user?.id}) - Socket ID: ${socket.id}`);

  /**
   * room:join — client requests to join a room's Socket.IO channel.
   * Membership is checked server-side. Non-members receive room:error NOT_A_MEMBER
   * and are NOT subscribed to the room channel (US-ROOM-01 AC-2, FR-2.4).
   */
  socket.on('room:join', async (roomId: string) => {
    if (!user?.id || typeof roomId !== 'string' || !roomId.trim()) {
      socket.emit('room:error', { code: 'VALIDATION', message: 'Invalid room ID' });
      return;
    }

    try {
      await getRoomForUser(user.id, roomId.trim());
      // Membership confirmed — subscribe socket to the room channel
      await socket.join(roomId.trim());
      console.log(`[Socket] User ${user.fullName} joined room channel: ${roomId}`);
      socket.emit('room:joined', { roomId: roomId.trim() });
    } catch (err: any) {
      if (err instanceof NotAMemberError) {
        console.warn(`[Socket] User ${user.fullName} (${user.id}) NOT_A_MEMBER for room ${roomId}`);
        socket.emit('room:error', { code: 'NOT_A_MEMBER', message: err.message });
      } else {
        console.error(`[Socket] Error joining room ${roomId}:`, err);
        socket.emit('room:error', { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to join room' });
      }
    }
  });

  socket.on('room:leave', (roomId: string) => {
    if (typeof roomId === 'string' && roomId.trim()) {
      socket.leave(roomId.trim());
      console.log(`[Socket] User ${user?.fullName} left room channel: ${roomId}`);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Socket] User disconnected: ${user?.fullName} (${user?.id}) - Reason: ${reason}`);
  });
});

server.listen(env.PORT, () => {
  console.log(`[Server] LinkUp API server running on port ${env.PORT}`);
  console.log(`[Server] Health check available at http://localhost:${env.PORT}/health`);
  console.log(`[Server] Protected API routes mounted at http://localhost:${env.PORT}/api/*`);
});

export { server };
