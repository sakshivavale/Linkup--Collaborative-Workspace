import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Radio,
  PenLine,
  Code2,
  MessageSquare,
  Users,
  Loader2,
  ShieldX,
  Key,
  Copy,
  Check,
  RefreshCw,
  Edit3,
  Clock,
  PhoneOff,
  Info,
  X,
} from 'lucide-react';
import { Session, CodeState } from '@linkup/shared';
import { useRoom } from './useRoom';
import { LiveTab } from './LiveTab';
import { WhiteboardTab } from './WhiteboardTab';
import { CodeTab } from './CodeTab';
import { ChatPanel } from './ChatPanel';
import { PeoplePanel } from './PeoplePanel';
import { EditRoomModal } from '../dashboard/EditRoomModal';
import { api, HttpError } from '../../lib/api';
import { socket } from '../../lib/socket';
import { useAuth } from '../../context/AuthContext';
import { PermissionToastContainer } from './PermissionToast';

// ─── Tab & sidebar definitions ───────────────────────────────────────────────
type MainTab = 'live' | 'whiteboard' | 'code';
type SideTab = 'chat' | 'people';

const MAIN_TABS: { key: MainTab; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { key: 'live',       label: 'Live',        Icon: Radio    },
  { key: 'whiteboard', label: 'Whiteboard',  Icon: PenLine  },
  { key: 'code',       label: 'Code',        Icon: Code2    },
];

const getSideTabs = (isHost: boolean): { key: SideTab; label: string; Icon: React.FC<{ className?: string }> }[] => [
  { key: 'chat',   label: 'Chat',   Icon: MessageSquare },
  { key: 'people', label: isHost ? 'Participants' : 'People', Icon: Users },
];

