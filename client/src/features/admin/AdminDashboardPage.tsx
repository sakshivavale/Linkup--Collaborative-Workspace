import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../../lib/socket';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { Logo } from '../../components/ui/Logo';
import {
  CheckCircle2,
  XCircle,
  LogOut,
  Radio,
  Loader2,
  Users,
  GraduationCap,
  ShieldCheck,
  Clock,
  ArrowRight,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { PlatformAnalyticsOverview } from '@linkup/shared';

interface PendingTeacher {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
  status?: string;
}

export const AdminDashboardPage: React.FC = () => {
  const { logout } = useAuth();
  const navigate = useNavigate();

  // State: Platform Analytics (US-3.1)
  const [analytics, setAnalytics] = useState<PlatformAnalyticsOverview>({
    totalUsers: 0,
    activeStudents: 0,
    approvedTeachers: 0,
    pendingApprovals: 0,
    activeRooms: 0,
  });
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [isUsingCached, setIsUsingCached] = useState(false);

  // State: Pending Teacher Verifications
  const [teachers, setTeachers] = useState<PendingTeacher[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // 1. Fetch Analytics Function (AC 3.1.1, AC 3.1.3)
  const fetchAnalytics = useCallback(async (isBackground = false) => {
    if (!isBackground) {
      setAnalyticsLoading(true);
    }
    try {
      const data = await api.get<PlatformAnalyticsOverview>('/api/admin/analytics/overview');
      if (data) {
        setAnalytics({
          totalUsers: Number(data.totalUsers ?? data.usersCount ?? 0),
          activeStudents: Number(data.activeStudents ?? data.studentsCount ?? 0),
          approvedTeachers: Number(data.approvedTeachers ?? data.approvedTeachersCount ?? 0),
          pendingApprovals: Number(data.pendingApprovals ?? data.pendingApprovalsCount ?? 0),
          activeRooms: Number(data.activeRooms ?? data.activeRoomsCount ?? 0),
        });
        setAnalyticsError(null);
        setIsUsingCached(false);
      }
    } catch (err: any) {
      console.warn('[Admin] Failed to fetch analytics overview:', err);
      setAnalyticsError('Unable to refresh real-time metrics.');
      setIsUsingCached(true);
    } finally {
      if (!isBackground) {
        setAnalyticsLoading(false);
      }
    }
  }, []);

  // 2. Fetch Pending Teachers
  const fetchPendingTeachers = useCallback(async () => {
    try {
      const res = await api.get<{ pendingTeachers: PendingTeacher[] }>('/api/admin/pending-teachers');
      if (res?.pendingTeachers) {
        setTeachers(res.pendingTeachers);
      }
    } catch (err) {
      console.warn('[Admin] Failed to load pending teachers from API:', err);
    } finally {
      setTeachersLoading(false);
    }
  }, []);

  // 3. Initial Load, 30s Periodic Auto-Refresh, & Real-Time WebSocket Events (AC 3.1.3)
  useEffect(() => {
    fetchAnalytics(false);
    fetchPendingTeachers();

    // AC 3.1.3: Background poll triggers every 30 seconds
    const pollInterval = setInterval(() => {
      fetchAnalytics(true);
    }, 30000);

    // Connect socket and join the admin room for real-time notifications
    if (!socket.connected) {
      socket.connect();
    }
    socket.emit('admin:join');

    // Real-Time Notification: listen for teacher_created event
    const onTeacherCreated = (newTeacher: PendingTeacher) => {
      setTeachers((prev) => {
        if (prev.some((t) => t.id === newTeacher.id)) return prev;
        return [newTeacher, ...prev];
      });
      fetchAnalytics(true);
    };

    // Real-Time Update: listen for teacher_verified event
    const onTeacherVerified = ({ id }: { id: string }) => {
      setTeachers((prev) => prev.filter((t) => t.id !== id));
      fetchAnalytics(true);
    };

    // General real-time push events
    const onAnalyticsRefresh = () => {
      fetchAnalytics(true);
    };

    socket.on('teacher_created', onTeacherCreated);
    socket.on('teacher_verified', onTeacherVerified);
    socket.on('analytics_updated', onAnalyticsRefresh);
    socket.on('session:started', onAnalyticsRefresh);
    socket.on('session:ended', onAnalyticsRefresh);

    return () => {
      clearInterval(pollInterval);
      socket.off('teacher_created', onTeacherCreated);
      socket.off('teacher_verified', onTeacherVerified);
      socket.off('analytics_updated', onAnalyticsRefresh);
      socket.off('session:started', onAnalyticsRefresh);
      socket.off('session:ended', onAnalyticsRefresh);
    };
  }, [fetchAnalytics, fetchPendingTeachers]);

  // 4. Action Handlers (PATCH /admin/verify-teacher/:id)
  const handleVerify = async (id: string, status: 'approved' | 'rejected') => {
    setProcessingId(id);

    // Optimistic UI updates
    setTeachers((prev) => prev.filter((t) => t.id !== id));
    setAnalytics((prev) => ({
      ...prev,
      pendingApprovals: Math.max(0, prev.pendingApprovals - 1),
      approvedTeachers: status === 'approved' ? prev.approvedTeachers + 1 : prev.approvedTeachers,
    }));

    try {
      await api.patch(`/api/admin/verify-teacher/${id}`, { status });
    } catch (err) {
      console.error(`[Admin] Failed to set status ${status} for teacher ${id}:`, err);
    } finally {
      setProcessingId(null);
      // Synchronize latest server counters smoothly
      fetchAnalytics(true);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const scrollToQueue = () => {
    const queueElement = document.getElementById('approvals-queue');
    if (queueElement) {
      queueElement.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen ambient-bg flex flex-col transition-colors duration-300">
      {/* Header */}
      <header className="border-b border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-[#090d16]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size="sm" showText={true} />
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <Radio className="w-3 h-3 animate-pulse text-emerald-500" />
              <span>Real-Time Sync</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:text-red-600 dark:text-slate-300 dark:hover:text-red-400 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        {/* Title & Manual Refresh */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
              Platform Analytics Overview
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              Real-time platform adoption metrics, teacher verification queue, and live workspace capacity.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchAnalytics(false)}
              disabled={analyticsLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 shadow-sm transition-all disabled:opacity-50"
              title="Refresh Analytics Counters"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${analyticsLoading ? 'animate-spin' : ''}`} />
              <span>Refresh Metrics</span>
            </button>
          </div>
        </div>

        {/* AC 3.1.3: Error & Retry Banner if analytics request fails */}
        {analyticsError && (
          <div
            id="analytics-error-banner"
            className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-4 text-xs text-amber-800 dark:text-amber-200 animate-fadeIn"
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <div>
                <span className="font-semibold">{analyticsError}</span>
                {isUsingCached && (
                  <span className="ml-1 opacity-90">(Displaying cached platform values)</span>
                )}
              </div>
            </div>
            <button
              id="analytics-retry-btn"
              onClick={() => fetchAnalytics(false)}
              className="px-3 py-1.5 rounded-lg font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-100 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* AC 3.1.1: 5 Distinct KPI Cards */}
        <section className="mb-10" aria-label="Platform Analytics Overview">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Core Platform Metrics
            </h2>
            <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Auto-refreshes every 30s
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* KPI Card 1: Total Users */}
            <div
              id="card-total-users"
              className="glass-panel p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Users</span>
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Users className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div
                  id="stat-total-users"
                  data-testid="analytics-total-users"
                  className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white"
                >
                  {analyticsLoading && !isUsingCached ? (
                    <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded-lg" />
                  ) : (
                    analytics.totalUsers
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Registered profiles across all roles
                </p>
              </div>
            </div>

            {/* KPI Card 2: Active Students */}
            <div
              id="card-active-students"
              className="glass-panel p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Active Students</span>
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <GraduationCap className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div
                  id="stat-active-students"
                  data-testid="analytics-active-students"
                  className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white"
                >
                  {analyticsLoading && !isUsingCached ? (
                    <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded-lg" />
                  ) : (
                    analytics.activeStudents
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Users where role === 'STUDENT'
                </p>
              </div>
            </div>

            {/* KPI Card 3: Approved Teachers */}
            <div
              id="card-approved-teachers"
              className="glass-panel p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Approved Teachers</span>
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div
                  id="stat-approved-teachers"
                  data-testid="analytics-approved-teachers"
                  className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white"
                >
                  {analyticsLoading && !isUsingCached ? (
                    <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded-lg" />
                  ) : (
                    analytics.approvedTeachers
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Teachers with isApproved === true
                </p>
              </div>
            </div>

            {/* KPI Card 4: Pending Approvals (AC 3.1.2) */}
            <div
              id="card-pending-approvals"
              className="glass-panel p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Pending Approvals</span>
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Clock className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div
                  id="stat-pending-approvals"
                  data-testid="analytics-pending-approvals"
                  className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white"
                >
                  {analyticsLoading && !isUsingCached ? (
                    <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded-lg" />
                  ) : (
                    analytics.pendingApprovals
                  )}
                </div>

                {/* AC 3.1.2: Dynamic Highlight of Pending Queue Urgency */}
                <div className="mt-2.5">
                  {analytics.pendingApprovals > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      <span
                        id="pending-urgency-badge"
                        data-testid="pending-urgency-badge"
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-300/40 dark:border-amber-500/30 w-fit"
                      >
                        {analytics.pendingApprovals} Pending Review
                      </span>
                      <a
                        href="#approvals-queue"
                        id="review-queue-link"
                        data-testid="review-queue-link"
                        onClick={(e) => {
                          e.preventDefault();
                          scrollToQueue();
                        }}
                        className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 hover:underline transition-all group"
                      >
                        <span>Review Queue</span>
                        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                      </a>
                    </div>
                  ) : (
                    <div
                      id="all-caught-up"
                      data-testid="all-caught-up"
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span>All Caught Up</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* KPI Card 5: Active Rooms */}
            <div
              id="card-active-rooms"
              className="glass-panel p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Active Rooms</span>
                <div className="p-2 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                  <Radio className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div
                  id="stat-active-rooms"
                  data-testid="analytics-active-rooms"
                  className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white"
                >
                  {analyticsLoading && !isUsingCached ? (
                    <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded-lg" />
                  ) : (
                    analytics.activeRooms
                  )}
                </div>
                <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Live Workspaces</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pending Teacher Verification Queue Section */}
        <section id="approvals-queue" className="scroll-mt-20">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
                Pending Teacher Verifications
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Review and approve incoming instructor registration requests.
              </p>
            </div>
            <span
              id="queue-count-badge"
              className="px-3 py-1 rounded-xl text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-300/30 dark:border-amber-500/30"
            >
              {teachers.length} Pending
            </span>
          </div>

          {/* Verification Table */}
          <div className="glass-panel rounded-2xl border border-slate-200/80 dark:border-slate-800/80 overflow-hidden shadow-sm">
            {teachersLoading ? (
              <div className="p-12 flex flex-col items-center justify-center gap-3 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                <span className="text-xs font-medium">Loading requests...</span>
              </div>
            ) : teachers.length === 0 ? (
              <div className="p-12 text-center text-slate-500 dark:text-slate-400">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  No pending teacher verification requests
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  New teacher signups will appear here automatically via real-time sync.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
                      <th className="py-3 px-4">Teacher Name</th>
                      <th className="py-3 px-4">Email</th>
                      <th className="py-3 px-4">Registration Timestamp</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                    {teachers.map((teacher) => {
                      const formattedDate = teacher.createdAt
                        ? new Date(teacher.createdAt).toLocaleString(undefined, {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })
                        : 'Just now';

                      const isBusy = processingId === teacher.id;

                      return (
                        <tr
                          key={teacher.id}
                          className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors animate-fadeIn"
                        >
                          <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white">
                            {teacher.fullName}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                            {teacher.email}
                          </td>
                          <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {formattedDate}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="inline-flex items-center gap-2">
                              <button
                                id={`approve-${teacher.id}`}
                                disabled={isBusy}
                                onClick={() => handleVerify(teacher.id, 'approved')}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all active:scale-95 disabled:opacity-50"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Approve</span>
                              </button>
                              <button
                                id={`reject-${teacher.id}`}
                                disabled={isBusy}
                                onClick={() => handleVerify(teacher.id, 'rejected')}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-600 dark:bg-slate-800 dark:hover:bg-red-500/20 dark:text-slate-300 dark:hover:text-red-400 transition-all active:scale-95 disabled:opacity-50"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Reject</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
