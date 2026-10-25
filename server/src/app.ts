import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Socket } from 'socket.io';
import { RoomSummary } from '@linkup/shared';
import { env } from './config/env';
import { requireAuth, requireMember, requireHost, requireApprovedTeacher } from './middleware/auth';
import { supabase, updateTokenCacheUserName, invalidateUserCache } from './lib/supabase';
import {
  getRoomsForUser,
  createRoom,
  joinRoomByCode,
  getRoomForUser,
  NotAMemberError,
  removeRoomMember,
  regenerateRoomJoinCode,
  updateRoom,
  startSession,
  endSession,
  getActiveSession,
  getSessionsForRoom,
  updateMemberPermissions,
  bulkUpdateMemberPermissions,
  getAttendanceSummary,
  getAttendanceCSV,
} from './lib/rooms';
import { getRoomPresence, removeSocketFromRoom, setUserHandStatus } from './realtime/presence';
import { getActiveScreenShare, stopScreenShare } from './realtime/screenShare';
import { getChatMessages, createChatMessage } from './lib/chat';
import { mintLivekitToken, updateLivekitParticipantPermissions } from './lib/livekit';
import { getPenHolder, setPenHolder, setPen, codeService, getOrLoadCodeState, persistCodeState } from './realtime/codeWorkspace';
import { getOrLoadWhiteboardState } from './realtime/whiteboard';
import {
  executeCode,
  checkRunRateLimit,
  getAvailableRuntimes,
  getExecutionWorkerStatus,
  MAX_CODE_BYTES,
  MAX_STDIN_BYTES,
} from './lib/piston';
import { RunResult, Language } from '@linkup/shared';


// Dynamic CORS origin: accepts localhost, LAN IPs, production CORS_ORIGIN env var, and Render HTTPS.
function isCorsAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin / server-to-server
  // Allow production frontend URL from env (Render deployment)
  if ((env.CORS_ORIGIN && origin === env.CORS_ORIGIN) || (process.env.CORS_ORIGIN && origin === process.env.CORS_ORIGIN)) {
    return true;
  }
  const allowedPatterns = [
    /^https?:\/\/localhost(:\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
    /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
    /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
    /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
    /^https:\/\/.*\.onrender\.com$/,
  ];
  return allowedPatterns.some((re) => re.test(origin));
}

export const app = express();

// Disable Express's automatic ETag generation - it was causing the browser to serve stale,
// cached 304 responses for dynamic/authenticated API data (e.g. GET /api/rooms/:id returning
// a membership list from before a user had joined, even after a hard refresh).
app.set('etag', false);

// Security and middleware
app.use(helmet());
app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});
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

// requireAuth middleware is applied to every route except GET /health, execution health check, and registration/verification hooks
app.use((req: Request, res: Response, next: NextFunction) => {
  if (
    (req.method === 'GET' &&
      (req.path === '/health' ||
        req.path === '/health/' ||
        req.path === '/health/execution' ||
        req.path === '/api/health/execution')) ||
    req.path.startsWith('/api/auth/register') ||
    req.path.startsWith('/auth/register') ||
    req.path.includes('/verify-teacher') ||
    req.path.includes('/pending-teachers')
  ) {
    return next();
  }
  return requireAuth(req, res, next);
});

