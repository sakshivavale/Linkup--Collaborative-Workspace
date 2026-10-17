import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Socket } from 'socket.io';
import { RoomSummary } from '@linkup/shared';
import { env } from './config/env';
import { requireAuth } from './middleware/auth';
import { supabase, updateTokenCacheUserName } from './lib/supabase';
import { getRoomsForUser, createRoom, joinRoomByCode, getRoomForUser, NotAMemberError, removeRoomMember, regenerateRoomJoinCode, updateRoom, startSession, endSession, getActiveSession, getSessionsForRoom, updateMemberPermissions } from './lib/rooms';
import { getRoomPresence, removeSocketFromRoom, setUserHandStatus } from './realtime/presence';
import { getActiveScreenShare, stopScreenShare } from './realtime/screenShare';
import { getChatMessages, createChatMessage } from './lib/chat';

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

export function kickUserFromRoom(io: any, roomId: string, targetUserId: string) {
  const roomKey = roomId?.trim();
  if (!io || !roomKey || !targetUserId) {
    return { roomId: roomKey || '', userId: targetUserId || '', socketsRemoved: 0 };
  }

  const roomSockets = Array.from(io.sockets?.sockets?.values?.() ?? []) as Socket[];
  const matchingSockets = roomSockets.filter(
    (socket) =>
      socket.data?.user?.id === targetUserId &&
      (socket.rooms.has(roomKey) || socket.rooms.has(`room:${roomKey}`))
  );

  for (const socket of matchingSockets) {
    socket.emit('room:kicked', { roomId: roomKey });
    socket.leave(roomKey);
    socket.leave(`room:${roomKey}`);
    removeSocketFromRoom(roomKey, socket.id);
  }

  const presence = getRoomPresence(roomKey);
  io.to(roomKey).emit('presence:update', {
    roomId: roomKey,
    presence,
  });
  io.to(`room:${roomKey}`).emit('presence:update', {
    roomId: roomKey,
    presence,
  });

  return {
    roomId: roomKey,
    userId: targetUserId,
    socketsRemoved: matchingSockets.length,
  };
}

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
      kickUserFromRoom(io, roomId, targetUserId);
      io.to(`room:${roomId.trim()}`).emit('member:removed', {
        roomId: roomId.trim(),
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

// Update member permissions (host-only) — US-LIVE-04, FR-3.5, architecture doc 5.3
app.patch('/api/rooms/:roomId/members/:userId/permissions', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId, userId: targetUserId } = req.params;
  const body = req.body || {};

  const patch: any = {};
  if (body.canMic !== undefined || body.permissions?.canMic !== undefined || body.can_mic !== undefined) {
    patch.canMic = Boolean(body.canMic ?? body.permissions?.canMic ?? body.can_mic);
  }
  if (body.canCamera !== undefined || body.permissions?.canCamera !== undefined || body.can_camera !== undefined) {
    patch.canCamera = Boolean(body.canCamera ?? body.permissions?.canCamera ?? body.can_camera);
  }
  if (body.canScreen !== undefined || body.permissions?.canScreen !== undefined || body.can_screen !== undefined) {
    patch.canScreen = Boolean(body.canScreen ?? body.permissions?.canScreen ?? body.can_screen);
  }
  if (body.canWhiteboard !== undefined || body.permissions?.canWhiteboard !== undefined || body.can_whiteboard !== undefined) {
    patch.canWhiteboard = Boolean(body.canWhiteboard ?? body.permissions?.canWhiteboard ?? body.can_whiteboard);
  }
  if (body.canCode !== undefined || body.permissions?.canCode !== undefined || body.can_code !== undefined) {
    patch.canCode = Boolean(body.canCode ?? body.permissions?.canCode ?? body.can_code);
  }

  try {
    const result = await updateMemberPermissions(user.id, roomId, targetUserId, patch);

    const io = req.app.get('io');
    if (io) {
      // US-PERM-07 AC-3: Host granting mic automatically lowers the student's raised hand (FR-4.8)
      if (patch.canMic === true) {
        const presence = setUserHandStatus(roomId, targetUserId, false);
        if (presence) {
          io.to(`room:${roomId}`).to(roomId).emit('presence:update', {
            roomId,
            presence,
          });
        }
        io.to(`room:${roomId}`).to(roomId).emit('hand:changed', {
          roomId,
          userId: targetUserId,
          raised: false,
        });
      }

      // US-LIVE-04 Acceptance Criteria 4:
      // "If can_screen is revoked while sharing, the share stops immediately for all viewers."
      if (patch.canScreen === false) {
        const currentShare = getActiveScreenShare(roomId);
        if (currentShare && currentShare.userId === targetUserId) {
          stopScreenShare(roomId, targetUserId);
          io.to(`room:${roomId}`).to(roomId).emit('screen:stopped', {
            roomId,
            userId: targetUserId,
            reason: 'PERMISSION_REVOKED',
          });
        }
      }

      // Architecture doc 5.3: emit perm:changed to room:<id>
      io.to(`room:${roomId}`).to(roomId).emit('perm:changed', {
        roomId,
        userId: targetUserId,
        permissions: result.permissions,
        by: user.id,
      });
    }

    return res.status(200).json({ ok: true, permissions: result.permissions, member: result.member });
  } catch (err: any) {
    if (err?.code === 'HOST_ONLY' || err?.code === 'FORBIDDEN' || err?.status === 403) {
      return res.status(403).json({
        error: { code: err.code || 'FORBIDDEN', message: err.message || 'Only the room host can update member permissions' },
      });
    }

    if (err?.code === 'ROOM_NOT_FOUND' || err?.status === 404 || err?.code === 'NOT_FOUND') {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: err.message || 'Member or room not found' },
      });
    }

    if (err?.code === 'VALIDATION' || err?.status === 400) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: err.message || 'Invalid request' },
      });
    }

    console.error('[Room API] Error updating member permissions:', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update member permissions' },
    });
  }
});

