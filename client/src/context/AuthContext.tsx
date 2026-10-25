import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { api, HttpError } from '../lib/api';
import { socket } from '../lib/socket';
import { UserRole, TeacherApprovalStatus } from '../types/auth';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: UserRole | null;
  isApproved: boolean;
  status: TeacherApprovalStatus;
  fullName: string;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  checkStatus: () => Promise<{ isApproved: boolean; role: UserRole; status: TeacherApprovalStatus } | null>;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  logout: () => Promise<void>;
  resetPasswordForEmail: (email: string, customRedirectTo?: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: AuthError | null }>;
  updateProfileName: (newName: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [customFullName, setCustomFullName] = useState<string | null>(null);
  const [serverRole, setServerRole] = useState<UserRole | null>(null);
  const [serverStatus, setServerStatus] = useState<TeacherApprovalStatus | null>(null);
  const [serverIsApproved, setServerIsApproved] = useState<boolean | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const res = await api.get<{
        user: {
          id: string;
          fullName: string;
          role: UserRole;
          isApproved?: boolean;
          status?: TeacherApprovalStatus;
        };
      }>('/api/me');

      if (res?.user) {
        if (res.user.role) setServerRole(res.user.role);
        if (res.user.status) setServerStatus(res.user.status);
        if (res.user.isApproved !== undefined) setServerIsApproved(res.user.isApproved);
        if (res.user.fullName) setCustomFullName(res.user.fullName);

        const currentRole = res.user.role;
        const currentStatus = res.user.status || 'NONE';
        const currentApproved = res.user.isApproved !== undefined
          ? res.user.isApproved
          : currentRole.toLowerCase() !== 'teacher' || currentStatus === 'APPROVED';

        return {
          isApproved: currentApproved,
          role: currentRole,
          status: currentStatus,
        };
      }
      return null;
    } catch (err) {
      console.warn('[LinkUp Auth] checkStatus query failed:', err);
      return null;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    await checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    // 1. Initial session check from local storage
    const initSession = async () => {
      try {
        const { data: { session: initialSession }, error } = await supabase.auth.getSession();
        if (error) {
          console.error('[LinkUp Auth] Error retrieving session:', error.message);
        }
        if (initialSession) {
          setSession(initialSession);
          setUser(initialSession.user ?? null);
          refreshProfile();
        } else {
          // Check for persistent local admin session
          const savedAdmin = localStorage.getItem('linkup_admin_session');
          if (savedAdmin) {
            try {
              const parsed = JSON.parse(savedAdmin);
              setSession(parsed);
              setUser(parsed.user);
            } catch {
              localStorage.removeItem('linkup_admin_session');
            }
          }
        }
      } catch (err) {
        console.error('[LinkUp Auth] Unexpected error retrieving session:', err);
      } finally {
        setLoading(false);
      }
    };

    initSession();

    // 2. Real-time auth state listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (currentSession) {
        setSession(currentSession);
        setUser(currentSession.user ?? null);
        refreshProfile();
      } else {
        const savedAdmin = localStorage.getItem('linkup_admin_session');
        if (savedAdmin) {
          try {
            const parsed = JSON.parse(savedAdmin);
            setSession(parsed);
            setUser(parsed.user);
          } catch {
            setSession(null);
            setUser(null);
          }
        } else {
          setSession(null);
          setUser(null);
        }
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [refreshProfile]);

  const signIn = async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();
    const isHardcodedAdmin = cleanEmail === 'support@gmail.com' && password === '12345678';

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (error && isHardcodedAdmin) {
      // Auto-provision or fallback for hardcoded super admin from any device
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: 'Administrator',
            role: 'ADMIN',
            status: 'APPROVED',
            isApproved: true,
            is_approved: true,
          },
        },
      });

      if (!signUpError && signUpData.session) {
        setSession(signUpData.session);
        setUser(signUpData.user);
        return { error: null };
      }

      // Universal device fallback session for support@gmail.com
      const mockAdminUser: any = {
        id: 'admin-support-id',
        email: 'support@gmail.com',
        user_metadata: {
          full_name: 'Administrator',
          role: 'ADMIN',
          status: 'APPROVED',
          isApproved: true,
          is_approved: true,
        },
      };
      const mockAdminSession: any = {
        access_token: 'mock-admin-token-linkup',
        user: mockAdminUser,
      };
      localStorage.setItem('linkup_admin_session', JSON.stringify(mockAdminSession));
      setSession(mockAdminSession);
      setUser(mockAdminUser);
      return { error: null };
    }

    if (!error && data.session) {
      setSession(data.session);
      setUser(data.user);
    }

    return { error };
  };

  const signOut = async () => {
    try {
      localStorage.removeItem('linkup_admin_session');
      await supabase.auth.signOut();
    } catch (error) {
      console.error('[LinkUp Auth] Error during sign out:', error);
    } finally {
      localStorage.removeItem('linkup_admin_session');
      setSession(null);
      setUser(null);
      setCustomFullName(null);
    }
  };

  const resetPasswordForEmail = async (email: string, customRedirectTo?: string) => {
    // Determine the frontend base URL (respects VITE_APP_URL, VITE_SITE_URL, or window.location.origin)
    const rawBaseUrl =
      import.meta.env.VITE_APP_URL ||
      import.meta.env.VITE_SITE_URL ||
      (typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'http://localhost:5173');
    const baseUrl = rawBaseUrl.replace(/\/+$/, '');
    const redirectTo = customRedirectTo || `${baseUrl}/reset-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo }
    );
    return { error };
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    return { error };
  };

  const updateProfileName = async (newName: string): Promise<{ success: boolean; error?: string }> => {
    const trimmed = newName.trim();
    if (!trimmed) {
      return { success: false, error: 'Full name cannot be empty or whitespace only' };
    }
    if (trimmed.length > 100) {
      return { success: false, error: 'Full name cannot exceed 100 characters' };
    }

    try {
      // 1. Send PATCH /api/me to update name in database
      const res = await api.patch<{ user: { id: string; fullName: string; role: string; email: string } }>(
        '/api/me',
        { fullName: trimmed }
      );

      const resolvedName = res?.user?.fullName || trimmed;

      // 2. Immediately update local reactive state
      setCustomFullName(resolvedName);

      // 3. Update Supabase auth user metadata in background for session persistence
      try {
        await supabase.auth.updateUser({
          data: { full_name: resolvedName, fullName: resolvedName },
        });
      } catch (metaErr) {
        console.warn('[LinkUp Auth] Non-fatal background auth metadata update:', metaErr);
      }

      return { success: true };
    } catch (err: any) {
      console.error('[LinkUp Auth] Error updating profile name:', err);
      const message =
        err instanceof HttpError
          ? err.message
          : err?.message || 'Failed to update profile name';
      return { success: false, error: message };
    }
  };

  // 3. Real-time approval listener for instant teacher status update
  useEffect(() => {
    if (!user?.id) return;

    const onTeacherVerified = (data: { id?: string; status?: string; role?: string; is_verified?: boolean }) => {
      if (data?.id && data.id !== user.id) return;
      const approved =
        data?.status === 'APPROVED' ||
        data?.status === 'approved' ||
        data?.is_verified === true;
      setServerStatus(approved ? 'APPROVED' : 'REJECTED');
      setServerRole(approved ? 'teacher' : 'student');
      refreshProfile();
    };

    socket.on('teacher_verified', onTeacherVerified);
    socket.on('teacher_status_updated', onTeacherVerified);

    const profileChannel = supabase
      .channel(`profile-sync-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        (payload: any) => {
          const rec = payload.new;
          if (rec) {
            const approved =
              rec.isApproved === true ||
              rec.is_approved === true ||
              rec.status === 'approved' ||
              rec.status === 'APPROVED';
            setServerStatus(approved ? 'APPROVED' : rec.status === 'rejected' ? 'REJECTED' : 'PENDING_TEACHER');
            setServerRole(approved ? ((rec.role as UserRole) || 'teacher') : 'student');
            refreshProfile();
          }
        }
      )
      .subscribe();

    return () => {
      socket.off('teacher_verified', onTeacherVerified);
      socket.off('teacher_status_updated', onTeacherVerified);
      profileChannel.unsubscribe();
    };
  }, [user?.id, refreshProfile]);

  const fullName =
    customFullName ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    'User';

  const isAdmin =
    user?.email?.toLowerCase() === 'support@gmail.com' ||
    (user?.user_metadata?.role || '').toLowerCase() === 'admin' ||
    serverRole === 'admin' ||
    serverRole === 'ADMIN';

  const rawStatus = serverStatus || user?.user_metadata?.status || user?.user_metadata?.teacher_status;
  let status: TeacherApprovalStatus = 'NONE';
  if (isAdmin) {
    status = 'APPROVED';
  } else if (rawStatus === 'PENDING_TEACHER' || rawStatus === 'pending') {
    status = 'PENDING_TEACHER';
  } else if (rawStatus === 'APPROVED' || rawStatus === 'approved') {
    status = 'APPROVED';
  } else if (rawStatus === 'REJECTED' || rawStatus === 'rejected') {
    status = 'REJECTED';
  }

  const requestedRole = (
    user?.user_metadata?.requested_role ||
    user?.user_metadata?.requestedRole ||
    user?.user_metadata?.role ||
    serverRole ||
    ''
  ).toString().toLowerCase();

  const isTeacherUser = requestedRole === 'teacher';

  const effectiveRole: UserRole = isAdmin
    ? 'ADMIN'
    : status === 'PENDING_TEACHER'
    ? 'student'
    : status === 'APPROVED' && isTeacherUser
    ? 'teacher'
    : serverRole
    ? serverRole
    : isTeacherUser
    ? 'teacher'
    : 'student';

  const isApproved: boolean =
    isAdmin ||
    (serverIsApproved !== null
      ? serverIsApproved
      : user?.user_metadata?.isApproved !== undefined
        ? Boolean(user.user_metadata.isApproved)
        : user?.user_metadata?.is_approved !== undefined
          ? Boolean(user.user_metadata.is_approved)
          : status === 'APPROVED'
            ? true
            : status === 'PENDING_TEACHER'
              ? false
              : effectiveRole.toLowerCase() !== 'teacher');

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        role: effectiveRole,
        isApproved,
        status,
        fullName,
        loading,
        refreshProfile,
        checkStatus,
        signIn,
        signOut,
        logout: signOut,
        resetPasswordForEmail,
        updatePassword,
        updateProfileName,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