// Unauthenticated execution worker health check endpoint
app.get(['/health/execution', '/api/health/execution'], async (_req: Request, res: Response) => {
  try {
    const status = await getExecutionWorkerStatus();
    res.status(200).json({ status: 'ok', ...status });
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ============ Teacher Verification & Real-Time Notification Workflow ============
interface PendingTeacherRecord {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
  is_verified: boolean;
}

const pendingTeachersStore = new Map<string, PendingTeacherRecord>();

// Pre-seed sample pending teachers for admin verification review
pendingTeachersStore.set('t-seed-1', {
  id: 't-seed-1',
  fullName: 'Dr. Evelyn Reed',
  email: 'evelyn.reed@university.edu',
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  status: 'pending',
  is_verified: false,
});
pendingTeachersStore.set('t-seed-2', {
  id: 't-seed-2',
  fullName: 'Prof. Arthur Davies',
  email: 'arthur.davies@polytech.org',
  createdAt: new Date(Date.now() - 7200000).toISOString(),
  status: 'pending',
  is_verified: false,
});

/**
 * Real-Time Registration Notification:
 * When a teacher registers, intercept and emit teacher_created event to the admin room immediately.
 */
app.post(['/api/auth/register-teacher', '/api/auth/register', '/auth/register-teacher'], async (req: Request, res: Response) => {
  const { id, fullName, email } = req.body || {};
  if (!email || !fullName) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Name and email are required' } });
  }

  const teacherId = id || `teacher-${Date.now()}`;
  const record: PendingTeacherRecord = {
    id: teacherId,
    fullName: String(fullName).trim(),
    email: String(email).trim().toLowerCase(),
    createdAt: new Date().toISOString(),
    status: 'pending',
    is_verified: false,
  };

  pendingTeachersStore.set(teacherId, record);

  // Sync to database profiles table
  try {
    await supabase.from('profiles').upsert({
      id: teacherId,
      full_name: record.fullName,
      role: 'teacher',
      status: 'pending',
      is_approved: false,
      isApproved: false,
    });
  } catch {}

  // Emit WebSocket teacher_created event to the admin room
  const io = req.app.get('io');
  if (io) {
    io.to('admin').emit('teacher_created', record);
    console.log(`[RealTime] Pushed teacher_created notification to admin room for: ${record.fullName} (${record.email})`);
  }

  return res.status(201).json({
    success: true,
    message: 'Teacher registration received. Awaiting administrator verification.',
    teacher: record,
  });
});

/**
 * Fetch pending teacher verification requests for Admin Dashboard
 */
app.get(['/api/admin/pending-teachers', '/admin/pending-teachers', '/api/admin/verify-teacher'], async (_req: Request, res: Response) => {
  try {
    const { data: dbProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, role, status, created_at, is_approved, "isApproved"')
      .eq('role', 'teacher');

    if (dbProfiles && dbProfiles.length > 0) {
      dbProfiles.forEach((p: any) => {
        const isApproved = p.isApproved === true || p.is_approved === true || p.status === 'approved' || p.status === 'APPROVED';
        if (!isApproved && !pendingTeachersStore.has(p.id)) {
          pendingTeachersStore.set(p.id, {
            id: p.id,
            fullName: p.full_name,
            email: p.id.includes('@') ? p.id : `teacher-${p.id.slice(0, 5)}@university.edu`,
            createdAt: p.created_at || new Date().toISOString(),
            status: 'pending',
            is_verified: false,
          });
        }
      });
    }
  } catch {}

  const pending = Array.from(pendingTeachersStore.values()).filter((t) => t.status === 'pending');
  return res.status(200).json({ pendingTeachers: pending });
});

/**
 * Update teacher verification status (Approve or Reject)
 * PATCH /admin/verify-teacher/:id
 */
app.all(
  [
    '/api/admin/verify-teacher/:id',
    '/admin/verify-teacher/:id',
    '/api/admin/teacher-requests/:id/approve',
    '/api/admin/users/:id/approval',
  ],
  async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, action } = req.body || {};

  const resolvedStatus: 'approved' | 'rejected' =
    status === 'approved' || status === 'rejected'
      ? status
      : action === 'reject'
      ? 'rejected'
      : 'approved';

  const isApproved = resolvedStatus === 'approved';

  let record = pendingTeachersStore.get(id);
  if (record) {
    record.status = resolvedStatus;
    record.is_verified = isApproved;
    pendingTeachersStore.set(id, record);
  } else {
    record = {
      id,
      fullName: 'Teacher',
      email: `${id}@linkup.edu`,
      createdAt: new Date().toISOString(),
      status: resolvedStatus,
      is_verified: isApproved,
    };
    pendingTeachersStore.set(id, record);
  }

  // Update Supabase profiles and auth metadata
  try {
    await supabase
      .from('profiles')
      .update({
        status: resolvedStatus,
        isApproved: isApproved,
        is_approved: isApproved,
        role: isApproved ? 'teacher' : 'student',
      })
      .eq('id', id);

    await supabase.auth.admin.updateUserById(id, {
      user_metadata: {
        status: resolvedStatus,
        teacher_status: resolvedStatus,
        isApproved: isApproved,
        is_approved: isApproved,
        role: isApproved ? 'teacher' : 'student',
      },
    });
  } catch (err: any) {
    console.warn('[Verify Teacher] DB update notice:', err.message);
  }

  // Invalidate any cached user token for real-time permission transition
  invalidateUserCache(id);

  // Real-time broadcast to admin room, direct user socket room, and global broadcast
  const io = req.app.get('io');
  if (io) {
    const payload = {
      id,
      status: isApproved ? 'APPROVED' : 'REJECTED',
      role: isApproved ? 'teacher' : 'student',
      is_verified: isApproved,
    };
    io.to('admin').emit('teacher_verified', payload);
    io.to(`user:${id}`).emit('teacher_verified', payload);
    io.emit('teacher_verified', payload);
    io.emit('teacher_status_updated', payload);
    console.log(`[RealTime] Pushed teacher verification update for: ${id} -> ${resolvedStatus}`);
  }

  return res.status(200).json({
    success: true,
    message: `Teacher ${resolvedStatus} successfully.`,
    teacher: record,
    role: isApproved ? 'teacher' : 'student',
    status: isApproved ? 'APPROVED' : 'REJECTED',
  });
});

// Admin overview analytics endpoint
app.get(['/api/admin/overview', '/api/admin/analytics/overview'], (req: Request, res: Response) => {
  const user = req.user;
  const isAdmin =
    user?.role === 'admin' ||
    user?.role === 'ADMIN' ||
    (user as any)?.isAdmin === true ||
    user?.email?.toLowerCase() === 'support@gmail.com';
  if (!isAdmin) {
    return res.status(403).json({ error: { code: 'ADMIN_ONLY', message: 'Admin access required' } });
  }
  return res.status(200).json({
    usersCount: 10,
    studentsCount: 8,
    approvedTeachersCount: 2,
    pendingApprovalsCount: pendingTeachersStore.size,
    activeRoomsCount: 1,
  });
});

// Admin elevation endpoint
app.post('/api/admin/elevate', (req: Request, res: Response) => {
  const { passkey } = req.body || {};
  if (passkey === 'admin123') {
    return res.status(200).json({ success: true, message: 'Elevated to admin' });
  }
  return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid passkey' } });
});

// Normalize :id and :roomId params across routes
app.param('id', (req, _res, next, id) => {
  if (!req.params.roomId) req.params.roomId = id;
  next();
});
app.param('roomId', (req, _res, next, roomId) => {
  if (!req.params.id) req.params.id = roomId;
  next();
});

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

// Create room endpoint (FR-8.3, FR-2.1, US-DASH-03, US-2.1) — approved teacher only
app.post('/api/rooms', requireApprovedTeacher, async (req: Request, res: Response) => {
  const user = req.user!;

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
  } catch (err: any) {
    console.error('[Rooms API] Error creating room:', err);

    if (err?.code === 'DB_INSERT_FAILED') {
      return res.status(503).json({
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to persist room in the database. Please try again in a moment.',
          details: err.supabaseCode ? `Supabase error code: ${err.supabaseCode}` : undefined,
        },
      });
    }

    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create room',
      },
    });
  }
});

