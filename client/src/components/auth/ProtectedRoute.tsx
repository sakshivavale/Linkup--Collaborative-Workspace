import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen ambient-bg flex items-center justify-center p-4">
        <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600 dark:text-indigo-400" />
          <span className="text-sm font-medium">Checking session...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    // Redirect to /login after logout or when unauthorized
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};
