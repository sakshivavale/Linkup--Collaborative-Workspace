import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  PISTON_URL: z
    .string()
    .optional()
    .transform((val) => val || process.env.PISTON_API_URL || 'https://emkc.org/api/v2/piston'),
  PISTON_API_URL: z.string().optional(),
  PISTON_API_KEY: z.string().optional(),
  JUDGE0_URL: z.string().default('https://judge0-ce.p.rapidapi.com'),
  JUDGE0_API_KEY: z.string().optional(),
  LIVEKIT_URL: z.string().default('wss://mock-livekit.local'),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[Config] Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