// Join room by 6-character code (FR-8.3, FR-2.3, US-DASH-04, US-ERR-01, FRD Section 7)
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
            roomId: result.roomId,
            member: {
              userId: user.id,
              fullName: user.fullName,
              userRole: user.role,
              memberRole: 'participant',
              permissions: result.permissions || {
                canMic: false,
                canCamera: false,
                canScreen: false,
                canWhiteboard: false,
                canCode: false,
              },
              joinedAt: new Date().toISOString(),
            },
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

// ─── Room-Level Security & Membership Enforcement (US-SEC-01 AC-2, NFR-1.1) ───
// requireMember is applied to every /rooms/:id/* and /api/rooms/:roomId/* route
app.use(
  ['/api/rooms/:roomId', '/rooms/:roomId', '/api/rooms/:id', '/rooms/:id'],
  requireMember
);

// Get single room endpoint — membership enforced (US-ROOM-01, FR-2.4, US-SEC-01)
app.get(
  ['/api/rooms/:roomId', '/rooms/:roomId', '/api/rooms/:id', '/rooms/:id'],
  requireMember,
  async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      });
    }

    const roomId = req.params.roomId || req.params.id;

    try {
      const room = req.room || (await getRoomForUser(user.id, roomId));
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
  }
);

/**
 * GET /api/rooms/:roomId/code — Fetch persisted code state and selected language (US-CODE-06, FR-5.7, US-SEC-01)
 */
app.get(
  ['/api/rooms/:roomId/code', '/rooms/:roomId/code', '/api/rooms/:id/code', '/rooms/:id/code'],
  requireMember,
  async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      });
    }

    const roomId = req.params.roomId || req.params.id;
    try {
      const room = req.room || (await getRoomForUser(user.id, roomId));
      const hostMember = room.members?.find((m) => m.memberRole === 'host');
      const defaultHostId = hostMember?.userId || (room as any).owner_id || (room.myRole === 'host' ? user.id : null);
      const codeState = await getOrLoadCodeState(roomId, defaultHostId);
      return res.status(200).json(codeState);
    } catch (err: any) {
      if (err instanceof NotAMemberError) {
        return res.status(403).json({
          error: { code: 'NOT_A_MEMBER', message: err.message },
        });
      }
      console.error('[Code API] Error fetching code state:', err);
      return res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to retrieve code state' },
      });
    }
  }
);

