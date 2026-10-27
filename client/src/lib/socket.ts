import { io, Socket } from 'socket.io-client';
import { supabase } from './supabase';

// In production the backend lives on a separate Render domain, so we read
// VITE_API_BASE_URL (or VITE_API_URL / VITE_APL_URL). In local dev Vite's /socket.io proxy forwards to
// localhost:3001, so same-origin origin fallback works fine.
const PROD_BACKEND_URL = 'https://linkup-collaborative-workspace-r74x.onrender.com';

const RAW_SOCKET_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_APL_URL ||
  (typeof window !== 'undefined' &&
  (window.location.hostname.includes('onrender.com') ||
   window.location.hostname.includes('linkup-client') ||
   window.location.hostname.includes('linkup-collaborative-workspace'))
    ? PROD_BACKEND_URL
    : typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001')
).trim();

export const SOCKET_URL = RAW_SOCKET_URL.replace(/\/+$/, '');

/**
 * Socket.IO client instance configured with Supabase auth token
 * and silent token refresh on connect_error UNAUTHENTICATED.
 */
export const socket: Socket = io(SOCKET_URL, {
  autoConnect: false,
  auth: async (cb: (data: { token?: string }) => void) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      let token = session?.access_token;
      if (!token && typeof window !== 'undefined') {
        const savedAdmin = localStorage.getItem('linkup_admin_session');
        if (savedAdmin) {
          token = JSON.parse(savedAdmin)?.access_token;
        }
      }
      cb({ token });
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
        console.warn('[Socket] Silent refresh unavailable. Halting reconnect until authentication.');
        socket.disconnect();
      }
    } catch (refreshErr) {
      console.error('[Socket] Unexpected error refreshing socket auth token:', refreshErr);
      socket.disconnect();
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
