import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { Logo } from '../../components/ui/Logo';
import {
  ShieldAlert,
  Clock,
  RefreshCw,
  DoorOpen,
  Mail,
  CheckCircle2,
  AlertCircle,
  LogOut,
} from 'lucide-react';

/**
 * US-2.1: Teacher Feature Protection & Pending Approval Gate
 * AC 2.1.2: Visual Elements of "Pending Admin Approval" Screen
 */
export const PendingApprovalPage: React.FC = () => {
  const navigate = useNavigate();
  const { fullName, checkStatus, logout } = useAuth();

  const [isChecking, setIsChecking] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'info' | 'error';
    message: string;
  } | null>(null);

  // If already approved, offer quick redirect
  const handleCheckStatus = async () => {
    setIsChecking(true);
    setFeedback(null);

    try {
      // AC 2.1.2: Queries GET /api/me without requiring a full re-login
      const result = await checkStatus();

      if (result?.isApproved) {
        setFeedback({
          type: 'success',
          message: 'Account verified! Your teacher credentials have been approved. Redirecting to workspace...',
        });
        setTimeout(() => {
          navigate('/', { replace: true });
        }, 1500);
      } else {
        setFeedback({
          type: 'info',
          message: 'Your account is still pending administrator review. Please check back shortly.',
        });
      }
    } catch {
      setFeedback({
        type: 'error',
        message: 'Unable to verify status at this moment. Please check your internet connection or try again.',
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleJoinAsParticipant = () => {
    // Navigate to dashboard where user can join classrooms via join code as participant
    navigate('/');
  };

  const handleSignOut = async () => {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      console.error('[PendingApproval] Logout failed:', err);
    }
  };

  return (
    <div className="min-h-screen ambient-bg flex flex-col justify-between selection:bg-indigo-500 selection:text-white transition-colors duration-300">
      {/* Top Navbar */}
      <header className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-lg">
          <Logo size="md" showText={true} />
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            id="pending-logout-btn"
            data-testid="pending-logout-btn"
            type="button"
            onClick={handleSignOut}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-all"
            title="Sign out of current account"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Content Card */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-xl">
          <div className="glass-panel p-8 sm:p-10 rounded-3xl relative overflow-hidden border border-amber-200/60 dark:border-amber-500/20 shadow-2xl shadow-amber-500/5">
            {/* Ambient Background Glow */}
            <div className="absolute -right-20 -top-20 w-64 h-64 bg-amber-500/10 dark:bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -left-20 -bottom-20 w-64 h-64 bg-indigo-500/10 dark:bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col items-center text-center">
              {/* AC 2.1.2: Animated status badge / illustration depicting "Account Under Review" */}
              <div
                id="pending-approval-badge-container"
                data-testid="pending-approval-badge-container"
                className="relative mb-6"
              >
                {/* Pulsing radar rings */}
                <span className="absolute -inset-3 rounded-full bg-amber-400/20 dark:bg-amber-500/20 animate-ping opacity-75" />
                <span className="absolute -inset-1.5 rounded-full bg-amber-400/30 dark:bg-amber-500/30 animate-pulse" />

                <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-400 dark:from-amber-600 dark:to-amber-500 text-white flex items-center justify-center shadow-lg shadow-amber-500/30">
                  <Clock className="w-10 h-10 animate-spin-slow" />
                  <div className="absolute -bottom-1 -right-1 p-1 bg-white dark:bg-slate-900 rounded-full shadow">
                    <ShieldAlert className="w-5 h-5 text-amber-500" />
                  </div>
                </div>
              </div>

              {/* Status Badge */}
              <div
                id="account-under-review-badge"
                data-testid="account-under-review-badge"
                className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-bold tracking-wide uppercase bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 mb-4"
              >
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span>Account Under Review</span>
              </div>

              {/* Heading */}
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-3">
                Teacher Verification in Progress
              </h1>

              {/* Greeting */}
              {fullName && (
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Hello, <span className="text-indigo-600 dark:text-indigo-400 font-semibold">{fullName}</span>
                </p>
              )}

              {/* AC 2.1.2: Informational Copy */}
              <p
                id="pending-approval-copy"
                data-testid="pending-approval-copy"
                className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-lg mb-8"
              >
                Your teacher credentials are being reviewed by the LinkUp administration team. Room creation and classroom moderation tools will activate automatically once approved.
              </p>

              {/* Feedback Alert if present */}
              {feedback && (
                <div
                  id="pending-status-feedback"
                  data-testid="pending-status-feedback"
                  role="status"
                  className={`w-full mb-6 p-4 rounded-2xl text-xs font-medium flex items-center gap-3 transition-all ${
                    feedback.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30'
                      : feedback.type === 'info'
                      ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30'
                      : 'bg-rose-50 dark:bg-rose-500/10 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30'
                  }`}
                >
                  {feedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-500" />
                  ) : feedback.type === 'info' ? (
                    <Clock className="w-4 h-4 flex-shrink-0 text-indigo-500" />
                  ) : (
                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-500" />
                  )}
                  <span className="flex-1 text-left">{feedback.message}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="w-full flex flex-col sm:flex-row items-center gap-3 mb-8">
                {/* AC 2.1.2: Check Status / Refresh Button */}
                <button
                  id="check-status-btn"
                  data-testid="check-status-btn"
                  type="button"
                  onClick={handleCheckStatus}
                  disabled={isChecking}
                  className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white shadow-lg shadow-indigo-600/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-indigo-600/40"
                >
                  <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
                  <span>{isChecking ? 'Checking Status...' : 'Check Status / Refresh'}</span>
                </button>

                {/* AC 2.1.2: Join Room as Participant secondary action button */}
                <button
                  id="join-as-participant-btn"
                  data-testid="join-as-participant-btn"
                  type="button"
                  onClick={handleJoinAsParticipant}
                  className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-all"
                >
                  <DoorOpen className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Join Room as Participant</span>
                </button>
              </div>

              {/* AC 2.1.2: Administrative contact email link */}
              <div
                id="admin-contact-section"
                data-testid="admin-contact-section"
                className="w-full pt-6 border-t border-slate-200/70 dark:border-slate-800 text-center"
              >
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Need expedited review or have administrative questions?{' '}
                  <span className="block sm:inline mt-1 sm:mt-0">
                    Reach our admin team at{' '}
                    <a
                      id="admin-contact-email"
                      data-testid="admin-contact-email"
                      href="mailto:support@linkup.internal"
                      className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
                    >
                      <Mail className="w-3.5 h-3.5 inline" />
                      <span>support@linkup.internal</span>
                    </a>
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-center text-xs text-slate-400 dark:text-slate-600">
        &copy; {new Date().getFullYear()} LinkUp Collaborative Workspace. All rights reserved.
      </footer>
    </div>
  );
};

export default PendingApprovalPage;