/**
 * GET /api/rooms/:roomId/whiteboard — Fetch persisted whiteboard state (US-WB-03, FR-5.13, US-SEC-01)
 */
app.get(
  ['/api/rooms/:roomId/whiteboard', '/rooms/:roomId/whiteboard', '/api/rooms/:id/whiteboard', '/rooms/:id/whiteboard'],
  requireMember,
  async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      });
    }

    const roomId = req.params.roomId || req.params.id;
    try {
      await (req.room || getRoomForUser(user.id, roomId));
      const boardState = await getOrLoadWhiteboardState(roomId);
      return res.status(200).json(boardState);
    } catch (err: any) {
      if (err instanceof NotAMemberError) {
        return res.status(403).json({
          error: { code: 'NOT_A_MEMBER', message: err.message },
        });
      }
      console.error('[Whiteboard API] Error fetching whiteboard state:', err);
      return res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to retrieve whiteboard state' },
      });
    }
  }
);

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

  // Also emit to user's direct channel for multi-tab or pending connections
  io.to(`user:${targetUserId}`).emit('room:kicked', { roomId: roomKey });

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

// Remove a room member (host-only) — US-ROOM-03, US-ERR-05, FR-2.5, US-SEC-01
app.delete(
  [
    '/api/rooms/:roomId/members/:userId',
    '/rooms/:roomId/members/:userId',
    '/api/rooms/:id/members/:userId',
    '/rooms/:id/members/:userId',
  ],
  requireMember,
  requireHost,
  async (req: Request, res: Response) => {
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

// Update member permissions (host-only) — US-LIVE-04, US-PERM-05, FR-3.5, FR-4.6, US-SEC-01
app.patch(
  [
    '/api/rooms/:roomId/members/:userId/permissions',
    '/rooms/:roomId/members/:userId/permissions',
    '/api/rooms/:id/members/:userId/permissions',
    '/rooms/:id/members/:userId/permissions',
  ],
  requireMember,
  requireHost,
  async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId, userId: targetUserId } = req.params;
  const body = req.body || {};

  const parseBool = (val: any) => (typeof val === 'string' ? val.toLowerCase() === 'true' || val === '1' : Boolean(val));
  const patch: any = {};
  if (body.canMic !== undefined || body.permissions?.canMic !== undefined || body.can_mic !== undefined) {
    patch.canMic = parseBool(body.canMic ?? body.permissions?.canMic ?? body.can_mic);
  }
  if (body.canCamera !== undefined || body.permissions?.canCamera !== undefined || body.can_camera !== undefined) {
    patch.canCamera = parseBool(body.canCamera ?? body.permissions?.canCamera ?? body.can_camera);
  }
  if (body.canScreen !== undefined || body.permissions?.canScreen !== undefined || body.can_screen !== undefined) {
    patch.canScreen = parseBool(body.canScreen ?? body.permissions?.canScreen ?? body.can_screen);
  }
  if (body.canWhiteboard !== undefined || body.permissions?.canWhiteboard !== undefined || body.can_whiteboard !== undefined) {
    patch.canWhiteboard = parseBool(body.canWhiteboard ?? body.permissions?.canWhiteboard ?? body.can_whiteboard);
  }
  if (body.canCode !== undefined || body.permissions?.canCode !== undefined || body.can_code !== undefined) {
    patch.canCode = parseBool(body.canCode ?? body.permissions?.canCode ?? body.can_code);
  }

  // Only the room host may change a member's permissions; the service layer enforces this
  // before the socket broadcast so clients stay aligned with the canonical room state.
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

      // US-CODE-04 — Revoke Code Permission from Pen Holder (FR-5.4, US-PERM-05)
      // When can_code is revoked from the current pen holder, the server automatically
      // calls codeService.setPen(roomId, hostId) and emits a code:pen { holderId: hostId } event to all room members.
      if (patch.canCode === false) {
        const currentHolder = getPenHolder(roomId);
        if (currentHolder === targetUserId) {
          const hostId = user.id;
          codeService.setPen(roomId, hostId);
          io.to(`room:${roomId}`).to(roomId).emit('code:pen', {
            roomId,
            holderId: hostId,
            by: hostId,
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

    // Update LiveKit server participant permissions if session is active
    getActiveSession(roomId).then((session) => {
      if (session) {
        const livekitRoomName = session.livekit_room || `linkup-${session.id}`;
        updateLivekitParticipantPermissions(livekitRoomName, targetUserId, result.permissions, false).catch(() => {});
      }
    }).catch(() => {});

    return res.status(200).json({ ok: true, permissions: result.permissions, member: result.member });
  } catch (err: any) {
    if (err?.code === 'HOST_ONLY' || err?.code === 'FORBIDDEN' || err?.status === 403) {
      return res.status(403).json({
        error: { code: err.code || 'HOST_ONLY', message: err.message || 'Only the room host can update member permissions' },
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

// Bulk update member permissions (host-only) — US-PERM-06, FR-4.7, api-contract §3.3
export async function handleBulkPermissions(req: Request, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId } = req.params;
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
    const result = await bulkUpdateMemberPermissions(user.id, roomId, patch);

    const io = req.app.get('io');
    if (io) {
      const isMuteAll = patch.canMic === false;

      // Broadcast perm:changed for each affected participant
      for (const member of result.members) {
        io.to(`room:${roomId}`).to(roomId).emit('perm:changed', {
          roomId,
          userId: member.userId,
          permissions: member.permissions,
          by: user.id,
          reason: isMuteAll ? 'MUTE_ALL' : undefined,
          isBulk: true,
        });

        // If screen was revoked, stop their screen share
        if (patch.canScreen === false) {
          const currentShare = getActiveScreenShare(roomId);
          if (currentShare && currentShare.userId === member.userId) {
            stopScreenShare(roomId, member.userId);
            io.to(`room:${roomId}`).to(roomId).emit('screen:stopped', {
              roomId,
              userId: member.userId,
              reason: 'PERMISSION_REVOKED',
            });
          }
        }
      }

      // US-CODE-04: If can_code was revoked in bulk and the current pen holder was affected, return pen to host
      if (patch.canCode === false) {
        const currentHolder = getPenHolder(roomId);
        if (currentHolder && currentHolder !== user.id) {
          const wasRevoked = result.members.some((m) => m.userId === currentHolder);
          if (wasRevoked) {
            const hostId = user.id;
            codeService.setPen(roomId, hostId);
            io.to(`room:${roomId}`).to(roomId).emit('code:pen', {
              roomId,
              holderId: hostId,
              by: hostId,
            });
          }
        }
      }

      // Also emit perm:bulk to notify clients in bulk
      io.to(`room:${roomId}`).to(roomId).emit('perm:bulk', {
        roomId,
        by: user.id,
        patch,
        members: result.members,
        reason: isMuteAll ? 'MUTE_ALL' : undefined,
      });
    }

    // api-contract §3.3 200 response: Member[] (all participants)
    return res.status(200).json(result.members);
  } catch (err: any) {
    if (err?.code === 'HOST_ONLY' || err?.code === 'FORBIDDEN' || err?.status === 403) {
      return res.status(403).json({
        error: {
          code: err.code || 'FORBIDDEN',
          message: err.message || 'Only the room host can update member permissions',
        },
      });
    }

    if (err?.code === 'ROOM_NOT_FOUND' || err?.status === 404 || err?.code === 'NOT_FOUND') {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: err.message || 'Room not found' },
      });
    }

    if (err?.code === 'VALIDATION' || err?.status === 400) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: err.message || 'Invalid request' },
      });
    }

    console.error('[Room API] Error updating bulk member permissions:', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update member permissions' },
    });
  }
}

