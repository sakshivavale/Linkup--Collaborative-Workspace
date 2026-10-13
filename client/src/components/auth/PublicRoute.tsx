import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Loader2 } from 'lucide-react';

interface PublicRouteProps {
  children: React.ReactNode;
}

export const PublicRoute: React.FC<PublicRouteProps> = ({ children }) => {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen ambient-bg flex items-center justify-center p-4">
        <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600 dark:text-indigo-400" />
          <span className="text-sm font-medium">Loading LinkUp...</span>
        </div>
      </div>
    );
  }

  if (session) {
    // If user is already authenticated, redirect to Dashboard
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
