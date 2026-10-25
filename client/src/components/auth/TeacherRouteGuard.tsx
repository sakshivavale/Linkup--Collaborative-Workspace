import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Loader2 } from 'lucide-react';

interface TeacherRouteGuardProps {
  children?: React.ReactNode;
}

/**
 * US-2.1: Teacher Feature Protection & Pending Approval Gate
 * AC 2.1.1: Route guard that intercepts navigation to teacher-only routes (e.g. /create-room)
 * and redirects unapproved teachers (role === 'TEACHER' and isApproved === false) to /pending-approval.
 */
export const TeacherRouteGuard: React.FC<TeacherRouteGuardProps> = ({ children }) => {
  const { session, role, isApproved, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen ambient-bg flex items-center justify-center p-4 text-slate-500 dark:text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-7 h-7 text-indigo-600 dark:text-indigo-400 animate-spin" />
          <span className="text-sm font-medium">Verifying teacher credentials...</span>
        </div>
      </div>
    );
  }

  // If not authenticated, redirect to login
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const isTeacher = role?.toLowerCase() === 'teacher';

  // AC 2.1.1: Given an authenticated user with role === 'TEACHER' and isApproved === false
  // Then the application route guard intercepts navigation and redirects to /pending-approval.
  if (isTeacher && !isApproved) {
    return <Navigate to="/pending-approval" replace />;
  }

  // Non-teachers (students) are redirected to the main dashboard
  if (!isTeacher) {
    return <Navigate to="/" replace />;
  }

  // Approved teacher receives platform access
  return children ? <>{children}</> : <Outlet />;
};

export default TeacherRouteGuard;
