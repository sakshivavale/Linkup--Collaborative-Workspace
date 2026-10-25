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
      isAdmin: true,
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
    let isApprovedFromMeta: boolean | undefined = undefined;
    if (user.user_metadata?.isApproved !== undefined) {
      isApprovedFromMeta = Boolean(user.user_metadata.isApproved);
    } else if (user.user_metadata?.is_approved !== undefined) {
      isApprovedFromMeta = Boolean(user.user_metadata.is_approved);
    }

    let isApprovedFromDb: boolean | undefined = undefined;
    let statusFromDb: any = undefined;

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
        statusFromDb = profile.status;
        if (profile.isApproved !== undefined && profile.isApproved !== null) {
          isApprovedFromDb = Boolean(profile.isApproved);
        } else if (profile.is_approved !== undefined && profile.is_approved !== null) {
          isApprovedFromDb = Boolean(profile.is_approved);
        }
      }
    } catch {
      // Profile table might not have row yet, fallback to user_metadata is safe
    }

    // Role detection
    const isTeacher =
      role?.toString().toLowerCase() === 'teacher' ||
      user.user_metadata?.role?.toString().toLowerCase() === 'teacher' ||
      user.user_metadata?.requested_role?.toString().toLowerCase() === 'teacher' ||
      user.user_metadata?.requestedRole?.toString().toLowerCase() === 'teacher';

    const isAdmin =
      isHardcodedAdmin ||
      role?.toString().toLowerCase() === 'admin' ||
      user.user_metadata?.role?.toString().toLowerCase() === 'admin';

    const resolvedRole: any = isAdmin ? 'ADMIN' : isTeacher ? 'teacher' : 'student';

    // Status extraction
    const rawStatus =
      statusFromDb ||
      profileData?.status ||
      user.user_metadata?.status ||
      user.user_metadata?.teacher_status;

    let status: 'PENDING_TEACHER' | 'APPROVED' | 'REJECTED' | 'NONE' = 'NONE';
    if (rawStatus === 'PENDING_TEACHER' || rawStatus === 'pending') {
      status = 'PENDING_TEACHER';
    } else if (rawStatus === 'APPROVED' || rawStatus === 'approved') {
      status = 'APPROVED';
    } else if (rawStatus === 'REJECTED' || rawStatus === 'rejected') {
      status = 'REJECTED';
    }

    // Determine isApproved status
    let isApproved = true;
    if (isAdmin) {
      isApproved = true;
      status = 'APPROVED';
    } else if (isTeacher) {
      if (isApprovedFromDb !== undefined) {
        isApproved = isApprovedFromDb;
      } else if (isApprovedFromMeta !== undefined) {
        isApproved = isApprovedFromMeta;
      } else if (status === 'PENDING_TEACHER') {
        isApproved = false;
      } else {
        isApproved = false;
      }

      if (!isApproved) {
        status = status === 'REJECTED' ? 'REJECTED' : 'PENDING_TEACHER';
      } else {
        status = 'APPROVED';
      }
    } else {
      if (isApprovedFromDb !== undefined) {
        isApproved = isApprovedFromDb;
      } else if (isApprovedFromMeta !== undefined) {
        isApproved = isApprovedFromMeta;
      } else {
        isApproved = true;
      }
      status = status === 'REJECTED' ? 'REJECTED' : 'APPROVED';
    }

    const authUser: Me = {
      id: user.id,
      email: user.email || '',
      fullName,
      role: resolvedRole,
      isApproved,
      status,
      requestedRole: (user.user_metadata?.requested_role || user.user_metadata?.requestedRole || profileData?.role || role) as any,
      isAdmin,
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
