import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import { Me } from '@linkup/shared';

const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = createClient(env.SUPABASE_URL, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

interface CachedUser {
  user: Me;
  expiresAt: number;
}

// In-memory 60s cache of token -> user
const tokenCache = new Map<string, CachedUser>();
const CACHE_TTL_MS = 60 * 1000;

export async function verifyToken(token: string): Promise<Me | null> {
  if (!token) return null;

  const now = Date.now();
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > now) {
    return cached.user;
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      tokenCache.delete(token);
      return null;
    }

    // Attempt to load profile if available, fallback to user metadata
    let fullName = (user.user_metadata?.full_name as string) || (user.user_metadata?.fullName as string) || user.email?.split('@')[0] || 'User';
    let role = (user.user_metadata?.role as 'teacher' | 'student') || 'student';

    // If database profile exists, fetch it
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', user.id)
        .single();

      if (profile) {
        if (profile.full_name) fullName = profile.full_name;
        if (profile.role) role = profile.role as 'teacher' | 'student';
      }
    } catch {
      // Profile table might not have row yet, fallback to user_metadata is safe
    }

    const authUser: Me = {
      id: user.id,
      email: user.email || '',
      fullName,
      role,
    };

    tokenCache.set(token, {
      user: authUser,
      expiresAt: now + CACHE_TTL_MS,
    });

    return authUser;
  } catch (err) {
    console.error('[Supabase Auth] Error verifying token:', err);
    return null;
  }
}

export function clearTokenCache(token?: string) {
  if (token) {
    tokenCache.delete(token);
  } else {
    tokenCache.clear();
  }
}

export function updateTokenCacheUserName(userId: string, newFullName: string) {
  for (const [, cached] of tokenCache.entries()) {
    if (cached.user.id === userId) {
      cached.user.fullName = newFullName;
    }
  }
}

export function setCachedUser(token: string, user: Me, ttlMs: number = CACHE_TTL_MS) {
  tokenCache.set(token, {
    user,
    expiresAt: Date.now() + ttlMs,
  });
}

export function getUserNameFromCache(userId: string): string | undefined {
  for (const [, cached] of tokenCache.entries()) {
    if (cached.user.id === userId && cached.user.fullName) {
      return cached.user.fullName;
    }
  }
  return undefined;
}