// Get active screen share for a room
app.get('/api/rooms/:roomId/screen-share', (req: Request, res: Response) => {
  const { roomId } = req.params;
  const screenShare = getActiveScreenShare(roomId);
  return res.status(200).json({ screenShare });
});

// ─── Chat History & Messaging (US-CHAT-02, US-CHAT-01, FR-3.12, api-contract §3.5) ───

// Get chat history with cursor pagination (US-CHAT-02)
app.get('/api/rooms/:roomId/messages', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId } = req.params;
  const before = typeof req.query.before === 'string' ? req.query.before : undefined;
  const limitParam = req.query.limit !== undefined ? Number(req.query.limit) : 50;

  try {
    const result = await getChatMessages(user.id, roomId, {
      before,
      limit: limitParam,
    });
    return res.status(200).json(result);
  } catch (err: any) {
    if (err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' || err?.status === 403) {
      return res.status(403).json({
        error: {
          code: 'NOT_A_MEMBER',
          message: err.message || 'You are not a member of this room',
        },
      });
    }

    if (err?.code === 'ROOM_NOT_FOUND' || err?.status === 404 || err?.code === 'NOT_FOUND') {
      return res.status(404).json({
        error: { code: 'ROOM_NOT_FOUND', message: err.message || 'Room not found' },
      });
    }

    if (err?.code === 'VALIDATION' || err?.status === 400) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: err.message || 'Validation error' },
      });
    }

    console.error('[Chat API] Error fetching room messages:', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to retrieve messages' },
    });
  }
});

