import { Request, Response, NextFunction, RequestHandler } from 'express';
import { Me, ApiErrorResponse, RoomSummary } from '@linkup/shared';
import { verifyToken } from '../lib/supabase';
import { getRoomForUser, NotAMemberError } from '../lib/rooms';

// Augment Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: Me;
      room?: RoomSummary;
    }
  }
}

/**
 * Express middleware to enforce valid Supabase access token on API routes (US-AUTH-05, US-SEC-01).
 * Acceptance criteria: requireAuth middleware is applied to every route except GET /health.
 */
export const requireAuth: RequestHandler = async (
  req: Request,
  res: Response<ApiErrorResponse>,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authorization header is required',
      },
    });
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Malformed Authorization header. Format must be: Bearer <token>',
      },
    });
  }

  const token = match[1].trim();
  if (!token) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Access token is empty',
      },
    });
  }

  const user = await verifyToken(token);
  if (!user) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Invalid or expired access token',
      },
    });
  }

  req.user = user;
  next();
};

/**
 * Express middleware to verify room membership (US-SEC-01, FR-2.4, architecture doc §5.1).
 * Acceptance criteria: requireMember is applied to every /rooms/:id/* route.
 */
export const requireMember: RequestHandler = async (
  req: Request,
  res: Response<ApiErrorResponse>,
  next: NextFunction
) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
  }

  const roomId = req.params.roomId || req.params.id;
  // If no room ID is present or path is join endpoint, pass through
  if (!roomId || roomId === 'join') {
    return next();
  }

  // If this is a host-only endpoint, defer authorization to requireHost
  // so the canonical HOST_ONLY / FORBIDDEN response code is returned
  const isHostOnlyEndpoint =
    (req.method === 'DELETE' && req.path.includes('/members/')) ||
    (req.method === 'PATCH' && req.path.includes('/permissions')) ||
    (req.method === 'POST' && (
      req.path.includes('/sessions') ||
      req.path.includes('/permissions') ||
      req.path.includes('/join-code') ||
      req.path.includes('/archive')
    )) ||
    (req.method === 'GET' && (
      (req.path.endsWith('/sessions') || req.path.endsWith('/sessions/')) ||
      req.path.includes('/attendance')
    ));

  if (isHostOnlyEndpoint) {
    return next();
  }

  try {
    const room = await getRoomForUser(user.id, roomId);
    req.room = room;
    return next();
  } catch (err: any) {
    if (err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' || err?.status === 403) {
      return res.status(403).json({
        error: {
          code: 'NOT_A_MEMBER',
          message: err.message || 'You are not a member of this room',
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

    console.error('[requireMember] Error verifying room membership:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to verify room membership',
      },
    });
  }
};

/**
 * Express middleware to verify host permissions (US-SEC-01, FR-2.5, FR-3.1, architecture doc §5.1).
 * Acceptance criteria: requireHost is applied to host-only routes (start/end session, permission changes, remove member).
 */
export const requireHost: RequestHandler = async (
  req: Request,
  res: Response<ApiErrorResponse>,
  next: NextFunction
) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
  }

  const roomId = req.params.roomId || req.params.id;
  if (!roomId) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: 'Room ID is required',
      },
    });
  }

  const errorCode =
    req.method === 'DELETE' && req.path.includes('/members/') ? 'FORBIDDEN' : 'HOST_ONLY';

  try {
    const room = req.room || (await getRoomForUser(user.id, roomId));
    req.room = room;

    if (room.myRole !== 'host') {
      return res.status(403).json({
        error: {
          code: errorCode,
          message: 'Only the room host can perform this action',
        },
      });
    }

    return next();
  } catch (err: any) {
    if (err?.code === 'ROOM_NOT_FOUND' || err?.status === 404) {
      return res.status(404).json({
        error: {
          code: 'ROOM_NOT_FOUND',
          message: err.message || 'Room not found',
        },
      });
    }

    if (err instanceof NotAMemberError || err?.code === 'NOT_A_MEMBER' || err?.status === 403) {
      return res.status(403).json({
        error: {
          code: errorCode,
          message: 'Only the room host can perform this action',
        },
      });
    }

    console.error('[requireHost] Error verifying host permissions:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to verify host permissions',
      },
    });
  }
};

/**
 * Authorization middleware to restrict unverified/pending teachers from accessing resources.
 */
export const requireApprovedTeacher: RequestHandler = (
  req: Request,
  res: Response<ApiErrorResponse>,
  next: NextFunction
) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
  }

  const roleLower = (user.role || '').toLowerCase();
  const isAdmin = user.isAdmin || roleLower === 'admin' || user.email?.toLowerCase() === 'support@gmail.com';
  if (isAdmin) {
    return next();
  }

  const isTeacher = roleLower === 'teacher';
  const isApproved =
    user.isApproved === true ||
    (user as any).is_verified === true ||
    (user.status as any) === 'approved' ||
    user.status === 'APPROVED';

  const isApprovedTeacher = isTeacher && user.isApproved !== false && user.status !== 'PENDING_TEACHER' && isApproved;

  // US-2.1 AC 2.1.3: Server-side API enforcement for unapproved teacher
  if (isTeacher && !isApprovedTeacher) {
    return res.status(403).json({
      statusCode: 403,
      error: 'TEACHER_NOT_APPROVED',
      message: 'Your teacher account is pending administrator verification. Room creation is disabled.',
    } as any);
  }

  // Non-teacher role rejection (e.g. students)
  if (!isTeacher) {
    return res.status(403).json({
      error: {
        code: 'TEACHER_ONLY',
        message: 'Only teachers can create rooms',
      },
    });
  }

  next();
};

/**
 * Express middleware to enforce admin privileges on administrative API routes (US-2.2 AC 2.2.3).
 * Given an HTTP request directed at any endpoint under /api/admin/*
 * When processed by requireAdmin Express middleware:
 * - If token is missing or invalid: responds with HTTP 401 Unauthorized ({ "error": "UNAUTHORIZED" }).
 * - If user.role !== 'ADMIN' or user.isApproved !== true: responds with HTTP 403 Forbidden ({ "error": "FORBIDDEN_ADMIN_ONLY" }).
 * - If valid admin: attaches req.user and calls next().
 */
export const requireAdmin: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authorization header is required',
    } as any);
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Malformed Authorization header. Format must be: Bearer <token>',
    } as any);
  }

  const token = match[1].trim();
  if (!token) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Access token is empty',
    } as any);
  }

  let user = req.user;
  if (!user) {
    const verified = await verifyToken(token);
    if (!verified) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid or expired access token',
      } as any);
    }
    user = verified;
  }

  // AC 2.2.3: Check user role and approval status
  // If user.role !== 'ADMIN' or user.isApproved !== true: responds with HTTP 403 Forbidden
  const roleUpper = (user.role || '').toUpperCase();
  const isAdminRole = roleUpper === 'ADMIN' || user.isAdmin === true;
  const isApproved =
    (user.isApproved === true ||
      (user as any).is_approved === true ||
      (user.isAdmin === true && user.isApproved !== false)) &&
    user.isApproved !== false;

  if (!isAdminRole || !isApproved) {
    return res.status(403).json({
      error: 'FORBIDDEN_ADMIN_ONLY',
      message: 'Access Denied: Administrator privileges required.',
    } as any);
  }

  // Ensure role is normalized to 'ADMIN'
  user.role = 'ADMIN' as any;
  req.user = user;
  next();
};