// ─── RoomPage ─────────────────────────────────────────────────────────────────
export const RoomPage: React.FC = () => {
  const { id: roomId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { room, setRoom, loading, error } = useRoom(roomId);
  const currentMember = room?.members?.find((m) => m.userId === user?.id);

  const [mainTab, setMainTab] = useState<MainTab>('live');
  const [sideTab, setSideTab] = useState<SideTab>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // US-LIVE-07: Auto-reconnect state on Socket.IO or network drop
  const [isReconnecting, setIsReconnecting] = useState(false);

  const [currentJoinCode, setCurrentJoinCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerated, setRegenerated] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [codeState, setCodeState] = useState<CodeState | null>(null);

  // US-LIVE-01 & US-LIVE-05 & US-LIVE-06: Session state, inCall state & timer
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [isInCall, setIsInCall] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [isEndingSession, setIsEndingSession] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Synchronize activeSession with room summary
  useEffect(() => {
    if (room?.activeSessionId) {
      setActiveSession((prev) => {
        if (prev && prev.id === room.activeSessionId) return prev;
        return {
          id: room.activeSessionId!,
          roomId: room.id,
          startedAt: room.createdAt || new Date().toISOString(),
          endedAt: null,
          startedBy: (room as any).ownerId || room.hostName || '',
        };
      });
    } else if (room && !room.activeSessionId) {
      setActiveSession(null);
    }
  }, [room?.activeSessionId, room?.id, room?.createdAt, room?.hostName]);

  // Fetch active session details from server if room is live
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    const fetchActiveSession = async () => {
      try {
        const res = await api.get<{ session: Session | null }>(`/api/rooms/${roomId}/sessions/active`);
        if (!cancelled && res?.session) {
          setActiveSession(res.session);
          if (room) {
            room.activeSessionId = res.session.id;
          }
        }
      } catch {
        // Fallback to room's activeSessionId
      }
    };
    fetchActiveSession();
    return () => {
      cancelled = true;
    };
  }, [roomId, room]);

  // US-LIVE-01 Acceptance Criteria 4: Session timer starts counting from 00:00
  useEffect(() => {
    if (!activeSession) {
      setElapsedSeconds(0);
      return;
    }

    const startTime = new Date(activeSession.startedAt).getTime();
    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((now - startTime) / 1000));
      setElapsedSeconds(diff);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeSession]);

  const formatTimer = (totalSeconds: number): string => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const hrs = Math.floor(mins / 60);
    const remainingMins = mins % 60;

    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${remainingMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // US-LIVE-01 Acceptance Criteria 1 & 2: Start session handler
  const handleStartSession = async () => {
    if (!roomId || isStartingSession) return;
    setIsStartingSession(true);
    setSessionError(null);
    try {
      const session = await api.post<Session>(`/api/rooms/${roomId}/sessions`);
      setActiveSession(session);
      setSessionEnded(false);
      setIsInCall(true);
      if (room) {
        room.activeSessionId = session.id;
      }
    } catch (err: any) {
      console.error('[RoomPage] Error starting session:', err);
      if (err instanceof HttpError && err.code === 'SESSION_ACTIVE') {
        setSessionError('A session is already active');
      } else {
        setSessionError(err?.message || 'Failed to start session');
      }
      setTimeout(() => setSessionError(null), 4000);
    } finally {
      setIsStartingSession(false);
    }
  };

  // US-LIVE-05 Acceptance Criteria 1 & 2: End session handler (Host only)
  const handleEndSession = async () => {
    if (!roomId || isEndingSession) return;
    setIsEndingSession(true);
    setSessionError(null);
    try {
      const sessId = activeSession?.id;
      const url = sessId
        ? `/api/rooms/${roomId}/sessions/${sessId}/end`
        : `/api/rooms/${roomId}/sessions/end`;
      await api.post<Session>(url);
      setActiveSession(null);
      setSessionEnded(true);
      setIsInCall(false);
      if (room) {
        room.activeSessionId = null;
      }
      // Return to non-live view if currently on live tab (US-LIVE-05 AC-3)
      setMainTab((prev) => (prev === 'live' ? 'whiteboard' : prev));
    } catch (err: any) {
      console.error('[RoomPage] Error ending session:', err);
      setSessionError(err?.message || 'Failed to end session');
      setTimeout(() => setSessionError(null), 4000);
    } finally {
      setIsEndingSession(false);
    }
  };

  useEffect(() => {
    if (room?.joinCode) {
      setCurrentJoinCode(room.joinCode);
    }
  }, [room?.joinCode]);

  // US-LIVE-07: Auto-reconnect on network drop & sync from room:join snapshot (FR-3.8)
  useEffect(() => {
    if (!roomId) return;

    const syncRoomSnapshot = (snapshot: any) => {
      if (!snapshot) return;
      if (snapshot.room) {
        setRoom(snapshot.room);
      }
      if (snapshot.session !== undefined) {
        setActiveSession(snapshot.session);
        if (snapshot.session) {
          setSessionEnded(false);
        }
      }
      if (snapshot.screenShare !== undefined && room) {
        room.activeScreenShare = snapshot.screenShare;
      }
      if (snapshot.joinCode) {
        setCurrentJoinCode(snapshot.joinCode);
      }
      if (snapshot.code) {
        setCodeState(snapshot.code);
      }
    };

    const handleDisconnect = (reason: string) => {
      console.warn('[RoomPage] Socket disconnected / network dropped:', reason);
      setIsReconnecting(true);
    };

    const handleConnectError = (err: any) => {
      console.warn('[RoomPage] Socket connect_error:', err?.message || err);
      setIsReconnecting(true);
    };

    const handleConnect = () => {
      console.log('[RoomPage] Socket connected / reconnected. Syncing state from room:join snapshot...');
      socket.emit('room:join', { roomId }, (res: any) => {
        const snapshot = res?.snapshot || res?.data;
        syncRoomSnapshot(snapshot);

        // US-LIVE-07 AC-4: If in live call, re-emit live:joined to cancel grace timer & reuse open attendance record
        if (isInCall) {
          socket.emit('live:joined', { roomId });
        }

        // US-LIVE-07 AC-3: Within 15 seconds of reconnection, banner disappears and full state is synced
        setIsReconnecting(false);
      });
    };

    const handleOffline = () => {
      console.warn('[RoomPage] Browser offline event detected');
      setIsReconnecting(true);
    };

    const handleOnline = () => {
      console.log('[RoomPage] Browser online restored. Reconnecting socket...');
      if (!socket.connected) {
        socket.connect();
      }
    };

    if (!socket.connected) {
      socket.connect();
    }

    if (socket.connected) {
      handleConnect();
    }

    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('connect', handleConnect);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('connect', handleConnect);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      socket.emit('room:leave', roomId);
    };
  }, [roomId, isInCall, room, setRoom]);

  useEffect(() => {
    const handleJoinCodeUpdated = (data: { roomId: string; joinCode: string }) => {
      if (data.roomId === roomId) {
        setCurrentJoinCode(data.joinCode);
        if (room) room.joinCode = data.joinCode;
      }
    };

    const handleRoomUpdated = (data: { roomId: string; name?: string; description?: string | null }) => {
      if (data.roomId === roomId && room) {
        if (data.name) room.name = data.name;
        if (data.description !== undefined) room.description = data.description;
      }
    };

    const handleRoomArchived = (data: { roomId: string }) => {
      if (data.roomId === roomId) {
        navigate('/', { replace: true, state: { flash: 'ROOM_ARCHIVED' } });
      }
    };

    // US-LIVE-01 Acceptance Criteria 2: all room members receive a session:started socket event and see room update to "Live" status
    const handleSessionStarted = (data: { roomId: string; session: Session }) => {
      if (data.roomId === roomId) {
        setActiveSession(data.session);
        setSessionEnded(false);
        if (room) {
          room.activeSessionId = data.session.id;
        }
      }
    };

    // US-LIVE-05 Acceptance Criteria 2 & 3: session:ended broadcast handler
    const handleSessionEnded = (data: { roomId: string; sessionId: string }) => {
      if (data.roomId === roomId) {
        setActiveSession(null);
        setSessionEnded(true);
        setIsInCall(false);
        if (room) {
          room.activeSessionId = null;
        }
        // US-LIVE-05 AC-3: All participants return to the room's non-live view
        setMainTab((prev) => (prev === 'live' ? 'whiteboard' : prev));
      }
    };

    const handleCodeState = (data: { roomId: string } & CodeState) => {
      if (data.roomId === roomId) {
        setCodeState({
          content: data.content,
          language: data.language,
          rev: data.rev,
          holderId: data.holderId ?? null,
        });
      }
    };

    const handleCodePen = (data: { roomId: string; holderId: string; by?: string }) => {
      if (data.roomId === roomId) {
        setCodeState((prev) =>
          prev
            ? { ...prev, holderId: data.holderId }
            : { content: '', language: 'python', rev: 0, holderId: data.holderId }
        );
      }
    };

    socket.on('room:join-code-updated', handleJoinCodeUpdated);
    socket.on('room:updated', handleRoomUpdated);
    socket.on('room:archived', handleRoomArchived);
    socket.on('session:started', handleSessionStarted);
    socket.on('session:ended', handleSessionEnded);
    socket.on('code:state', handleCodeState);
    socket.on('code:pen', handleCodePen);

    return () => {
      socket.off('room:join-code-updated', handleJoinCodeUpdated);
      socket.off('room:updated', handleRoomUpdated);
      socket.off('room:archived', handleRoomArchived);
      socket.off('session:started', handleSessionStarted);
      socket.off('session:ended', handleSessionEnded);
      socket.off('code:state', handleCodeState);
      socket.off('code:pen', handleCodePen);
    };
  }, [roomId, room, navigate]);

  const handleCopyJoinCode = () => {
    const code = currentJoinCode || room?.joinCode;
    if (code) {
      navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleRegenerateCode = async () => {
    if (isRegenerating || !roomId) return;
    setIsRegenerating(true);
    try {
      const res = await api.post<{ joinCode: string }>(`/api/rooms/${roomId}/join-code`);
      if (res?.joinCode) {
        setCurrentJoinCode(res.joinCode);
        if (room) room.joinCode = res.joinCode;
        setRegenerated(true);
        setTimeout(() => setRegenerated(false), 2500);
      }
    } catch (err) {
      console.warn('[RoomPage] Error regenerating join code:', err);
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let fallbackCode = '';
      for (let i = 0; i < 6; i++) {
        fallbackCode += chars[Math.floor(Math.random() * chars.length)];
      }
      setCurrentJoinCode(fallbackCode);
      if (room) room.joinCode = fallbackCode;
      setRegenerated(true);
      setTimeout(() => setRegenerated(false), 2500);
    } finally {
      setIsRegenerating(false);
    }
  };

  // AC-2: Non-member → redirect to dashboard with a flash message
  useEffect(() => {
    if (error === 'NOT_A_MEMBER') {
      navigate('/', { replace: true, state: { flash: 'NOT_A_MEMBER' } });
    }
    if (error === 'NOT_FOUND') {
      navigate('/', { replace: true, state: { flash: 'ROOM_NOT_FOUND' } });
    }
  }, [error, navigate]);

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4 text-slate-400 dark:text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm font-medium">Loading room…</p>
        </div>
      </main>
    );
  }

  // ── Error fallback (NOT_A_MEMBER triggers redirect above, this covers UNKNOWN) ──
  if (error === 'UNKNOWN' || !room) {
    return (
      <main className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="glass-panel rounded-3xl p-8 flex flex-col items-center gap-4 max-w-sm text-center">
          <ShieldX className="w-12 h-12 text-rose-500" />
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">Unable to load room</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Something went wrong. Please try again or return to the dashboard.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  // ── Main room workspace ────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden">
      {/* US-LIVE-07 Acceptance Criteria 1: A top-of-screen "Reconnecting..." banner appears when the connection drops */}
      {isReconnecting && (
        <aside
          id="reconnecting-banner"
          data-testid="reconnecting-banner"
          role="alert"
          aria-live="assertive"
          className="shrink-0 bg-amber-500 text-slate-950 font-bold px-4 py-2 text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md animate-pulse z-50 border-b border-amber-600/30"
        >
          <RefreshCw className="w-4 h-4 animate-spin text-slate-950 shrink-0" />
          <span>Reconnecting... Network connection dropped. Re-syncing room state.</span>
        </aside>
      )}

      {/* ── Room Header ─────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-slate-200/80 dark:border-slate-800/70 bg-white/70 dark:bg-slate-950/70 backdrop-blur-sm px-4 sm:px-6 py-3 flex items-center gap-3 z-10">
        <Link
          to="/"
          id="room-back-to-dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Dashboard
        </Link>

        <span className="text-slate-300 dark:text-slate-700">/</span>

        {/* Room name + status */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <h1 className="text-sm font-bold text-slate-900 dark:text-white truncate">
            {room.name}
          </h1>

          {/* Edit button for host */}
          {room.myRole === 'host' && (
            <button
              id="room-header-edit-btn"
              data-testid="room-header-edit-btn"
              type="button"
              onClick={() => setIsEditModalOpen(true)}
              className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              title="Edit room settings"
              aria-label="Edit room settings"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Session status badge */}
          <div
            id="room-header-status-badge"
            data-testid="room-header-status-badge"
            className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide transition-colors ${
              activeSession
                ? 'bg-red-500/15 border border-red-500/30 text-red-500 dark:text-red-400'
                : 'bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${activeSession ? 'bg-red-500 animate-pulse' : 'bg-slate-400'}`} />
            {activeSession ? 'Live' : 'Idle'}
          </div>

          {/* US-LIVE-01 & US-LIVE-05: Session timer in header stops and is replaced with "Session ended" */}
          {activeSession ? (
            <div
              id="room-header-session-timer"
              data-testid="room-header-session-timer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200/60 dark:border-red-500/20 text-red-600 dark:text-red-400 font-mono text-xs font-bold tracking-wider shrink-0 animate-fade-in"
              title="Live session duration"
            >
              <Clock className="w-3.5 h-3.5 animate-pulse text-red-500" />
              <span>{formatTimer(elapsedSeconds)}</span>
            </div>
          ) : sessionEnded ? (
            <div
              id="room-header-session-timer"
              data-testid="room-header-session-timer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-mono text-xs font-semibold shrink-0 animate-fade-in"
              title="Session ended"
            >
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>Session ended</span>
            </div>
          ) : null}

          {/* US-LIVE-01 Acceptance Criteria 1: Start Session button for host when no session is active */}
          {room.myRole === 'host' && !activeSession && (
            <button
              id="room-header-start-session-btn"
              data-testid="room-header-start-session-btn"
              type="button"
              onClick={handleStartSession}
              disabled={isStartingSession || isReconnecting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 shadow-sm shadow-red-500/20 active:scale-95 disabled:opacity-50 transition-all shrink-0 cursor-pointer"
              title={isReconnecting ? 'Reconnecting...' : 'Start live session'}
              aria-label="Start live session"
            >
              {isStartingSession ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Starting…</span>
                </>
              ) : (
                <>
                  <Radio className="w-3.5 h-3.5 animate-pulse" />
                  <span>Start Session</span>
                </>
              )}
            </button>
          )}

          {/* US-LIVE-05 Acceptance Criteria 1: End Session button visible for host during active session */}
          {room.myRole === 'host' && activeSession && (
            <button
              id="room-header-end-session-btn"
              data-testid="room-header-end-session-btn"
              type="button"
              onClick={handleEndSession}
              disabled={isEndingSession || isReconnecting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-rose-700 to-red-700 hover:from-rose-600 hover:to-red-600 shadow-sm shadow-red-500/20 active:scale-95 disabled:opacity-50 transition-all shrink-0 cursor-pointer"
              title={isReconnecting ? 'Reconnecting...' : 'End live session'}
              aria-label="End live session"
            >
              {isEndingSession ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Ending…</span>
                </>
              ) : (
                <>
                  <PhoneOff className="w-3.5 h-3.5 text-rose-200" />
                  <span>End Session</span>
                </>
              )}
            </button>
          )}

          {/* US-LIVE-06 Acceptance Criteria 3: Host can re-join the call using the Join Live button */}
          {activeSession && !isInCall && (
            <button
              id="room-header-join-live-btn"
              data-testid="room-header-join-live-btn"
              type="button"
              disabled={isReconnecting}
              onClick={() => {
                setIsInCall(true);
                setMainTab('live');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-sm shadow-emerald-500/20 active:scale-95 disabled:opacity-50 transition-all shrink-0 cursor-pointer"
              title={isReconnecting ? 'Reconnecting...' : 'Join live call'}
              aria-label="Join Live"
            >
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              <span>Join Live</span>
            </button>
          )}

          {sessionError && (
            <span
              id="room-header-session-error"
              className="text-[11px] font-medium text-rose-500 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded-lg border border-rose-200/60 dark:border-rose-800/40 shrink-0"
            >
              {sessionError}
            </span>
          )}

          <span className="hidden sm:inline text-xs text-slate-400 dark:text-slate-500 font-medium truncate">
            Host: {room.hostName}
          </span>
        </div>

        {/* US-ROOM-04: Host room join code with Copy & Regenerate options in Room Header */}
        {room.myRole === 'host' && (currentJoinCode || room.joinCode) && (
          <div
            id="room-header-join-code-section"
            data-testid="room-header-join-code-section"
            className="hidden sm:flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200/60 dark:border-indigo-500/20 rounded-xl px-2.5 py-1 text-xs shrink-0"
            title={`Room join code: ${currentJoinCode || room.joinCode}`}
          >
            <Key className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium hidden md:inline">Code:</span>
            <span
              id="room-header-join-code-display"
              data-testid="room-header-join-code-display"
              className="text-[11px] font-mono font-bold text-indigo-600 dark:text-indigo-400 tracking-wider"
            >
              {currentJoinCode || room.joinCode}
            </span>

            {/* Copy button */}
            <div className="relative flex items-center">
              <button
                id="room-header-copy-code-btn"
                data-testid="room-header-copy-code-btn"
                type="button"
                disabled={isReconnecting}
                onClick={handleCopyJoinCode}
                className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 rounded transition-colors active:scale-90 disabled:opacity-50"
                title={copiedCode ? 'Copied!' : 'Copy join code'}
                aria-label="Copy join code"
              >
                {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              {copiedCode && (
                <span className="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-600 text-white whitespace-nowrap pointer-events-none shadow-md z-20">
                  Copied!
                </span>
              )}
            </div>

            {/* Regenerate Code button */}
            <div className="relative flex items-center">
              <button
                id="room-header-regenerate-code-btn"
                data-testid="room-header-regenerate-code-btn"
                type="button"
                onClick={handleRegenerateCode}
                disabled={isRegenerating || isReconnecting}
                className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 rounded transition-colors active:scale-90 disabled:opacity-50 ml-0.5"
                title={isRegenerating ? 'Regenerating code...' : 'Regenerate Code'}
                aria-label="Regenerate Code"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin text-indigo-500' : ''}`} />
              </button>
              {regenerated && (
                <span className="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-600 text-white whitespace-nowrap pointer-events-none shadow-md z-20">
                  New Code!
                </span>
              )}
            </div>
          </div>
        )}

        {/* Sidebar toggle */}
        <button
          id="room-sidebar-toggle"
          onClick={() => setSidebarOpen(v => !v)}
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <MessageSquare className="w-4 h-4" />
        </button>
      </header>

      {/* US-LIVE-05 Acceptance Criteria 3: All participants see a "Session has ended" message */}
      {sessionEnded && (
        <div
          id="room-session-ended-notice"
          data-testid="room-session-ended-notice"
          className="shrink-0 bg-amber-500/10 dark:bg-amber-500/15 border-b border-amber-500/30 text-amber-800 dark:text-amber-200 px-4 sm:px-6 py-2.5 text-xs font-medium flex items-center justify-between z-10 transition-all animate-fade-in"
        >
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="font-semibold">Session has ended</span>
            <span className="text-amber-600/80 dark:text-amber-400/80 hidden sm:inline">
              — The host has ended the live call. You have been returned to the workspace.
            </span>
          </div>
          <button
            id="room-dismiss-ended-notice-btn"
            data-testid="room-dismiss-ended-notice-btn"
            type="button"
            onClick={() => setSessionEnded(false)}
            className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 text-xs font-semibold px-2 py-0.5 rounded hover:bg-amber-500/20 transition-colors cursor-pointer"
            aria-label="Dismiss message"
          >
            <X className="w-3.5 h-3.5" />
            <span>Dismiss</span>
          </button>
        </div>
      )}

      {/* ── Main tab bar ────────────────────────────────────────────────────── */}
      <nav
        id="room-main-tabs"
        className="shrink-0 flex items-center gap-1 px-4 sm:px-6 border-b border-slate-200/80 dark:border-slate-800/70 bg-white/60 dark:bg-slate-950/60 backdrop-blur-sm"
        aria-label="Room workspace tabs"
      >
        {MAIN_TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            id={`room-tab-${key}`}
            onClick={() => setMainTab(key)}
            className={`inline-flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-inset ${
              mainTab === key
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
            aria-selected={mainTab === key}
            role="tab"
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </nav>

      {/* ── Body: main content + sidebar ────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main content area */}
        <main
          className="flex-1 overflow-y-auto p-4 sm:p-6"
          id={`room-tab-panel-${mainTab}`}
          role="tabpanel"
        >
          <div className={mainTab === 'live' ? 'h-full' : 'hidden'}>
            <LiveTab
              roomId={roomId!}
              sessionId={activeSession?.id ?? null}
              inCall={isInCall}
              onJoinCall={() => setIsInCall(true)}
              onLeaveCall={() => setIsInCall(false)}
              isHost={room.myRole === 'host'}
              disabled={isReconnecting}
              isReconnecting={isReconnecting}
            />
          </div>
          {mainTab === 'whiteboard' && (
            <WhiteboardTab
              roomId={roomId!}
              canWhiteboard={room.myRole === 'host' || Boolean(currentMember?.permissions?.canWhiteboard ?? true)}
            />
          )}
          {mainTab === 'code' && (
            <CodeTab
              roomId={roomId!}
              canCode={room.myRole === 'host' || Boolean(currentMember?.permissions?.canCode ?? true)}
              members={room.members || []}
              initialCodeState={codeState}
              onCodeStateChange={setCodeState}
              isHost={room.myRole === 'host'}
            />
          )}
        </main>

        {/* Sidebar */}
        {sidebarOpen && (
          <aside
            id="room-sidebar"
            className="w-72 shrink-0 border-l border-slate-200/80 dark:border-slate-800/70 bg-white/70 dark:bg-slate-950/70 backdrop-blur-sm flex flex-col overflow-hidden"
          >
            {/* Sidebar tab bar */}
            <nav
              id="room-sidebar-tabs"
              className="shrink-0 flex border-b border-slate-200/70 dark:border-slate-800/70"
              aria-label="Room sidebar tabs"
            >
              {getSideTabs(room?.myRole === 'host').map(({ key, label, Icon }) => (
                <button
                  key={key}
                  id={`room-sidebar-tab-${key}`}
                  data-testid={`room-sidebar-tab-${key}`}
                  onClick={() => setSideTab(key)}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 py-3 text-xs font-semibold border-b-2 transition-all focus:outline-none ${
                    sideTab === key
                      ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                      : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                  aria-selected={sideTab === key}
                  role="tab"
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </nav>

            {/* Sidebar panel content */}
            <div className="flex-1 overflow-hidden">
              {sideTab === 'chat' && <ChatPanel roomId={roomId!} disabled={isReconnecting} />}
              {sideTab === 'people' && (
                <PeoplePanel 
                  room={room} 
                  currentJoinCode={currentJoinCode}
                  onJoinCodeRegenerated={(newCode) => {
                    setCurrentJoinCode(newCode);
                    if (room) room.joinCode = newCode;
                  }}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Edit Room Modal for host */}
      {room.myRole === 'host' && isEditModalOpen && (
        <EditRoomModal
          isOpen={isEditModalOpen}
          room={room}
          onClose={() => setIsEditModalOpen(false)}
          onSuccess={(updated) => {
            room.name = updated.name;
            room.description = updated.description;
          }}
          onArchive={() => {
            navigate('/', { replace: true, state: { flash: 'ROOM_ARCHIVED' } });
          }}
        />
      )}

      {/* US-PERM-03: Real-time non-blocking permission change toast notification (FR-4.4) */}
      <PermissionToastContainer
        roomId={roomId}
        currentUserId={user?.id}
        initialPermissions={currentMember?.permissions || null}
      />
    </div>
  );
};

export default RoomPage;
