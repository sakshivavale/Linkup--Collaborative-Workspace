import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { 
  GraduationCap, 
  BookOpen, 
  PlusCircle, 
  DoorOpen, 
  Users,
  CheckCircle2,
  ShieldCheck,
  Zap,
  Lock,
  RefreshCw,
  Edit3,
  UserCog
} from 'lucide-react';
import { ProfileSettingsModal } from '../../components/profile/ProfileSettingsModal';
import { api, HttpError } from '../../lib/api';
import { socket } from '../../lib/socket';

export const DashboardPage: React.FC = () => {
  const { fullName, role, session } = useAuth();
  const isTeacher = role === 'teacher';

  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; details?: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const testRejectWhitespace = async () => {
    setIsLoading(true);
    setTestStatus('Testing PATCH /api/me with whitespace-only name (simulating empty input)...');
    try {
      await api.patch('/api/me', { fullName: '     ' });
      setTestResult({
        success: false,
        message: 'Unexpected: whitespace name was accepted by server',
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 400 && err.code === 'VALIDATION') {
        setTestResult({
          success: true,
          message: 'Verified! Server correctly rejected whitespace name with 400 VALIDATION error.',
          details: JSON.stringify({ status: err.status, code: err.code, message: err.message }, null, 2),
        });
      } else {
        setTestResult({
          success: false,
          message: 'Request failed unexpectedly',
          details: String(err),
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const testApiAuth = async () => {
    setIsLoading(true);
    setTestStatus('Verifying API token at GET /api/me...');
    try {
      const data = await api.get<{ user: { id: string; fullName: string; role: string; email: string } }>('/api/me');
      setTestResult({
        success: true,
        message: 'Successfully authenticated with valid Supabase token!',
        details: JSON.stringify(data, null, 2),
      });
    } catch (err) {
      if (err instanceof HttpError) {
        setTestResult({
          success: false,
          message: `API Error: ${err.code} (${err.status})`,
          details: err.message,
        });
      } else {
        setTestResult({
          success: false,
          message: 'Connection to server failed. Ensure server is running on port 3001.',
          details: String(err),
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const testUnauthenticated = async () => {
    setIsLoading(true);
    setTestStatus('Sending unauthenticated request to /api/test (simulating missing token)...');
    try {
      const res = await fetch('http://localhost:3001/api/test', {
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.status === 401 && data?.error?.code === 'UNAUTHENTICATED') {
        setTestResult({
          success: true,
          message: 'Verified! Unauthenticated request correctly rejected with 401 UNAUTHENTICATED.',
          details: JSON.stringify(data, null, 2),
        });
      } else {
        setTestResult({
          success: false,
          message: `Unexpected response status ${res.status}`,
          details: JSON.stringify(data, null, 2),
        });
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: 'Request failed. Ensure server is running.',
        details: String(err),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const testSocketAuth = () => {
    setIsLoading(true);
    setTestStatus('Connecting Socket.IO with token in auth object...');

    socket.connect();

    const handleConnect = () => {
      setTestResult({
        success: true,
        message: `Socket.IO connected and authenticated successfully! Socket ID: ${socket.id}`,
      });
      setIsLoading(false);
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleError);
    };

    const handleError = (err: Error) => {
      setTestResult({
        success: false,
        message: `Socket connection rejected: ${err.message}`,
        details: err.message === 'UNAUTHENTICATED' ? 'connect_error: UNAUTHENTICATED (Enforcement active)' : err.message,
      });
      setIsLoading(false);
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleError);
    };

    socket.once('connect', handleConnect);
    socket.once('connect_error', handleError);
  };

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
      {/* Welcome Banner */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 mb-8 relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Token Enforcement Active &bull; US-AUTH-05</span>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-400 text-xs font-medium">
              <UserCog className="w-3.5 h-3.5" />
              <span>Edit Profile Name Active &bull; US-AUTH-06</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Welcome back, {fullName}!
            </h1>
            <button
              id="dashboard-edit-profile-btn"
              type="button"
              onClick={() => setIsProfileModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-500/20 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-all shadow-sm"
              title="Edit Profile Display Name"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Name</span>
            </button>
          </div>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            You are signed in as a <span className="font-semibold text-indigo-600 dark:text-indigo-300 capitalize">{role}</span>. 
            {isTeacher 
              ? ' You have full host controls to create classroom rooms and grant per-student permissions for media, code, and whiteboard.' 
              : ' You can join interactive classrooms with a 6-character room code to collaborate with your teachers and peers.'}
          </p>
        </div>

        <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10 dark:opacity-10 pointer-events-none flex items-center justify-center">
          {isTeacher 
            ? <GraduationCap className="w-64 h-64 text-indigo-600 dark:text-indigo-400" /> 
            : <BookOpen className="w-64 h-64 text-emerald-600 dark:text-emerald-400" />}
        </div>
      </div>

      {/* US-AUTH-05 Verification & Diagnostic Panel */}
      <div className="glass-panel rounded-3xl p-6 sm:p-7 mb-8 border border-indigo-200/60 dark:border-indigo-500/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                US-AUTH-05: API Token Enforcement Verification
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Live verification of Bearer token header, Socket.IO auth, and 401 UNAUTHENTICATED rejection.
              </p>
            </div>
          </div>
          <span className="self-start sm:self-auto px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20">
            {session ? 'Session Active' : 'No Session'}
          </span>
        </div>

        <div className="flex flex-wrap gap-3 mb-4">
          <button
            onClick={testApiAuth}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-all disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5" />
            Verify Authenticated Request (/api/me)
          </button>

          <button
            onClick={testUnauthenticated}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 transition-all disabled:opacity-50"
          >
            <Lock className="w-3.5 h-3.5" />
            Test 401 Rejection (No Token)
          </button>

          <button
            onClick={testSocketAuth}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Test Socket Auth Connection
          </button>

          <button
            id="test-whitespace-reject-btn"
            onClick={testRejectWhitespace}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30 transition-all disabled:opacity-50"
          >
            <UserCog className="w-3.5 h-3.5" />
            Test Empty/Whitespace Name Rejection (US-AUTH-06)
          </button>
        </div>

        {testStatus && (
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-2 font-mono">
            Status: {testStatus}
          </div>
        )}

        {testResult && (
          <div
            className={`p-3.5 rounded-2xl text-xs border ${
              testResult.success
                ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-300'
            }`}
          >
            <div className="font-semibold flex items-center gap-1.5 mb-1">
              {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              {testResult.message}
            </div>
            {testResult.details && (
              <pre className="mt-2 p-2 rounded-lg bg-black/5 dark:bg-black/30 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">
                {testResult.details}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {isTeacher ? (
          <div className="glass-panel p-6 rounded-2xl hover:border-indigo-500/40 transition-all cursor-pointer group">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4 group-hover:scale-110 transition-transform">
              <PlusCircle className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Create a Room</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Launch a new classroom session with live video, editor, and whiteboard</p>
          </div>
        ) : null}

        <div className="glass-panel p-6 rounded-2xl hover:border-indigo-500/40 transition-all cursor-pointer group">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4 group-hover:scale-110 transition-transform">
            <DoorOpen className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Join with Code</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Enter a 6-character room code shared by your teacher</p>
        </div>
      </div>

      {/* Empty state for rooms */}
      <div className="glass-panel rounded-2xl p-10 text-center border-dashed border-slate-300 dark:border-slate-800">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800/80 mx-auto flex items-center justify-center text-slate-500 dark:text-slate-400 mb-3">
          <Users className="w-6 h-6" />
        </div>
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">No rooms active yet</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
          Your classrooms and active sessions will appear here as soon as they are created or joined.
        </p>
      </div>

      {/* Profile Settings Modal */}
      <ProfileSettingsModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />
    </main>
  );
};
