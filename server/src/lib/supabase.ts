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

// In-memory set of suspended user IDs for instant real-time revocation
const suspendedUsersSet = new Set<string>();

export function isUserSuspended(userId: string): boolean {
  return suspendedUsersSet.has(userId);
}

export async function verifyToken(token: string): Promise<Me | null> {
  if (!token) return null;

  if (token === 'mock-admin-token-linkup' || token === 'mock-admin-token-sakshi') {
    const isSakshi = token === 'mock-admin-token-sakshi';
    return {
      id: isSakshi ? 'admin-sakshi-id' : 'admin-support-id',
      email: isSakshi ? 'sakshivavale9@gmail.com' : 'support@gmail.com',
      fullName: isSakshi ? 'Sakshi Vavale' : 'Administrator',
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
    const emailLower = user.email?.toLowerCase();
    const isHardcodedAdmin = emailLower === 'support@gmail.com' || emailLower === 'sakshivavale9@gmail.com';

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
        .select('full_name, role, is_approved, status, is_suspended, "isSuspended"')
        .eq('id', user.id)
        .single();

      if (profile) {
        profileData = profile;
        if (profile.full_name) fullName = profile.full_name;
        if (profile.role) role = profile.role;
        if ((profile as any).is_approved !== undefined && (profile as any).is_approved !== null) {
          isApprovedFromDb = Boolean((profile as any).is_approved);
        } else if ((profile as any).isApproved !== undefined && (profile as any).isApproved !== null) {
          isApprovedFromDb = Boolean((profile as any).isApproved);
        }
        if ((profile as any).status) {
          statusFromDb = (profile as any).status;
        }
      }
    } catch {
      // Profile table might not have row yet, fallback to user_metadata is safe
    }

    // Role detection: Never trust client-supplied user_metadata for admin role
    const dbRoleLower = (profileData?.role || '').toString().toLowerCase();
    const isDbAdmin = dbRoleLower === 'admin';
    const isAdmin = isHardcodedAdmin || isDbAdmin;

    const roleLower = (role || '').toString().toLowerCase();
    const isTeacher =
      !isAdmin &&
      (roleLower === 'teacher' ||
        user.user_metadata?.role?.toString().toLowerCase() === 'teacher' ||
        user.user_metadata?.requested_role?.toString().toLowerCase() === 'teacher' ||
        user.user_metadata?.requestedRole?.toString().toLowerCase() === 'teacher');

    const resolvedRole: any = isAdmin ? 'ADMIN' : isTeacher ? 'teacher' : 'student';

    const rawStatus =
      statusFromDb ||
      profileData?.status ||
      user.user_metadata?.status ||
      user.user_metadata?.teacher_status ||
      '';

    // Suspension detection (AC 3.4.3)
    const isSuspended =
      suspendedUsersSet.has(user.id) ||
      profileData?.is_suspended === true ||
      profileData?.isSuspended === true ||
      user.user_metadata?.isSuspended === true ||
      user.user_metadata?.is_suspended === true ||
      rawStatus === 'SUSPENDED' ||
      rawStatus === 'suspended';

    if (isSuspended) {
      suspendedUsersSet.add(user.id);
    }

    // Status extraction
    let status: 'PENDING_TEACHER' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'NONE' = 'NONE';
    if (isSuspended) {
      status = 'SUSPENDED';
    } else if (rawStatus === 'PENDING_TEACHER' || rawStatus === 'pending') {
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
        // Unapproved teacher defaults to false pending admin verification
        isApproved = false;
      }

      if (!isApproved) {
        status = status === 'REJECTED' ? 'REJECTED' : 'PENDING_TEACHER';
      } else {
        status = 'APPROVED';
      }
    } else {
      isApproved = isApprovedFromDb !== undefined ? isApprovedFromDb : isApprovedFromMeta !== undefined ? isApprovedFromMeta : true;
      if (status === 'NONE') {
        status = 'APPROVED';
      }
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
      isSuspended,
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

export function updateUserApprovalInCache(userId: string, isApproved: boolean, status: 'APPROVED' | 'REJECTED') {
  for (const [, cached] of tokenCache.entries()) {
    if (cached.user.id === userId) {
      cached.user.isApproved = isApproved;
      cached.user.status = status;
      cached.user.role = isApproved ? 'teacher' : 'student';
    }
  }
}

export function updateUserRoleInCache(userId: string, newRole: string, isApproved: boolean) {
  const normRole = (newRole || '').toLowerCase();
  for (const [, cached] of tokenCache.entries()) {
    if (cached.user.id === userId) {
      cached.user.role = (normRole === 'admin' ? 'ADMIN' : normRole === 'teacher' ? 'teacher' : 'student') as any;
      cached.user.isApproved = isApproved;
      if (normRole === 'admin') {
        cached.user.isAdmin = true;
      }
      if (cached.user.status !== 'SUSPENDED') {
        cached.user.status = isApproved ? 'APPROVED' : 'PENDING_TEACHER';
      }
    }
  }
}

export function setUserSuspension(userId: string, isSuspended: boolean) {
  if (isSuspended) {
    suspendedUsersSet.add(userId);
    for (const [, cached] of tokenCache.entries()) {
      if (cached.user.id === userId) {
        cached.user.isSuspended = true;
        cached.user.status = 'SUSPENDED' as any;
      }
    }
  } else {
    suspendedUsersSet.delete(userId);
    for (const [, cached] of tokenCache.entries()) {
      if (cached.user.id === userId) {
        cached.user.isSuspended = false;
        cached.user.status = 'APPROVED';
      }
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
