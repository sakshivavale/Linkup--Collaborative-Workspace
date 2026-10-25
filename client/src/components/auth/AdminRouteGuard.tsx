import React, { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Loader2 } from 'lucide-react';

interface AdminRouteGuardProps {
  children?: React.ReactNode;
}

/**
 * US-2.2: Administrative Route Guarding & RBAC Middleware
 * AC 2.2.1: Non-Admin Navigation Attempt to /admin Web Routes:
 *   - Intercepts navigation from users with role === 'STUDENT' or role === 'TEACHER'
 *   - Redirects the user to '/'
 *   - Shows a toast: "Access Denied: Administrator privileges required."
 * 
 * AC 2.2.2: Unauthenticated Visitor Access Attempt:
 *   - When navigating to any /admin/* path
 *   - Redirects to /login?redirect=/admin
 */
export const AdminRouteGuard: React.FC<AdminRouteGuardProps> = ({ children }) => {
  const { session, role, isApproved, loading } = useAuth();
  const location = useLocation();

  // Trigger toast notification when access is denied for an authenticated non-admin
  useEffect(() => {
    if (!loading && session) {
      const roleUpper = (role || '').toUpperCase();
      const isAdmin = roleUpper === 'ADMIN' && isApproved === true;
      if (!isAdmin) {
        // Dispatch toast notification event for global listeners
        window.dispatchEvent(
          new CustomEvent('linkup:toast', {
            detail: {
              type: 'error',
              message: 'Access Denied: Administrator privileges required.',
            },
          })
        );
      }
    }
  }, [loading, session, role, isApproved]);

  if (loading) {
    return (
      <div className="min-h-screen ambient-bg flex items-center justify-center p-4 text-slate-500 dark:text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-7 h-7 text-indigo-600 dark:text-indigo-400 animate-spin" />
          <span className="text-sm font-medium">Verifying administrator credentials...</span>
        </div>
      </div>
    );
  }

  // AC 2.2.2: Unauthenticated visitor access attempt -> Redirect to /login?redirect=/admin
  if (!session) {
    return <Navigate to="/login?redirect=/admin" state={{ from: location }} replace />;
  }

  // AC 2.2.1: Check if user has role === 'ADMIN' and isApproved === true
  const roleUpper = (role || '').toUpperCase();
  const isAdmin = roleUpper === 'ADMIN' && isApproved === true;

  // If authenticated user is NOT an approved admin (e.g. STUDENT or TEACHER), redirect to / with toast state
  if (!isAdmin) {
    return (
      <Navigate
        to="/"
        state={{
          flash: 'ADMIN_ACCESS_DENIED',
          message: 'Access Denied: Administrator privileges required.',
        }}
        replace
      />
    );
  }

  // Approved admin receives platform access
  return children ? <>{children}</> : <Outlet />;
};

export default AdminRouteGuard;
