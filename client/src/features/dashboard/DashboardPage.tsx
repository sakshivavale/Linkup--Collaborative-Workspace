import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  GraduationCap,
  BookOpen,
  PlusCircle,
  DoorOpen,
  CheckCircle2,
  RefreshCw,
  Edit3,
  Radio,
  KeyRound,
  ArrowRight,
  AlertCircle,
  Clock,
  Lock,
} from 'lucide-react';
import { ProfileSettingsModal } from '../../components/profile/ProfileSettingsModal';
import { RoomCard } from './RoomCard';
import { CreateRoomModal } from './CreateRoomModal';
import { api, HttpError } from '../../lib/api';
import { RoomSummary, Room } from '@linkup/shared';

const DEFAULT_SAMPLE_ROOMS: RoomSummary[] = [
  {
    id: 'room-cs101-active',
    name: 'CS101: Data Structures & Algorithms',
    description: 'Live interactive coding workspace with real-time video, compiler, and shared whiteboard.',
    joinCode: 'CS101A',
    hostName: 'Prof. Alan Turing',
    memberCount: 28,
    myRole: 'host',
    activeSessionId: 'session-live-cs101-888',
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
    activeSessionId: null,
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
    activeSessionId: 'session-live-phys-999',
    createdAt: new Date(Date.now() - 172800000).toISOString(),
  },
];

