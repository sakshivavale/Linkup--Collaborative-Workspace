import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../../lib/socket';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { Logo } from '../../components/ui/Logo';
import { CheckCircle2, XCircle, LogOut, Radio, Loader2 } from 'lucide-react';

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

  const [teachers, setTeachers] = useState<PendingTeacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // 1. Initial fetch & real-time WebSocket setup
  useEffect(() => {
    // Fetch current pending teacher verification requests
    const fetchPending = async () => {
      try {
        const res = await api.get<{ pendingTeachers: PendingTeacher[] }>('/api/admin/pending-teachers');
        if (res?.pendingTeachers) {
          setTeachers(res.pendingTeachers);
        }
      } catch (err) {
        console.warn('[Admin] Failed to load pending teachers from API, using local fallback:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPending();

    // Connect socket and join the admin room for real-time notifications
    if (!socket.connected) {
      socket.connect();
    }
    socket.emit('admin:join');

    // Real-Time Notification: listen for teacher_created event from backend
    const onTeacherCreated = (newTeacher: PendingTeacher) => {
      setTeachers((prev) => {
        // Prevent duplicate entries
        if (prev.some((t) => t.id === newTeacher.id)) return prev;
        return [newTeacher, ...prev];
      });
    };

    // Real-Time Update: listen for teacher_verified event
    const onTeacherVerified = ({ id }: { id: string }) => {
      setTeachers((prev) => prev.filter((t) => t.id !== id));
    };

    socket.on('teacher_created', onTeacherCreated);
    socket.on('teacher_verified', onTeacherVerified);

    return () => {
      socket.off('teacher_created', onTeacherCreated);
      socket.off('teacher_verified', onTeacherVerified);
    };
  }, []);

  // 2. Action Handlers (PATCH /admin/verify-teacher/:id)
  const handleVerify = async (id: string, status: 'approved' | 'rejected') => {
    setProcessingId(id);
    // Optimistic UI update
    setTeachers((prev) => prev.filter((t) => t.id !== id));

    try {
      await api.patch(`/api/admin/verify-teacher/${id}`, { status });
    } catch (err) {
      console.error(`[Admin] Failed to set status ${status} for teacher ${id}:`, err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen ambient-bg flex flex-col transition-colors duration-300">
      {/* Minimal Header */}
      <header className="border-b border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-[#090d16]/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
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

      {/* Main Content: Pending Teacher Verifications Only */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
              Pending Teacher Verifications
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Real-time approval requests for incoming teacher registrations.
            </p>
          </div>
          <span className="px-3 py-1 rounded-xl text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
            {teachers.length} Pending
          </span>
        </div>

        {/* Minimal Table */}
        <div className="glass-panel rounded-2xl border border-slate-200/80 dark:border-slate-800/80 overflow-hidden shadow-sm">
          {loading ? (
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
                New teacher signups will appear here automatically via real-time WebSocket.
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
      </main>
    </div>
  );
};
