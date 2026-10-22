import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { api, HttpError } from '../lib/api';
import { UserRole, TeacherApprovalStatus } from '../types/auth';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: UserRole | null;
  status: TeacherApprovalStatus;
  fullName: string;
  loading: boolean;
  refreshProfile: () => Promise<void>;
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

  const refreshProfile = useCallback(async () => {
    try {
      const res = await api.get<{
        user: {
          id: string;
          fullName: string;
          role: UserRole;
          status?: TeacherApprovalStatus;
        };
      }>('/api/me');

      if (res?.user) {
        if (res.user.role) setServerRole(res.user.role);
        if (res.user.status) setServerStatus(res.user.status);
        if (res.user.fullName) setCustomFullName(res.user.fullName);
      }
    } catch {
      // Ignore background refresh failure on network drop
    }
  }, []);

  useEffect(() => {
    // 1. Initial session check from local storage
    const initSession = async () => {
      try {
        const { data: { session: initialSession }, error } = await supabase.auth.getSession();
        if (error) {
          console.error('[LinkUp Auth] Error retrieving session:', error.message);
        }
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
        if (initialSession) {
          refreshProfile();
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
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      if (currentSession) {
        refreshProfile();
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [refreshProfile]);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (!error && data.session) {
      setSession(data.session);
      setUser(data.user);
    }

    return { error };
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('[LinkUp Auth] Error during sign out:', error);
    } finally {
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

  const fullName =
    customFullName ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    'User';

  const rawStatus = serverStatus || user?.user_metadata?.status || user?.user_metadata?.teacher_status;
  let status: TeacherApprovalStatus = 'NONE';
  if (rawStatus === 'PENDING_TEACHER' || rawStatus === 'pending') {
    status = 'PENDING_TEACHER';
  } else if (rawStatus === 'APPROVED' || rawStatus === 'approved') {
    status = 'APPROVED';
  } else if (rawStatus === 'REJECTED' || rawStatus === 'rejected') {
    status = 'REJECTED';
  }

  const effectiveRole = serverRole || (status === 'PENDING_TEACHER' ? 'student' : (user?.user_metadata?.role as UserRole) || 'student');

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        role: effectiveRole,
        status,
        fullName,
        loading,
        refreshProfile,
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
