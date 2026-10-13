import { Socket } from 'socket.io';
import { Me } from '@linkup/shared';
import { verifyToken } from '../lib/supabase';

export interface SocketData {
  user: Me;
}

/**
 * Socket.IO middleware to enforce valid Supabase access token in the auth object.
 * Acceptance criteria: A Socket.IO connection attempt without a valid token
 * in the auth object is rejected with connect_error: UNAUTHENTICATED.
 */
export const socketAuthMiddleware = async (
  socket: Socket,
  next: (err?: Error) => void
) => {
  const token = socket.handshake.auth?.token;

  if (!token || typeof token !== 'string') {
    return next(new Error('UNAUTHENTICATED'));
  }

  const user = await verifyToken(token);
  if (!user) {
    return next(new Error('UNAUTHENTICATED'));
  }

  // Attach authenticated user to socket.data
  socket.data.user = user;
  next();
};