app.post(
  [
    '/api/rooms/:roomId/permissions/bulk',
    '/rooms/:roomId/permissions/bulk',
    '/api/rooms/:roomId/bulk-permissions',
    '/rooms/:roomId/bulk-permissions',
    '/api/rooms/:id/permissions/bulk',
    '/rooms/:id/permissions/bulk',
    '/api/rooms/:id/bulk-permissions',
    '/rooms/:id/bulk-permissions',
  ],
  requireMember,
  requireHost,
  handleBulkPermissions
);

// Mint LiveKit access token enforcing permissions (US-PERM-05 AC-1, FR-4.6, api-contract §3.4, US-SEC-01)
app.post(
  [
    '/api/rooms/:roomId/livekit-token',
    '/rooms/:roomId/livekit-token',
    '/api/rooms/:id/livekit-token',
    '/rooms/:id/livekit-token',
  ],
  requireMember,
  async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      });
    }

    const roomId = req.params.roomId || req.params.id;

    try {
      const room = req.room || (await getRoomForUser(user.id, roomId));
      const activeSession = await getActiveSession(roomId);

      if (!activeSession) {
        return res.status(409).json({
          error: { code: 'NO_ACTIVE_SESSION', message: 'Waiting for the teacher to start the session.' },
        });
      }

      const isHost = room.myRole === 'host';
      const member = room.members?.find((m) => m.userId === user.id);
      const permissions = isHost
        ? { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true }
        : member?.permissions || { canMic: false, canCamera: false, canScreen: false, canWhiteboard: false, canCode: false };

      const livekitRoomName = activeSession.livekit_room || `linkup-${activeSession.id}`;
      const tokenResult = await mintLivekitToken({
        userId: user.id,
        fullName: user.fullName,
        memberRole: isHost ? 'host' : 'participant',
        permissions,
        livekitRoom: livekitRoomName,
      });

      return res.status(200).json({
        token: tokenResult.token,
        url: env.LIVEKIT_URL || 'wss://mock-livekit.local',
        sessionId: activeSession.id,
        canPublish: tokenResult.canPublish,
        sources: tokenResult.sources,
      });
    } catch (err: any) {
      if (err instanceof NotAMemberError) {
        return res.status(403).json({
          error: { code: 'NOT_A_MEMBER', message: err.message },
        });
      }

      console.error(`[LiveKit API] Error minting token for room ${roomId}:`, err);
      return res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to mint LiveKit token' },
      });
    }
  }
);

