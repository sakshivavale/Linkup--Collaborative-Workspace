// LiveKit token endpoint
import { Request, Response } from 'express';
import { mintLivekitToken } from '../lib/livekit';
import { requireAuth } from '../middleware/auth';
import { z } from 'zod';

// Validate query parameters
const querySchema = z.object({
  roomId: z.string().min(1),
  identity: z.string().min(1),
});

export const registerLivekitTokenRoute = (app: import('express').Express) => {
  app.get('/api/livekit-token', requireAuth, async (req: Request, res: Response) => {
    const parse = querySchema.safeParse(req.query);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid query parameters' });
    }
    const { roomId, identity } = parse.data;

    // Auth middleware attaches user info to request
    const user = (req as any).user;
    const fullName = user?.full_name ?? 'Participant';
    const role = user?.role === 'teacher' ? 'host' : 'participant';

    try {
      const { token, canPublish, sources } = await mintLivekitToken({
        userId: identity,
        fullName,
        memberRole: role,
        livekitRoom: roomId,
      });
      res.json({ token, canPublish, sources });
    } catch (e: any) {
      console.error('[LiveKit] token generation failed:', e);
      res.status(500).json({ error: 'LiveKit token error' });
    }
  });
};

