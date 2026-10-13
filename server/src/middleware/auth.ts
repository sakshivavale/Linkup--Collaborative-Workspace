import { Request, Response, NextFunction, RequestHandler } from 'express';
import { Me, ApiErrorResponse } from '@linkup/shared';
import { verifyToken } from '../lib/supabase';

// Augment Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: Me;
    }
  }
}

/**
 * Express middleware to enforce valid Supabase access token on API routes.
 * Acceptance criteria: Any GET/POST/PATCH/DELETE to /api/* without a valid
 * Authorization: Bearer <token> header returns 401 UNAUTHENTICATED.
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