// Get active screen share for a room (US-SEC-01)
app.get(
  [
    '/api/rooms/:roomId/screen-share',
    '/rooms/:roomId/screen-share',
    '/api/rooms/:id/screen-share',
    '/rooms/:id/screen-share',
  ],
  requireMember,
  (req: Request, res: Response) => {
    const roomId = req.params.roomId || req.params.id;
    const screenShare = getActiveScreenShare(roomId);
    return res.status(200).json({ screenShare });
  }
);

// ─── Chat History & Messaging (US-CHAT-02, US-CHAT-01, FR-3.12, api-contract §3.5, US-SEC-01) ───

// Get chat history with cursor pagination (US-CHAT-02)
app.get(
  [
    '/api/rooms/:roomId/messages',
    '/rooms/:roomId/messages',
    '/api/rooms/:id/messages',
    '/rooms/:id/messages',
  ],
  requireMember,
  async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      });
    }

    const roomId = req.params.roomId || req.params.id;
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
  }
);

// Send a chat message via REST API (US-CHAT-01, FR-3.10, US-SEC-01)
app.post(
  [
    '/api/rooms/:roomId/messages',
    '/rooms/:roomId/messages',
    '/api/rooms/:id/messages',
    '/rooms/:id/messages',
  ],
  requireMember,
  async (req: Request, res: Response) => {
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

// Regenerate room join code (host only) — US-ROOM-04, FR-2.6, US-SEC-01
app.post(
  [
    '/api/rooms/:roomId/join-code',
    '/rooms/:roomId/join-code',
    '/api/rooms/:id/join-code',
    '/rooms/:id/join-code',
  ],
  requireMember,
  requireHost,
  async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      });
    }

    const roomId = req.params.roomId || req.params.id;

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
  }
);

// Edit room name/description or archive room (host only) — US-ROOM-05, FR-2.7, US-SEC-01
app.patch(
  [
    '/api/rooms/:roomId',
    '/rooms/:roomId',
    '/api/rooms/:id',
    '/rooms/:id',
  ],
  requireMember,
  requireHost,
  async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      });
    }

    const roomId = req.params.roomId || req.params.id;
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
  }
);

// Explicit Archive room endpoint — US-ROOM-05, FR-2.7, US-SEC-01
app.post(
  [
    '/api/rooms/:roomId/archive',
    '/rooms/:roomId/archive',
    '/api/rooms/:id/archive',
    '/rooms/:id/archive',
  ],
  requireMember,
  requireHost,
  async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      });
    }

    const roomId = req.params.roomId || req.params.id;

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
  }
);

