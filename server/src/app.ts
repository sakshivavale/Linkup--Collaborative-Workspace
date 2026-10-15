import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Socket } from 'socket.io';
import { RoomSummary } from '@linkup/shared';
import { env } from './config/env';
import { requireAuth } from './middleware/auth';
import { supabase, updateTokenCacheUserName } from './lib/supabase';
import { getRoomsForUser, createRoom, joinRoomByCode, getRoomForUser, NotAMemberError, removeRoomMember, regenerateRoomJoinCode, updateRoom } from './lib/rooms';

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

// Create room endpoint (FR-8.3, FR-2.1, US-DASH-03) — teacher only
app.post('/api/rooms', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
  }

  if (user.role !== 'teacher') {
    return res.status(403).json({
      error: {
        code: 'TEACHER_ONLY',
        message: 'Only teachers can create rooms',
      },
    });
  }

  const { name, description, defaultPermissions } = req.body || {};

  if (typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: 'Room name is required and cannot be empty or whitespace only',
      },
    });
  }

  const trimmedName = name.trim();
  if (trimmedName.length > 80) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: 'Room name cannot exceed 80 characters',
      },
    });
  }

  let trimmedDesc: string | null = null;
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string') {
      return res.status(400).json({
        error: {
          code: 'VALIDATION',
          message: 'Description must be a string',
        },
      });
    }
    trimmedDesc = description.trim();
    if (trimmedDesc.length > 500) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION',
          message: 'Description cannot exceed 500 characters',
        },
      });
    }
  }

  const perms = {
    canMic: Boolean(defaultPermissions?.canMic),
    canCamera: Boolean(defaultPermissions?.canCamera),
    canScreen: Boolean(defaultPermissions?.canScreen),
    canWhiteboard: Boolean(defaultPermissions?.canWhiteboard),
    canCode: Boolean(defaultPermissions?.canCode),
  };

  try {
    const createdRoom = await createRoom(user.id, user.fullName, {
      name: trimmedName,
      description: trimmedDesc,
      defaultPermissions: perms,
    });

    return res.status(201).json(createdRoom);
  } catch (err) {
    console.error('[Rooms API] Error creating room:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create room',
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

// Get single room endpoint — membership enforced (US-ROOM-01, FR-2.4)
app.get('/api/rooms/:roomId', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId } = req.params;

  try {
    const room = await getRoomForUser(user.id, roomId);
    return res.status(200).json(room);
  } catch (err: any) {
    if (err instanceof NotAMemberError) {
      return res.status(403).json({
        error: { code: 'NOT_A_MEMBER', message: err.message },
      });
    }
    if (err?.code === 'ROOM_NOT_FOUND') {
      return res.status(404).json({
        error: { code: 'ROOM_NOT_FOUND', message: 'Room not found' },
      });
    }
    console.error('[Room API] Error fetching room:', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to retrieve room' },
    });
  }
});

// Remove a room member (host-only) — US-ROOM-03, FR-2.5
app.delete('/api/rooms/:roomId/members/:userId', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId, userId: targetUserId } = req.params;

  try {
    await removeRoomMember(user.id, roomId, targetUserId);

    const io = req.app.get('io');
    if (io) {
      const roomKey = roomId.trim();
      const roomSockets = Array.from(io.sockets.sockets.values()) as Socket[];
      const matchingSockets = roomSockets.filter(
        (socket) => socket.data.user?.id === targetUserId && socket.rooms.has(roomKey)
      );

      for (const socket of matchingSockets) {
        socket.emit('room:kicked', { roomId: roomKey });
        socket.leave(roomKey);
      }

      io.to(`room:${roomKey}`).emit('member:removed', {
        roomId: roomKey,
        userId: targetUserId,
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    if (err?.code === 'FORBIDDEN' || err?.status === 403) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: err.message || 'Only the host can manage members' },
      });
    }

    if (err?.code === 'ROOM_NOT_FOUND' || err?.status === 404 || err?.code === 'NOT_FOUND') {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: err.message || 'Member or room not found' },
      });
    }

    if (err?.code === 'VALIDATION' || err?.status === 400) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: err.message || 'Invalid room or user ID' },
      });
    }

    console.error('[Room API] Error removing room member:', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to remove member' },
    });
  }
});

