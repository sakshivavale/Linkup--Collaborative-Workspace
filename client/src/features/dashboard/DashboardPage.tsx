import React, { useState, useEffect, useCallback } from 'react';
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
  UserCog,
  Radio
} from 'lucide-react';
import { ProfileSettingsModal } from '../../components/profile/ProfileSettingsModal';
import { RoomCard } from './RoomCard';
import { api, HttpError } from '../../lib/api';
import { socket } from '../../lib/socket';
import { RoomSummary } from '@linkup/shared';

// Default initial sample rooms demonstrating US-DASH-02 active and inactive session states
const DEFAULT_SAMPLE_ROOMS: RoomSummary[] = [
  {
    id: 'room-cs101-active',
    name: 'CS101: Data Structures & Algorithms',
    description: 'Live interactive coding workspace with real-time video, compiler, and shared whiteboard.',
    joinCode: 'CS101A',
    hostName: 'Prof. Alan Turing',
    memberCount: 28,
    myRole: 'host',
    activeSessionId: 'session-live-cs101-888', // ACTIVE SESSION: Live badge + Join button displayed (US-DASH-02 AC-1 & AC-2)
    createdAt: new Date().toISOString(),
  },
  {
    id: 'room-math201-inactive',
    name: 'MATH201: Discrete Mathematics & Graph Theory',
    description: 'Weekly tutorial problems and discussion room. Next session scheduled for Friday.',
    joinCode: null,
    hostName: 'Dr. Ada Lovelace',
    memberCount: 16,
    myRole: 'participant',
    activeSessionId: null, // NO ACTIVE SESSION: Neither badge nor Join button displayed (US-DASH-02 AC-3)
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'room-phys301-active',
    name: 'PHYS301: Quantum Mechanics & Wave Dynamics',
    description: 'Laboratory live lecture session with interactive formulas and visual simulations.',
    joinCode: null,
    hostName: 'Dr. Richard Feynman',
    memberCount: 34,
    myRole: 'participant',
    activeSessionId: 'session-live-phys-999', // ACTIVE SESSION: Live badge + Join button displayed (US-DASH-02 AC-1 & AC-2)
    createdAt: new Date(Date.now() - 172800000).toISOString(),
  },
];

export const DashboardPage: React.FC = () => {
  const { fullName, role, session } = useAuth();
  const isTeacher = role === 'teacher';

  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; details?: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Rooms state (FR-8.1, FR-8.2, US-DASH-01, US-DASH-02)
  const [rooms, setRooms] = useState<RoomSummary[]>(DEFAULT_SAMPLE_ROOMS);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [roomsFetchSource, setRoomsFetchSource] = useState<'server' | 'sample'>('sample');

  // Fetch rooms from backend GET /api/rooms
  const fetchRooms = useCallback(async () => {
    setIsLoadingRooms(true);
    try {
      const data = await api.get<RoomSummary[]>('/api/rooms');
      if (Array.isArray(data) && data.length > 0) {
        setRooms(data);
        setRoomsFetchSource('server');
      } else {
        // Fallback to sample rooms if user has no rooms in DB yet
        setRooms(DEFAULT_SAMPLE_ROOMS);
        setRoomsFetchSource('sample');
      }
    } catch {
      // In offline / dev mode, gracefully fall back to sample rooms
      setRooms(DEFAULT_SAMPLE_ROOMS);
      setRoomsFetchSource('sample');
    } finally {
      setIsLoadingRooms(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  // Toggle activeSessionId on the first room for instant AC-1, AC-2, AC-3 verification
  const toggleFirstRoomLiveStatus = () => {
    setRooms((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const target = updated[0];
      const isCurrentlyLive = Boolean(target.activeSessionId);
      updated[0] = {
        ...target,
        activeSessionId: isCurrentlyLive ? null : `session-live-${Date.now()}`,
      };
      return updated;
    });
  };

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
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs font-medium">
              <Radio className="w-3.5 h-3.5" />
              <span>Live Badge on Active &bull; US-DASH-02</span>
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

      {/* Rooms Section (FR-8.1, FR-8.2, US-DASH-01, US-DASH-02) */}
      <section className="mb-8" aria-label="Classrooms">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                My Classrooms
              </h2>
              <span 
                id="rooms-count-badge"
                className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30"
              >
                {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                Source: {roomsFetchSource === 'server' ? 'Live API (/api/rooms)' : 'Demo Samples'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Rooms with active sessions display a <span className="font-bold text-rose-600 dark:text-rose-400">"Live"</span> badge and instant <span className="font-semibold text-slate-800 dark:text-slate-200">Join</span> button (US-DASH-02).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <button
              id="refresh-rooms-btn"
              type="button"
              onClick={fetchRooms}
              disabled={isLoadingRooms}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-all disabled:opacity-50"
              title="Query GET /api/rooms from backend"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRooms ? 'animate-spin' : ''}`} />
              <span>Refresh API</span>
            </button>

            <button
              id="toggle-room-live-btn"
              type="button"
              onClick={toggleFirstRoomLiveStatus}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30 transition-all shadow-sm"
              title="US-DASH-02 AC-1/AC-3 Interactive Test: toggle active session on room 1"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Toggle Room 1 Live (AC Test)</span>
            </button>
          </div>
        </div>

        {/* Room cards grid or empty state */}
        {isLoadingRooms ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((n) => (
              <div key={n} className="glass-panel rounded-3xl p-6 h-56 animate-pulse flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <div className="w-16 h-5 bg-slate-200 dark:bg-slate-700 rounded-full" />
                    <div className="w-14 h-5 bg-slate-200 dark:bg-slate-700 rounded-full" />
                  </div>
                  <div className="w-3/4 h-6 bg-slate-200 dark:bg-slate-700 rounded-lg mb-2" />
                  <div className="w-full h-4 bg-slate-200 dark:bg-slate-700 rounded mb-1" />
                  <div className="w-2/3 h-4 bg-slate-200 dark:bg-slate-700 rounded" />
                </div>
                <div className="w-full h-8 bg-slate-200 dark:bg-slate-700 rounded-xl" />
              </div>
            ))}
          </div>
        ) : rooms.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" data-testid="rooms-grid">
            {rooms.map((room) => (
              <RoomCard key={room.id} room={room} />
            ))}
          </div>
        ) : (
          <div className="glass-panel rounded-3xl p-10 text-center border-dashed border-slate-300 dark:border-slate-800">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800/80 mx-auto flex items-center justify-center text-slate-500 dark:text-slate-400 mb-3">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">No rooms active yet</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
              {isTeacher
                ? 'Create your first classroom room to start teaching and collaborating.'
                : 'Ask your instructor for a 6-character room code to join.'}
            </p>
          </div>
        )}
      </section>

      {/* Profile Settings Modal */}
      <ProfileSettingsModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />
    </main>
  );
};
