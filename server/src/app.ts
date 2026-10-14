import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { RoomSummary } from '@linkup/shared';
import { env } from './config/env';
import { requireAuth } from './middleware/auth';
import { supabase, updateTokenCacheUserName } from './lib/supabase';

export const app = express();

// Security and middleware
app.use(helmet());
app.use(
  cors({
    origin: [env.CORS_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'],
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

// My rooms dashboard list for the authenticated user
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
    const { data, error } = await supabase.rpc('my_rooms', { p_user: user.id });

    if (error) {
      console.error('[Dashboard] my_rooms RPC failed:', error.message);
      return res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to load your rooms',
          details: error.message,
        },
      });
    }

    const rooms: RoomSummary[] = (data ?? []).map((room: any) => ({
      id: room.id,
      name: room.name,
      description: room.description ?? null,
      joinCode: room.join_code ?? null,
      hostName: room.host_name,
      memberCount: Number(room.member_count ?? 0),
      myRole: room.my_role === 'host' ? 'host' : 'participant',
      activeSessionId: room.active_session_id ?? null,
      createdAt: room.created_at,
    }));

    return res.status(200).json(rooms);
  } catch (err) {
    console.error('[Dashboard] Unexpected error loading rooms:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to load your rooms',
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
