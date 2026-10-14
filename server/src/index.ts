import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { app } from './app';
import { env } from './config/env';
import { socketAuthMiddleware } from './realtime/socketAuth';

const server = http.createServer(app);

export const io = new SocketIOServer(server, {
  cors: {
    origin: [env.CORS_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://192.168.1.43:5173'],
    credentials: true,
  },
});

// Enforce Socket.IO authentication middleware (US-AUTH-05)
io.use(socketAuthMiddleware);

io.on('connection', (socket) => {
  const user = socket.data.user;
  console.log(`[Socket] Authenticated user connected: ${user?.fullName} (${user?.id}) - Socket ID: ${socket.id}`);

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
