import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
  Search,
  UserCheck,
  LayoutDashboard,
  UserPlus,
  Key,
  Copy,
  Check,
  X,
} from 'lucide-react';
import { PlatformAnalyticsOverview } from '@linkup/shared';
import { AddTeacherModal } from './AddTeacherModal';

interface PendingTeacher {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
  status?: string;
  subject?: string;
  notes?: string;
}

interface NotificationState {
  type: 'success' | 'info' | 'error';
  message: string;
}

export const AdminDashboardPage: React.FC = () => {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Active Tab: /admin vs /admin/approvals vs /admin/users
  const isApprovalsOnly = location.pathname.includes('/approvals');
  const [activeTab, setActiveTab] = useState<'overview' | 'approvals'>(
    isApprovalsOnly ? 'approvals' : 'overview'
  );

  useEffect(() => {
    if (location.pathname.includes('/approvals')) {
      setActiveTab('approvals');
    } else {
      setActiveTab('overview');
    }
  }, [location.pathname]);

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

  // State: Pending Teacher Verifications (US-3.2)
  const [teachers, setTeachers] = useState<PendingTeacher[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<'approved' | 'rejected' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [notification, setNotification] = useState<NotificationState | null>(null);

  // State: Direct Teacher Provisioning (US-3.3)
  const [isAddTeacherOpen, setIsAddTeacherOpen] = useState(false);
  const [provisionedCredentials, setProvisionedCredentials] = useState<{
    fullName: string;
    email: string;
    temporaryPassword?: string;
    department?: string;
  } | null>(null);
  const [copiedCredentials, setCopiedCredentials] = useState(false);

  // 1. Fetch Analytics Overview (AC 3.1.1, AC 3.1.3)
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

  // 2. Fetch Pending Teachers Queue (AC 3.2.1)
  const fetchPendingTeachers = useCallback(async () => {
    try {
      const res = await api.get<{ pendingTeachers?: PendingTeacher[]; teachers?: PendingTeacher[] }>(
        '/api/admin/pending-teachers'
      );
      const list = res?.pendingTeachers || res?.teachers || [];
      setTeachers(list);
    } catch (err) {
      console.warn('[Admin] Failed to load pending teachers from API:', err);
    } finally {
      setTeachersLoading(false);
    }
  }, []);

  // 3. Initial Load, 30s Periodic Auto-Refresh, & Real-Time WebSocket Events (AC 3.1.3, AC 3.2.1)
  useEffect(() => {
    fetchAnalytics(false);
    fetchPendingTeachers();

    const pollInterval = setInterval(() => {
      fetchAnalytics(true);
      fetchPendingTeachers();
    }, 30000);

    if (!socket.connected) {
      socket.connect();
    }
    socket.emit('admin:join');

    const onTeacherCreated = (newTeacher: PendingTeacher) => {
      setTeachers((prev) => {
        if (prev.some((t) => t.id === newTeacher.id)) return prev;
        return [newTeacher, ...prev];
      });
      fetchAnalytics(true);
    };

    const onTeacherVerified = ({ id }: { id: string }) => {
      setTeachers((prev) => prev.filter((t) => t.id !== id));
      fetchAnalytics(true);
    };

    const onAnalyticsRefresh = () => {
      fetchAnalytics(true);
      fetchPendingTeachers();
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

  // 4. Action Handlers: Admin Approves / Rejects Teacher Application (AC 3.2.2, AC 3.2.3)
  const handleVerify = async (teacher: PendingTeacher, targetStatus: 'approved' | 'rejected') => {
    setProcessingId(teacher.id);
    setActionType(targetStatus);

    const isApprove = targetStatus === 'approved';

    // Optimistic UI updates
    setTeachers((prev) => prev.filter((t) => t.id !== teacher.id));
    setAnalytics((prev) => ({
      ...prev,
      pendingApprovals: Math.max(0, prev.pendingApprovals - 1),
      approvedTeachers: isApprove ? prev.approvedTeachers + 1 : prev.approvedTeachers,
    }));

    try {
      const payload = {
        isApproved: isApprove,
        status: isApprove ? 'APPROVED' : 'REJECTED',
      };

      // AC 3.2.2: PATCH /api/admin/users/:userId/approval
      await api.patch(`/api/admin/users/${teacher.id}/approval`, payload);

      if (isApprove) {
        setNotification({
          type: 'success',
          message: `Teacher ${teacher.fullName} has been approved successfully.`,
        });
      } else {
        setNotification({
          type: 'info',
          message: 'Teacher application has been rejected.',
        });
      }
    } catch (err: any) {
      console.error(`[Admin] Failed to ${targetStatus} teacher ${teacher.id}:`, err);
      // Revert optimistic removal if error
      setTeachers((prev) => [teacher, ...prev]);
      setNotification({
        type: 'error',
        message: `Failed to update approval for ${teacher.fullName}. Please try again.`,
      });
    } finally {
      setProcessingId(null);
      setActionType(null);
      fetchAnalytics(true);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const filteredTeachers = teachers.filter((t) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.fullName?.toLowerCase().includes(q) ||
      t.email?.toLowerCase().includes(q) ||
      t.subject?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen ambient-bg flex flex-col transition-colors duration-300">
      {/* Header */}
      <header className="border-b border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-[#090d16]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
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
        {/* Navigation Tabs (AC 3.2.1) */}
        <div className="flex items-center justify-between flex-wrap gap-4 mb-6 border-b border-slate-200/80 dark:border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <button
              id="overview-tab-btn"
              data-testid="overview-tab"
              onClick={() => {
                setActiveTab('overview');
                navigate('/admin');
              }}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'overview'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Platform Overview</span>
            </button>

            <button
              id="approvals-tab-btn"
              data-testid="approvals-tab"
              onClick={() => {
                setActiveTab('approvals');
                navigate('/admin/approvals');
              }}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'approvals'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span>Teacher Approvals</span>
              {teachers.length > 0 && (
                <span
                  id="tab-pending-badge"
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                    activeTab === 'approvals'
                      ? 'bg-white/20 text-white'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
                  }`}
                >
                  {teachers.length}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="add-teacher-btn"
              data-testid="add-teacher-btn"
              onClick={() => setIsAddTeacherOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all active:scale-95"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ Add Teacher</span>
            </button>

            <button
              id="refresh-btn"
              data-testid="refresh-btn"
              onClick={() => {
                fetchAnalytics(false);
                fetchPendingTeachers();
              }}
              disabled={analyticsLoading || teachersLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 shadow-sm transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${analyticsLoading || teachersLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* AC 3.3.2: Provisioned Credentials Banner */}
        {provisionedCredentials && (
          <div
            id="provisioned-credentials-card"
            data-testid="provisioned-credentials-card"
            className="mb-6 p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-950 dark:text-emerald-100 animate-fadeIn"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">New Teacher Provisioned Successfully</h3>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
                    Share these temporary credentials with the instructor. They are pre-approved and can log in immediately.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setProvisionedCredentials(null)}
                className="p-1 rounded-lg hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 transition-colors"
                aria-label="Dismiss credentials"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-emerald-500/20 shadow-sm">
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  Full Name
                </span>
                <span className="text-xs font-bold text-slate-900 dark:text-white mt-1 block">
                  {provisionedCredentials.fullName}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-emerald-500/20 shadow-sm">
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  Institutional Email
                </span>
                <span className="text-xs font-bold text-slate-900 dark:text-white mt-1 block select-all">
                  {provisionedCredentials.email}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-emerald-500/20 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                    Temporary Password
                  </span>
                  <span className="text-xs font-mono font-bold text-emerald-700 dark:text-emerald-300 mt-1 block select-all">
                    {provisionedCredentials.temporaryPassword || '••••••••'}
                  </span>
                </div>
                {provisionedCredentials.temporaryPassword && (
                  <button
                    id="copy-provisioned-creds-btn"
                    data-testid="copy-provisioned-creds-btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `Email: ${provisionedCredentials.email}\nTemporary Password: ${provisionedCredentials.temporaryPassword}`
                        );
                        setCopiedCredentials(true);
                        setTimeout(() => setCopiedCredentials(false), 2000);
                      } catch {}
                    }}
                    className="p-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-all active:scale-95 shadow-sm"
                    title="Copy email and temporary password"
                  >
                    {copiedCredentials ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Global Notification Banner (AC 3.2.2, AC 3.2.3) */}
        {notification && (
          <div
            id="admin-notification-toast"
            data-testid="admin-notification-toast"
            className={`mb-6 p-4 rounded-2xl flex items-center justify-between gap-3 text-xs font-semibold animate-fadeIn border ${
              notification.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30'
                : notification.type === 'error'
                ? 'bg-red-500/10 text-red-800 dark:text-red-300 border-red-500/30'
                : 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {notification.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
              ) : notification.type === 'error' ? (
                <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
              )}
              <span id="admin-notification-message" data-testid="admin-notification-message">
                {notification.message}
              </span>
            </div>
            <button
              id="dismiss-notification-btn"
              onClick={() => setNotification(null)}
              className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 opacity-70 hover:opacity-100 transition-opacity"
              aria-label="Dismiss notification"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* AC 3.1.3: Error & Retry Banner if analytics query fails */}
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

        {/* Platform Analytics Overview (Shown on Overview tab) */}
        {activeTab === 'overview' && (
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
              {/* Card 1: Total Users */}
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

              {/* Card 2: Active Students */}
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

              {/* Card 3: Approved Teachers */}
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

              {/* Card 4: Pending Approvals (AC 3.1.2) */}
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
                        <button
                          id="review-queue-link"
                          data-testid="review-queue-link"
                          onClick={() => {
                            setActiveTab('approvals');
                            navigate('/admin/approvals');
                          }}
                          className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 hover:underline transition-all group w-fit"
                        >
                          <span>Review Queue</span>
                          <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                        </button>
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

              {/* Card 5: Active Rooms */}
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
        )}

        {/* Teacher Approval Queue Section (AC 3.2.1, AC 3.2.2, AC 3.2.3) */}
        <section id="approvals-queue" className="scroll-mt-20">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                  Teacher Approval Queue
                </h2>
                <span
                  id="queue-count-badge"
                  data-testid="queue-count-badge"
                  className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-300/40 dark:border-amber-500/30"
                >
                  {teachers.length} Pending
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Review pending instructor applications with real-time verification and instant privilege provisioning.
              </p>
            </div>

            {/* Search Filter Input */}
            <div className="relative min-w-[240px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="teacher-search-input"
                data-testid="teacher-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search teacher by name or email..."
                className="w-full pl-9 pr-3 py-1.5 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Teacher Queue Table (AC 3.2.1) */}
          <div className="glass-panel rounded-2xl border border-slate-200/80 dark:border-slate-800/80 overflow-hidden shadow-sm">
            {teachersLoading ? (
              <div className="p-12 flex flex-col items-center justify-center gap-3 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                <span className="text-xs font-medium">Loading approval queue...</span>
              </div>
            ) : filteredTeachers.length === 0 ? (
              <div className="p-12 text-center text-slate-500 dark:text-slate-400">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {searchQuery ? 'No teacher applications match your filter' : 'No pending teacher applications'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {searchQuery
                    ? 'Try clearing the search query to see all applications.'
                    : 'All teacher applications have been reviewed! New requests will appear automatically.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
                      <th className="py-3 px-4">Instructor Name</th>
                      <th className="py-3 px-4">Email Address</th>
                      <th className="py-3 px-4">Registration Timestamp</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                    {filteredTeachers.map((teacher) => {
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
                          id={`teacher-row-${teacher.id}`}
                          data-testid={`teacher-row-${teacher.id}`}
                          className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors animate-fadeIn"
                        >
                          <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-[11px]">
                                {teacher.fullName?.charAt(0)?.toUpperCase() || 'T'}
                              </div>
                              <div>
                                <div>{teacher.fullName}</div>
                                {teacher.subject && (
                                  <span className="text-[10px] text-slate-400">{teacher.subject}</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                            {teacher.email}
                          </td>
                          <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {formattedDate}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-300/40 dark:border-amber-500/30">
                              Pending Review
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="inline-flex items-center gap-2">
                              {/* AC 3.2.2: Approve Button */}
                              <button
                                id={`approve-${teacher.id}`}
                                data-testid={`approve-btn-${teacher.id}`}
                                disabled={isBusy}
                                onClick={() => handleVerify(teacher, 'approved')}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all active:scale-95 disabled:opacity-50"
                                title="Approve instructor application"
                              >
                                {isBusy && actionType === 'approved' ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                )}
                                <span>Approve</span>
                              </button>

                              {/* AC 3.2.3: Reject Button */}
                              <button
                                id={`reject-${teacher.id}`}
                                data-testid={`reject-btn-${teacher.id}`}
                                disabled={isBusy}
                                onClick={() => handleVerify(teacher, 'rejected')}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-600 dark:bg-slate-800 dark:hover:bg-red-500/20 dark:text-slate-300 dark:hover:text-red-400 transition-all active:scale-95 disabled:opacity-50"
                                title="Reject instructor application"
                              >
                                {isBusy && actionType === 'rejected' ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <XCircle className="w-3.5 h-3.5" />
                                )}
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

      {/* AC 3.3.1: Direct + Add Teacher Modal */}
      <AddTeacherModal
        isOpen={isAddTeacherOpen}
        onClose={() => setIsAddTeacherOpen(false)}
        onSuccess={(creds) => {
          setProvisionedCredentials(creds);
          setNotification({
            type: 'success',
            message: `Teacher ${creds.fullName} has been provisioned and pre-approved successfully!`,
          });
          fetchAnalytics(true);
          fetchPendingTeachers();
        }}
      />
    </div>
  );
};