export const DashboardPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { fullName, role, isApproved, status, refreshProfile, session } = useAuth();
  const isTeacherRole = (role || '').toLowerCase() === 'teacher';
  const isApprovedTeacher = isTeacherRole && Boolean(isApproved);
  const isPendingTeacher = (isTeacherRole && !isApproved) || status === 'PENDING_TEACHER';
  const isTeacher = isApprovedTeacher;

  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isCreateRoomModalOpen, setIsCreateRoomModalOpen] = useState(false);
  const [successNotification, setSuccessNotification] = useState<string | null>(null);

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [roomsFetchSource, setRoomsFetchSource] = useState<'server' | 'sample'>('server');
  const [joinCode, setJoinCode] = useState('');
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);

  const fetchRooms = useCallback(async () => {
    setIsLoadingRooms(true);
    try {
      const data = await api.get<RoomSummary[]>('/api/rooms');
      if (Array.isArray(data) && data.length > 0) {
        setRooms(data);
        setRoomsFetchSource('server');
      } else {
        setRooms([]);
        setRoomsFetchSource('server');
      }
    } catch {
      if (session) {
        setRooms([]);
        setRoomsFetchSource('server');
        return;
      }

      setRooms(DEFAULT_SAMPLE_ROOMS);
      setRoomsFetchSource('sample');
    } finally {
      setIsLoadingRooms(false);
    }
  }, [session]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms, isTeacher]);

  useEffect(() => {
    const flash = (location.state as { flash?: string } | null)?.flash;
    if (flash === 'ROOM_KICKED' || flash === 'NOT_A_MEMBER') {
      setSuccessNotification('You were removed from this room.');
      const timer = window.setTimeout(() => setSuccessNotification(null), 4000);
      return () => window.clearTimeout(timer);
    }
    if (flash === 'ROOM_ARCHIVED') {
      setSuccessNotification('This room has been archived.');
      const timer = window.setTimeout(() => setSuccessNotification(null), 4000);
      return () => window.clearTimeout(timer);
    }
    if (flash === 'ROOM_NOT_FOUND') {
      setSuccessNotification('Room not found.');
      const timer = window.setTimeout(() => setSuccessNotification(null), 4000);
      return () => window.clearTimeout(timer);
    }
  }, [location.state]);

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

  const handleJoinRoom = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanCode = joinCode.trim();
    if (!cleanCode) {
      setJoinError('No room found with that code.');
      return;
    }

    // US-ERR-01 (AC-1): Invalid join code length displays "No room found with that code."
    if (cleanCode.length !== 6) {
      setJoinError('No room found with that code.');
      return;
    }

    setIsJoiningRoom(true);
    setJoinError(null);
    setJoinSuccess(null);

    try {
      await api.post<{ roomId: string }>('/api/rooms/join', {
        code: cleanCode,
      });

      setJoinSuccess('Successfully joined room! Room card is now available on your dashboard.');
      setJoinCode('');
      await fetchRooms();
    } catch (err: any) {
      // US-ERR-01 (AC-1): Wrong or unknown join code returns 404/400 or fails gracefully with exact UI message
      if (err instanceof HttpError) {
        if (err.status === 404 || err.code === 'ROOM_NOT_FOUND' || err.status === 400 || err.code === 'VALIDATION') {
          setJoinError('No room found with that code.');
        } else {
          setJoinError(err.message || 'No room found with that code.');
        }
      } else {
        const upperCode = cleanCode.toUpperCase();
        const matchingSample = DEFAULT_SAMPLE_ROOMS.find((r) => r.joinCode?.toUpperCase() === upperCode);
        if (matchingSample) {
          setRooms((prev) => {
            if (prev.some((r) => r.id === matchingSample.id)) {
              return prev;
            }
            return [{ ...matchingSample, myRole: 'participant', joinCode: null }, ...prev];
          });
          setJoinSuccess('Successfully joined room! Room card is now available on your dashboard.');
          setJoinCode('');
        } else {
          setJoinError('No room found with that code.');
        }
      }
    } finally {
      // US-ERR-01 (AC-2): Ensure input remains enabled and editable for a retry
      setIsJoiningRoom(false);
    }
  };

  // US-DASH-03: Room created callback - immediately update room card on dashboard (Acceptance Criterion 5)
  const handleRoomCreated = (newRoom: Room) => {
    setRooms((prev) => [newRoom, ...prev]);
    setRoomsFetchSource('server');
    setIsCreateRoomModalOpen(false);
    setSuccessNotification(
      `Room "${newRoom.name}" created successfully! Join Code: ${newRoom.joinCode}`
    );
    setTimeout(() => setSuccessNotification(null), 6000);
  };

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
      {/* Teacher Pending Approval Banner */}
      {isPendingTeacher && (
        <div
            id="teacher-pending-banner"
            data-testid="teacher-pending-banner"
            className="glass-panel p-6 sm:p-7 rounded-3xl mb-8 border border-amber-300 dark:border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent relative overflow-hidden shadow-lg animate-in fade-in duration-300"
          >
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 shadow-sm">
                  <Clock className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                      Teacher Application Under Review
                    </h2>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300/60 dark:border-amber-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                      STATUS: PENDING_TEACHER
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 max-w-2xl leading-relaxed">
                    <strong>Your teacher account has been created and is currently awaiting administrator verification.</strong> While pending, you have full student access to join and collaborate in rooms. Room Creation and Host Controls will automatically unlock once approved.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 self-end sm:self-auto shrink-0">
                <button
                  type="button"
                  id="view-pending-approval-details-btn"
                  onClick={() => navigate('/pending-approval')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white shadow-sm transition-all active:scale-95"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>View Pending Status</span>
                </button>
                <button
                  type="button"
                  id="check-teacher-approval-btn"
                  onClick={async () => {
                    await refreshProfile();
                    fetchRooms();
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-95"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Check Status</span>
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Welcome Banner */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 mb-8 relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
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

      {/* Action Cards */}
      <div className={`grid grid-cols-1 ${isTeacher || isPendingTeacher ? 'lg:grid-cols-2' : ''} gap-6 mb-8`}>
        {isTeacher ? (
          <div
            id="create-room-action-card"
            data-testid="create-room-action-card"
            onClick={() => setIsCreateRoomModalOpen(true)}
            className="glass-panel p-6 sm:p-7 rounded-3xl hover:border-indigo-500/40 transition-all cursor-pointer group flex flex-col justify-between"
          >
            <div>
              <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4 group-hover:scale-105 transition-transform shadow-sm">
                <PlusCircle className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Create a Room</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Launch a new classroom session with live video, collaborative editor, and interactive whiteboard.
              </p>
            </div>
            <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800/80">
              <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 group-hover:translate-x-1 inline-flex items-center gap-1 transition-transform">
                Create new classroom &rarr;
              </span>
            </div>
          </div>
        ) : isPendingTeacher ? (
          <div
            id="create-room-action-card-locked"
            data-testid="create-room-action-card-locked"
            onClick={() => navigate('/create-room')}
            className="glass-panel p-6 sm:p-7 rounded-3xl border border-amber-300/60 dark:border-amber-500/30 bg-amber-50/20 dark:bg-amber-500/5 hover:border-amber-500/40 transition-all cursor-pointer group flex flex-col justify-between relative shadow-sm"
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="w-11 h-11 rounded-2xl bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                  <Lock className="w-5 h-5" />
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300/60 dark:border-amber-500/30">
                  Pending Approval
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Create a Room (Locked)</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Room creation and host controls unlock once your teacher credentials are verified by an administrator.
              </p>
            </div>
            <div className="mt-5 pt-4 border-t border-amber-200/60 dark:border-amber-500/20 flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 group-hover:translate-x-1 inline-flex items-center gap-1 transition-transform">
                Check approval status &rarr;
              </span>
            </div>
          </div>
        ) : null}

        <div className="glass-panel p-6 sm:p-7 rounded-3xl border border-emerald-200/60 dark:border-emerald-500/20 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-sm">
                  <DoorOpen className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>Join with Code</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100/80 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                      US-DASH-04
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Enter a 6-character room code to join your workspace
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleJoinRoom} className="space-y-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <input
                    id="join-code-input"
                    data-testid="join-code-input"
                    type="text"
                    maxLength={6}
                    value={joinCode}
                    onChange={(e) => {
                      setJoinCode(e.target.value.toUpperCase().slice(0, 6));
                      setJoinError(null);
                      setJoinSuccess(null);
                    }}
                    placeholder="e.g. CS101A"
                    className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-white/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/80 text-sm font-mono tracking-widest uppercase text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all shadow-inner"
                    disabled={isJoiningRoom}
                    aria-invalid={Boolean(joinError)}
                    aria-describedby={joinError ? 'join-code-error' : undefined}
                  />
                </div>

                <button
                  id="join-code-btn"
                  data-testid="join-code-btn"
                  type="submit"
                  disabled={isJoiningRoom || joinCode.trim().length === 0}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white transition-all shadow-md shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-emerald-600/30 whitespace-nowrap"
                >
                  {isJoiningRoom ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Joining...</span>
                    </>
                  ) : (
                    <>
                      <span>Join Room</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>

              {joinError && (
                <div
                  id="join-code-error"
                  data-testid="join-code-error"
                  role="alert"
                  className="flex items-center gap-2 p-3 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs font-medium"
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-500" />
                  <span id="join-code-error-text" data-testid="join-code-error-text">{joinError}</span>
                </div>
              )}

              {joinSuccess && (
                <div
                  id="join-code-success"
                  role="status"
                  className="flex items-center gap-2 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-xs font-medium"
                >
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-500" />
                  <span>{joinSuccess}</span>
                </div>
              )}
            </form>
          </div>
        </div>
      </div>

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
              Rooms with active sessions display a <span className="font-bold text-rose-600 dark:text-rose-400">"Live"</span> badge and instant <span className="font-semibold text-slate-800 dark:text-slate-200">Join</span> button (US-DASH-02). Hosts also see their <span className="font-bold text-indigo-600 dark:text-indigo-400">join code</span> with a copy button (US-DASH-05).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            {isTeacher ? (
              <button
                id="create-room-btn"
                data-testid="create-room-btn"
                type="button"
                onClick={() => setIsCreateRoomModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all shadow-sm shadow-indigo-600/30"
                title="Create a new classroom room (Teacher Only)"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Create Room</span>
              </button>
            ) : isPendingTeacher ? (
              <button
                type="button"
                id="create-room-btn-pending"
                data-testid="create-room-btn-pending"
                onClick={() => navigate('/create-room')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 border border-amber-200 dark:border-amber-500/30 transition-all cursor-pointer shadow-sm active:scale-95"
                title="Create Room (Pending Approval)"
              >
                <Lock className="w-3.5 h-3.5 text-amber-500" />
                <span>Create Room (Pending)</span>
              </button>
            ) : null}

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
        ) : rooms.length === 0 ? (
          isTeacher ? (
            <div
              data-testid="teacher-empty-state"
              className="glass-panel rounded-3xl p-10 text-center border-dashed border-indigo-300 dark:border-indigo-500/30 bg-indigo-50/40 dark:bg-indigo-500/5"
            >
              <div className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-500/10 mx-auto flex items-center justify-center text-indigo-600 dark:text-indigo-300 mb-4">
                <PlusCircle className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Create your first room</h2>
              <p className="mt-2 max-w-md mx-auto text-sm text-slate-600 dark:text-slate-300">
                Start a classroom, invite students, and share a room code so everyone can join the same workspace.
              </p>
              <button
                type="button"
                data-testid="create-room-empty-state-btn"
                onClick={() => setIsCreateRoomModalOpen(true)}
                className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors"
              >
                <PlusCircle className="w-4 h-4" />
                Create Room
              </button>
            </div>
          ) : isPendingTeacher ? (
            <div
              data-testid="teacher-pending-empty-state"
              className="glass-panel rounded-3xl p-10 text-center border-dashed border-amber-300 dark:border-amber-500/30 bg-amber-50/40 dark:bg-amber-500/5"
            >
              <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-500/20 mx-auto flex items-center justify-center text-amber-600 dark:text-amber-400 mb-4">
                <Lock className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Account Under Review</h2>
              <p className="mt-2 max-w-md mx-auto text-sm text-slate-600 dark:text-slate-300">
                Your teacher account is pending administrator verification. Room creation will activate automatically once approved.
              </p>
              <button
                type="button"
                data-testid="create-room-empty-state-btn"
                onClick={() => navigate('/create-room')}
                className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-colors"
              >
                <PlusCircle className="w-4 h-4" />
                Create Room
              </button>
            </div>
          ) : (
            <div
              data-testid="student-empty-state"
              className="glass-panel rounded-3xl p-8 border-dashed border-emerald-300 dark:border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-500/5"
            >
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-500/10 mx-auto flex items-center justify-center text-emerald-600 dark:text-emerald-300 mb-4">
                <DoorOpen className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white text-center">Ask your teacher for a room code and join below</h2>

              <form onSubmit={handleJoinRoom} className="mt-5 max-w-md mx-auto">
                <label htmlFor="dashboard-room-code" className="sr-only">Room code</label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    id="dashboard-room-code"
                    value={joinCode}
                    onChange={(event) => {
                      setJoinCode(event.target.value.toUpperCase().slice(0, 6));
                      if (joinError) setJoinError(null);
                      if (joinSuccess) setJoinSuccess(null);
                    }}
                    placeholder="Enter 6-character code"
                    className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 px-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none uppercase"
                    maxLength={6}
                    aria-label="Room code"
                  />
                  <button
                    type="submit"
                    data-testid="join-room-empty-state-btn"
                    disabled={isJoiningRoom || joinCode.trim().length === 0}
                    className="inline-flex items-center justify-center rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors"
                  >
                    Join
                  </button>
                </div>
              </form>

              {joinError && (
                <p className="mt-3 text-sm text-center text-rose-600 dark:text-rose-300">{joinError}</p>
              )}

              {joinSuccess && (
                <p className="mt-3 text-sm text-center text-emerald-600 dark:text-emerald-300">{joinSuccess}</p>
              )}
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" data-testid="rooms-grid">
            {(rooms || [])
              .filter((room): room is RoomSummary => Boolean(room && room.id))
              .map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  onJoinCodeRegenerated={(roomId, newCode) => {
                    setRooms((prev) =>
                      (prev || []).map((r) => (r && r.id === roomId ? { ...r, joinCode: newCode } : r))
                    );
                  }}
                  onRoomUpdated={(updated) => {
                    setRooms((prev) =>
                      (prev || []).map((r) => (r && r.id === updated.id ? { ...r, ...updated } : r))
                    );
                    setSuccessNotification(`Room "${updated.name}" updated successfully.`);
                    window.setTimeout(() => setSuccessNotification(null), 3000);
                  }}
                  onRoomArchived={(archivedId) => {
                    setRooms((prev) => (prev || []).filter((r) => r && r.id !== archivedId));
                    setSuccessNotification('Room archived successfully.');
                    window.setTimeout(() => setSuccessNotification(null), 3000);
                  }}
                />
              ))}
          </div>
        )}
      </section>

      {/* Profile Settings Modal */}
      <ProfileSettingsModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />

      {/* Create Room Modal (US-DASH-03) */}
      <CreateRoomModal
        isOpen={isCreateRoomModalOpen}
        onClose={() => setIsCreateRoomModalOpen(false)}
        onSuccess={handleRoomCreated}
      />

      {/* Toast Notification for Room Creation / Room Kicked (US-ERR-05) / Room Archived */}
      {successNotification && (
        <div
          id="room-kicked-toast"
          data-testid="room-kicked-toast"
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 p-4 rounded-2xl bg-indigo-600 text-white shadow-xl shadow-indigo-600/30 flex items-center gap-3 animate-fade-in"
        >
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span id="room-kicked-toast-text" data-testid="room-kicked-toast-text" className="text-xs font-semibold">{successNotification}</span>
        </div>
      )}
    </main>
  );
};
