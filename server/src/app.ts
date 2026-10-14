import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { requireAuth } from './middleware/auth';

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