// Regenerate room join code (host only) — US-ROOM-04, FR-2.6
app.post('/api/rooms/:roomId/join-code', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId } = req.params;

  try {
    const newJoinCode = await regenerateRoomJoinCode(user.id, roomId);

    // Broadcast new join code to room sockets if available
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`room:${roomId}`).emit('room:join-code-updated', {
          roomId,
          joinCode: newJoinCode,
        });
      }
    } catch (socketErr) {
      console.warn('[Room API] Socket emit error on join code regeneration:', socketErr);
    }

    return res.status(200).json({
      joinCode: newJoinCode,
    });
  } catch (err: any) {
    if (err?.code === 'HOST_ONLY' || err?.code === 'FORBIDDEN' || err?.status === 403) {
      return res.status(403).json({
        error: {
          code: 'HOST_ONLY',
          message: err.message || 'Only the room host can regenerate the join code',
        },
      });
    }

    if (err?.code === 'ROOM_NOT_FOUND' || err?.code === 'NOT_FOUND' || err?.status === 404) {
      return res.status(404).json({
        error: {
          code: 'ROOM_NOT_FOUND',
          message: err.message || 'Room not found',
        },
      });
    }

    if (err?.code === 'VALIDATION' || err?.status === 400) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION',
          message: err.message || 'Invalid room ID',
        },
      });
    }

    console.error('[Room API] Error regenerating join code:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to regenerate join code',
      },
    });
  }
});

// Edit room name/description or archive room (host only) — US-ROOM-05, FR-2.7
app.patch('/api/rooms/:roomId', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId } = req.params;
  const { name, description, archived } = req.body || {};

  // Validation: ensure at least one field is provided
  if (name === undefined && description === undefined && archived === undefined) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: 'At least one field (name, description, archived) must be provided',
      },
    });
  }

  // Validate name if provided
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION',
          message: 'Room name cannot be empty or whitespace only',
        },
      });
    }
    if (name.trim().length > 80) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION',
          message: 'Room name cannot exceed 80 characters',
        },
      });
    }
  }

  // Validate description if provided
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string') {
      return res.status(400).json({
        error: {
          code: 'VALIDATION',
          message: 'Description must be a string or null',
        },
      });
    }
    if (description.trim().length > 500) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION',
          message: 'Description cannot exceed 500 characters',
        },
      });
    }
  }

  // Validate archived flag if provided
  if (archived !== undefined && typeof archived !== 'boolean') {
    return res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: 'Archived must be a boolean',
      },
    });
  }

  try {
    const result = await updateRoom(user.id, roomId, {
      name: name !== undefined ? name.trim() : undefined,
      description: description !== undefined ? (description === null ? null : description.trim()) : undefined,
      archived,
    });

    // Broadcast socket event if io is available
    try {
      const io = req.app.get('io');
      if (io) {
        if (archived) {
          io.to(`room:${roomId}`).emit('room:archived', { roomId });
        } else {
          io.to(`room:${roomId}`).emit('room:updated', {
            roomId,
            name: (result as any).name,
            description: (result as any).description,
          });
        }
      }
    } catch (socketErr) {
      console.warn('[Room API] Socket emit error on room update:', socketErr);
    }

    return res.status(200).json(result);
  } catch (err: any) {
    if (err?.code === 'HOST_ONLY' || err?.code === 'FORBIDDEN' || err?.status === 403) {
      return res.status(403).json({
        error: {
          code: 'HOST_ONLY',
          message: err.message || 'Only the room host can edit or archive the room',
        },
      });
    }

    if (err?.code === 'ROOM_NOT_FOUND' || err?.code === 'NOT_FOUND' || err?.status === 404) {
      return res.status(404).json({
        error: {
          code: 'ROOM_NOT_FOUND',
          message: err.message || 'Room not found',
        },
      });
    }

    if (err?.code === 'VALIDATION' || err?.status === 400) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION',
          message: err.message || 'Validation error',
        },
      });
    }

    console.error('[Room API] Error updating room:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update room',
      },
    });
  }
});

// Explicit Archive room endpoint — US-ROOM-05, FR-2.7
app.post('/api/rooms/:roomId/archive', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId } = req.params;

  try {
    const result = await updateRoom(user.id, roomId, { archived: true });

    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`room:${roomId}`).emit('room:archived', { roomId });
      }
    } catch (socketErr) {
      console.warn('[Room API] Socket emit error on room archive:', socketErr);
    }

    return res.status(200).json(result);
  } catch (err: any) {
    if (err?.code === 'HOST_ONLY' || err?.code === 'FORBIDDEN' || err?.status === 403) {
      return res.status(403).json({
        error: {
          code: 'HOST_ONLY',
          message: err.message || 'Only the room host can edit or archive the room',
        },
      });
    }

    if (err?.code === 'ROOM_NOT_FOUND' || err?.code === 'NOT_FOUND' || err?.status === 404) {
      return res.status(404).json({
        error: {
          code: 'ROOM_NOT_FOUND',
          message: err.message || 'Room not found',
        },
      });
    }

    console.error('[Room API] Error archiving room:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to archive room',
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