// Send a chat message via REST API (US-CHAT-01, FR-3.10)
app.post('/api/rooms/:roomId/messages', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId } = req.params;
  const { body, clientId } = req.body || {};

  try {
    const message = await createChatMessage(user.id, roomId, body);

    try {
      const io = req.app.get('io');
      if (io) {
        const chatPayload = {
          ...message,
          roomId,
          message,
          clientId,
        };
        io.to(`room:${roomId}`).to(roomId).emit('chat:new', chatPayload);
        io.to(`room:${roomId}`).to(roomId).emit('chat:new message', chatPayload);
      }
    } catch (socketErr) {
      console.warn('[Chat API] Socket emit error on chat:new:', socketErr);
    }

    return res.status(201).json({ message });
  } catch (err: any) {
    if (
      err instanceof NotAMemberError ||
      err?.code === 'NOT_A_MEMBER' ||
      err?.status === 403 ||
      err?.message?.toLowerCase().includes('not a member')
    ) {
      return res.status(403).json({
        error: {
          code: 'NOT_A_MEMBER',
          message: err.message || 'You are not a member of this room',
        },
      });
    }

    if (err?.code === 'VALIDATION' || err?.status === 400) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: err.message || 'Validation error' },
      });
    }

    console.error('[Chat API] Error creating message:', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to send message' },
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

// Start live session (host only) — US-LIVE-01, FR-3.1
app.post('/api/rooms/:roomId/sessions', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId } = req.params;

  try {
    const session = await startSession(user.id, roomId);

    // Broadcast session:started to room members (US-LIVE-01 Acceptance Criteria 2)
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`room:${roomId}`).to(roomId).emit('session:started', {
          roomId,
          session,
        });
      }
    } catch (socketErr) {
      console.warn('[Session API] Socket emit error on session:started:', socketErr);
    }

    return res.status(201).json(session);
  } catch (err: any) {
    if (err?.code === 'SESSION_ACTIVE' || err?.status === 409) {
      return res.status(409).json({
        error: {
          code: 'SESSION_ACTIVE',
          message: err.message || 'A session is already active in this room',
        },
      });
    }

    if (err?.code === 'HOST_ONLY' || err?.code === 'FORBIDDEN' || err?.status === 403) {
      return res.status(403).json({
        error: {
          code: err.code || 'HOST_ONLY',
          message: err.message || 'Only the host can start a session',
        },
      });
    }

    if (err?.code === 'NOT_A_MEMBER') {
      return res.status(403).json({
        error: {
          code: 'NOT_A_MEMBER',
          message: err.message || 'You are not a member of this room',
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

    console.error('[Session API] Error starting session:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to start session',
      },
    });
  }
});

// End live session (host only) — US-LIVE-05, FR-3.6, api-contract §3.4
const handleEndSessionRoute = async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId, sessionId } = req.params;

  try {
    const session = await endSession(user.id, roomId, sessionId);

    // Broadcast session:ended to room members (US-LIVE-05 Acceptance Criteria 2)
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`room:${roomId}`).to(roomId).emit('session:ended', {
          roomId,
          sessionId: session.id,
        });
      }
    } catch (socketErr) {
      console.warn('[Session API] Socket emit error on session:ended:', socketErr);
    }

    return res.status(200).json(session);
  } catch (err: any) {
    if (err?.code === 'HOST_ONLY' || err?.code === 'FORBIDDEN' || err?.status === 403) {
      return res.status(403).json({
        error: {
          code: err.code || 'HOST_ONLY',
          message: err.message || 'Only the host can end a session',
        },
      });
    }

    if (err?.code === 'NO_ACTIVE_SESSION' || err?.code === 'SESSION_NOT_FOUND' || err?.status === 404) {
      return res.status(404).json({
        error: {
          code: err.code || 'NO_ACTIVE_SESSION',
          message: err.message || 'No active session found',
        },
      });
    }

    if (err?.code === 'ROOM_NOT_FOUND' || err?.status === 404) {
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

    console.error('[Session API] Error ending session:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to end session',
      },
    });
  }
};

app.post('/api/rooms/:roomId/sessions/:sessionId/end', handleEndSessionRoute);
app.post('/api/rooms/:roomId/sessions/end', handleEndSessionRoute);

// Get active session for a room
app.get('/api/rooms/:roomId/sessions/active', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId } = req.params;

  try {
    const session = await getActiveSession(roomId);
    return res.status(200).json({ session });
  } catch (err: any) {
    console.error('[Session API] Error fetching active session:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve active session',
      },
    });
  }
});

// Get all sessions for a room (host only) — P0 api-contract §3.4
app.get('/api/rooms/:roomId/sessions', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId } = req.params;

  try {
    const sessions = await getSessionsForRoom(user.id, roomId);
    return res.status(200).json(sessions);
  } catch (err: any) {
    if (err?.code === 'HOST_ONLY' || err?.code === 'FORBIDDEN' || err?.status === 403) {
      return res.status(403).json({
        error: {
          code: err.code || 'HOST_ONLY',
          message: err.message || 'Only the room host can view sessions',
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

    console.error('[Session API] Error fetching sessions:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve sessions',
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
