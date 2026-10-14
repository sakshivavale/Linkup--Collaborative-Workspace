import { io, Socket } from 'socket.io-client';
import { supabase } from './supabase';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

/**
 * Socket.IO client instance configured with Supabase auth token
 * and silent token refresh on connect_error UNAUTHENTICATED.
 */
export const socket: Socket = io(API_BASE_URL, {
  autoConnect: false,
  auth: async (cb: (data: { token?: string }) => void) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      cb({ token: session?.access_token });
    } catch {
      cb({ token: undefined });
    }
  },
});

// Acceptance Criterion 2 & 3:
// Handle connect_error: if rejected with UNAUTHENTICATED, silently refresh token and reconnect
socket.on('connect_error', async (err: Error) => {
  if (err.message === 'UNAUTHENTICATED') {
    console.warn('[Socket] Connection rejected with UNAUTHENTICATED. Attempting silent token refresh...');

    try {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && refreshData.session?.access_token) {
        console.info('[Socket] Token refreshed successfully. Retrying socket connection...');
        socket.auth = { token: refreshData.session.access_token };
        socket.connect();
      } else {
        console.error('[Socket] Failed to refresh token after UNAUTHENTICATED rejection:', refreshError?.message);
      }
    } catch (refreshErr) {
      console.error('[Socket] Unexpected error refreshing socket auth token:', refreshErr);
    }
  } else {
    console.error('[Socket] Connection error:', err.message);
  }
});

// Update socket auth token whenever Supabase session changes
supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.access_token) {
    socket.auth = { token: session.access_token };
  }
});