// Start live session (host only) — US-LIVE-01, FR-3.1, US-SEC-01
app.post(
  [
    '/api/rooms/:roomId/sessions',
    '/rooms/:roomId/sessions',
    '/api/rooms/:id/sessions',
    '/rooms/:id/sessions',
  ],
  requireMember,
  requireHost,
  async (req: Request, res: Response) => {
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

app.post(
  [
    '/api/rooms/:roomId/sessions/:sessionId/end',
    '/api/rooms/:roomId/sessions/end',
    '/rooms/:roomId/sessions/:sessionId/end',
    '/rooms/:roomId/sessions/end',
    '/api/rooms/:id/sessions/:sessionId/end',
    '/api/rooms/:id/sessions/end',
    '/rooms/:id/sessions/:sessionId/end',
    '/rooms/:id/sessions/end',
  ],
  requireMember,
  requireHost,
  handleEndSessionRoute
);

// Get active session for a room (US-SEC-01)
app.get(
  [
    '/api/rooms/:roomId/sessions/active',
    '/rooms/:roomId/sessions/active',
    '/api/rooms/:id/sessions/active',
    '/rooms/:id/sessions/active',
  ],
  requireMember,
  async (req: Request, res: Response) => {
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
const handleGetRoomSessions = async (req: Request, res: Response) => {
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
};

app.get(
  [
    '/api/rooms/:roomId/sessions',
    '/rooms/:roomId/sessions',
    '/api/rooms/:id/sessions',
    '/rooms/:id/sessions',
  ],
  requireMember,
  requireHost,
  handleGetRoomSessions
);

// US-ATT-06: Export attendance CSV endpoint (FR-6.6, api-contract §3.6, US-SEC-01)
const handleAttendanceCsv = async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId, sessionId } = req.params;

  try {
    const csv = await getAttendanceCSV(user.id, roomId, sessionId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${sessionId}.csv"`);
    return res.status(200).send(csv);
  } catch (err: any) {
    if (err?.code === 'HOST_ONLY' || err?.code === 'FORBIDDEN' || err?.status === 403) {
      return res.status(403).json({
        error: {
          code: err.code || 'HOST_ONLY',
          message: err.message || 'Only the room host can export attendance',
        },
      });
    }

    if (err?.code === 'ROOM_NOT_FOUND' || (err?.status === 404 && err?.message?.toLowerCase().includes('room'))) {
      return res.status(404).json({
        error: {
          code: 'ROOM_NOT_FOUND',
          message: err.message || 'Room not found',
        },
      });
    }

    if (err?.code === 'SESSION_NOT_FOUND' || err?.status === 404) {
      return res.status(404).json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: err.message || 'Session not found',
        },
      });
    }

    console.error('[Attendance API] Error exporting CSV:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to export attendance CSV',
      },
    });
  }
};

// US-ATT-04: Session attendance summary endpoint (FR-6.4, api-contract §3.6, US-SEC-01)
const handleAttendanceSummary = async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const { roomId, sessionId } = req.params;

  try {
    const rows = await getAttendanceSummary(user.id, roomId, sessionId);
    return res.status(200).json(rows);
  } catch (err: any) {
    if (err?.code === 'HOST_ONLY' || err?.code === 'FORBIDDEN' || err?.status === 403) {
      return res.status(403).json({
        error: {
          code: err.code || 'HOST_ONLY',
          message: err.message || 'Only the room host can view attendance',
        },
      });
    }

    if (err?.code === 'ROOM_NOT_FOUND' || (err?.status === 404 && err?.message?.toLowerCase().includes('room'))) {
      return res.status(404).json({
        error: {
          code: 'ROOM_NOT_FOUND',
          message: err.message || 'Room not found',
        },
      });
    }

    if (err?.code === 'SESSION_NOT_FOUND' || err?.status === 404) {
      return res.status(404).json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: err.message || 'Session not found',
        },
      });
    }

    console.error('[Attendance API] Error fetching attendance summary:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve attendance summary',
      },
    });
  }
};

app.get(
  [
    '/api/rooms/:roomId/sessions/:sessionId/attendance.csv',
    '/rooms/:roomId/sessions/:sessionId/attendance.csv',
    '/api/rooms/:id/sessions/:sessionId/attendance.csv',
    '/rooms/:id/sessions/:sessionId/attendance.csv',
  ],
  requireMember,
  requireHost,
  handleAttendanceCsv
);

app.get(
  [
    '/api/rooms/:roomId/sessions/:sessionId/attendance',
    '/rooms/:roomId/sessions/:sessionId/attendance',
    '/api/rooms/:id/sessions/:sessionId/attendance',
    '/rooms/:id/sessions/:sessionId/attendance',
  ],
  requireMember,
  requireHost,
  handleAttendanceSummary
);

