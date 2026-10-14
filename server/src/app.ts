import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { requireAuth } from './middleware/auth';
import { supabase, updateTokenCacheUserName } from './lib/supabase';
import { getRoomsForUser, joinRoomByCode } from './lib/rooms';

// Dynamic CORS origin: accepts localhost AND any 192.168.x.x LAN IP on port 5173.
// This permanently prevents CORS failures when the dev machine's IP changes.
function isCorsAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin / server-to-server
  const allowedPatterns = [
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/,
    /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:\d+$/,
    /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/,
    /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}:\d+$/,
  ];
  return allowedPatterns.some((re) => re.test(origin));
}

export const app = express();

// Security and middleware
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (isCorsAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${origin}' not allowed`));
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '100kb' }));

// Unauthenticated health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Protect all /api/* routes with requireAuth
app.use('/api', requireAuth);

// Authenticated current user endpoint (FR-1.5, US-AUTH-05)
app.get('/api/me', (req: Request, res: Response) => {
  res.status(200).json({ user: req.user });
});

// Edit profile name endpoint (FR-1.6, US-AUTH-06)
app.patch('/api/me', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
  }

  const { fullName } = req.body || {};

  // Criterion 4: Whitespace-only or empty names are rejected with an inline error
  if (typeof fullName !== 'string' || fullName.trim().length === 0) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: 'Full name cannot be empty or whitespace only',
      },
    });
  }

  const trimmedName = fullName.trim();

  if (trimmedName.length > 100) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: 'Full name cannot exceed 100 characters',
      },
    });
  }

  try {
    // 1. Update name in public.profiles database table (Criterion 2)
    const { error: dbError } = await supabase
      .from('profiles')
      .update({ full_name: trimmedName })
      .eq('id', user.id);

    if (dbError) {
      console.warn('[Profile Update] Database update warning:', dbError.message);
    }

    // 2. Sync to Supabase auth user metadata if available
    try {
      await supabase.auth.admin.updateUserById(user.id, {
        user_metadata: { full_name: trimmedName, fullName: trimmedName },
      });
    } catch {
      // Safe fallback if service role key is not configured
    }

    // 3. Invalidate/update token cache so next queries immediately return updated name
    updateTokenCacheUserName(user.id, trimmedName);

    // 4. Update current user on request object
    const updatedUser = {
      ...user,
      fullName: trimmedName,
    };
    req.user = updatedUser;

    return res.status(200).json({
      user: updatedUser,
    });
  } catch (err) {
    console.error('[Profile Update] Error:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update profile name',
      },
    });
  }
});

// User rooms endpoint (FR-8.1, FR-8.2, US-DASH-01, US-DASH-02)
app.get('/api/rooms', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
  }

  try {
    const rooms = await getRoomsForUser(user.id);
    return res.status(200).json(rooms);
  } catch (err) {
    console.error('[Rooms API] Error fetching rooms:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve rooms',
      },
    });
  }
});

// Join room by 6-character code (FR-8.3, FR-2.3, US-DASH-04)
app.post('/api/rooms/join', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
  }

  const { code } = req.body || {};

  // Criterion 2 & 5: Empty/missing code validation
  if (typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: 'Room code is required and must be 6 characters',
      },
    });
  }

  try {
    const result = await joinRoomByCode(user.id, code);

    // Side effect per API contract Section 3.2: emit member:joined to room:<id> if user is new
    if (!result.alreadyMember) {
      try {
        const io = req.app.get('io');
        if (io) {
          io.to(`room:${result.roomId}`).emit('member:joined', {
            userId: user.id,
            fullName: user.fullName,
            role: user.role,
          });
        }
      } catch (socketErr) {
        console.warn('[Rooms API] Socket emit error:', socketErr);
      }
    }

    // Acceptance Criterion 3 & API contract Section 3.2: 200 { roomId }
    return res.status(200).json({
      roomId: result.roomId,
    });
  } catch (err: any) {
    if (err.code === 'ROOM_NOT_FOUND' || err.status === 404) {
      return res.status(404).json({
        error: {
          code: 'ROOM_NOT_FOUND',
          message: err.message || 'No room found with that code.',
        },
      });
    }

    if (err.code === 'VALIDATION' || err.status === 400) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION',
          message: err.message || 'Invalid room code',
        },
      });
    }

    console.error('[Rooms API] Error joining room:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to join room',
      },
    });
  }
});

// Test routes to verify all HTTP methods under /api/* enforce token authentication
app.all('/api/test', (req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    method: req.method,
    user: req.user,
  });
});

// Global 404 handler for unmatched routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Resource not found',
    },
  });
});
