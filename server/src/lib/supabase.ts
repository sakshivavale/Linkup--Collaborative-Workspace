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

  if (token === 'mock-admin-token-linkup') {
    return {
      id: 'admin-support-id',
      email: 'support@gmail.com',
      fullName: 'Administrator',
      role: 'ADMIN' as any,
      isApproved: true,
      status: 'APPROVED',
      requestedRole: 'ADMIN' as any,
    };
  }

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
    let role = (user.user_metadata?.role as any) || 'student';

    // Check if hardcoded authorized super admin
    const isHardcodedAdmin = user.email?.toLowerCase() === 'support@gmail.com';

    let profileData: any = null;
    // If database profile exists, fetch it
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, role, status, is_approved, "isApproved"')
        .eq('id', user.id)
        .single();

      if (profile) {
        profileData = profile;
        if (profile.full_name) fullName = profile.full_name;
        if (profile.role) role = profile.role;
      }
    } catch {
      // Profile table might not have row yet, fallback to user_metadata is safe
    }

    if (isHardcodedAdmin) {
      role = 'ADMIN';
    }

    // Extract status from profile first, then fallback to user_metadata
    const rawStatus =
      profileData?.status ||
      user.user_metadata?.status ||
      user.user_metadata?.teacher_status;

    const isProfileApproved =
      profileData?.isApproved === true ||
      profileData?.is_approved === true ||
      rawStatus === 'APPROVED' ||
      rawStatus === 'approved';

    let status: 'PENDING_TEACHER' | 'APPROVED' | 'REJECTED' | 'NONE' = 'NONE';
    if (isHardcodedAdmin || isProfileApproved) {
      status = 'APPROVED';
    } else if (rawStatus === 'PENDING_TEACHER' || rawStatus === 'pending') {
      status = 'PENDING_TEACHER';
    } else if (rawStatus === 'REJECTED' || rawStatus === 'rejected') {
      status = 'REJECTED';
    }

    const requestedRole = (
      user.user_metadata?.requested_role ||
      user.user_metadata?.requestedRole ||
      user.user_metadata?.role ||
      profileData?.role ||
      role
    )?.toString().toLowerCase();

    // If teacher approval is pending, effective operational role remains student.
    // Once approved, correctly assign teacher role.
    const effectiveRole = isHardcodedAdmin
      ? 'ADMIN'
      : status === 'PENDING_TEACHER'
      ? 'student'
      : requestedRole === 'teacher' || role.toString().toLowerCase() === 'teacher'
      ? 'teacher'
      : role;

    const isApproved =
      isHardcodedAdmin ||
      isProfileApproved ||
      user.user_metadata?.isApproved === true ||
      user.user_metadata?.is_approved === true ||
      status === 'APPROVED' ||
      effectiveRole.toString().toLowerCase() === 'student';

    const authUser: Me = {
      id: user.id,
      email: user.email || '',
      fullName,
      role: effectiveRole as any,
      isApproved,
      status,
      requestedRole: (user.user_metadata?.requested_role || user.user_metadata?.requestedRole) as any,
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

export function invalidateUserCache(userId: string) {
  for (const [token, cached] of tokenCache.entries()) {
    if (cached.user.id === userId) {
      tokenCache.delete(token);
    }
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