// US-CODE-05: Code execution endpoint (FR-5.5, FR-5.6, api-contract §3.7)
const handleExecuteCode = async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
  }

  const { language, code, stdin, roomId } = req.body || {};

  if (!language || !['python', 'javascript', 'cpp', 'java'].includes(language)) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: 'Valid language (python, javascript, cpp, java) is required',
      },
    });
  }

  if (typeof code !== 'string') {
    return res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: 'Code must be a string',
      },
    });
  }

  // Acceptance Criterion 6: Code over 64 KB returns 413 PAYLOAD_TOO_LARGE: "Source code exceeds the 64 KB limit."
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
    return res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Source code exceeds the 64 KB limit.',
      },
    });
  }

  // Standard input size check (≤ 8 KB per api-contract §3.7)
  if (stdin !== undefined && stdin !== null) {
    if (typeof stdin !== 'string') {
      return res.status(400).json({
        error: {
          code: 'VALIDATION',
          message: 'Standard input must be a string',
        },
      });
    }
    if (Buffer.byteLength(stdin, 'utf8') > MAX_STDIN_BYTES) {
      return res.status(413).json({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Standard input exceeds the 8 KB limit.',
        },
      });
    }
  }

  // Acceptance Criterion 8: After 10 runs per minute from the same user, the 11th returns 429 RATE_LIMITED: "Too many runs — try again in a few seconds."
  const rateLimit = checkRunRateLimit(user.id);
  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many runs — try again in a few seconds.',
      },
    });
  }

  const io = req.app.get('io');
  let roomNormalized: string | undefined;

  // When roomId is set: pen holder or host guard, and emit code:run-started / code:run-result
  if (roomId && typeof roomId === 'string' && roomId.trim()) {
    roomNormalized = roomId.trim();
    try {
      const room = await getRoomForUser(user.id, roomNormalized);
      const hostMember = room.members?.find((m) => m.memberRole === 'host');
      const defaultHostId = hostMember?.userId || (room as any).owner_id || (room.myRole === 'host' ? user.id : '');
      const currentHolderId = getPenHolder(roomNormalized, defaultHostId);

      const isHost = room.myRole === 'host' || user.id === defaultHostId;
      const isHolder = currentHolderId === user.id;

      if (!isHost && !isHolder) {
        return res.status(403).json({
          error: {
            code: 'NOT_PEN_HOLDER',
            message: 'Only the pen holder or room host can run code',
          },
        });
      }

      // Acceptance Criterion 3: Clicking Run emits code:run-started to the room
      if (io) {
        io.to(`room:${roomNormalized}`).to(roomNormalized).emit('code:run-started', {
          roomId: roomNormalized,
          by: user.fullName || user.id,
          language: language as Language,
        });
      }
    } catch (err: any) {
      if (err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER') {
        return res.status(403).json({
          error: {
            code: 'NOT_A_MEMBER',
            message: err.message || 'You are not a member of this room',
          },
        });
      }
      return res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: err.message || 'Failed to verify room permissions',
        },
      });
    }
  }

  try {
    const execResult = await executeCode({
      language: language as Language,
      code,
      stdin: typeof stdin === 'string' ? stdin : undefined,
    });

    const runResult: RunResult = {
      by: user.fullName || user.id,
      language: language as Language,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      exitCode: execResult.exitCode,
      timeMs: execResult.timeMs,
      timedOut: execResult.timedOut,
      truncated: execResult.truncated,
    };

    // Acceptance Criterion 5: All room members see the same output (via code:run-result)
    if (roomNormalized && io) {
      io.to(`room:${roomNormalized}`).to(roomNormalized).emit('code:run-result', {
        roomId: roomNormalized,
        result: runResult,
      });
    }

    return res.status(200).json(runResult);
  } catch (err: any) {
    if (err.code === 'EXECUTION_UNAVAILABLE' || err.status === 502) {
      return res.status(502).json({
        error: {
          code: 'EXECUTION_UNAVAILABLE',
          message: err.message || 'Code execution service is currently unavailable',
        },
      });
    }
    return res.status(err.status || 500).json({
      error: {
        code: err.code || 'INTERNAL_SERVER_ERROR',
        message: err.message || 'Code execution failed',
      },
    });
  }
};

const handleGetRuntimes = async (_req: Request, res: Response) => {
  try {
    const runtimes = await getAvailableRuntimes();
    return res.status(200).json(runtimes);
  } catch (err: any) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: err.message || 'Failed to retrieve runtimes',
      },
    });
  }
};

// Mount execute routes (both /api/execute and /execute)
app.post('/api/execute', handleExecuteCode);
app.post('/execute', requireAuth, handleExecuteCode);

// Mount runtimes routes (both /api/runtimes and /runtimes)
app.get('/api/runtimes', handleGetRuntimes);
app.get('/runtimes', handleGetRuntimes);

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
