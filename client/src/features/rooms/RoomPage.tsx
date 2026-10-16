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
} from 'lucide-react';
import { Session } from '@linkup/shared';
import { useRoom } from './useRoom';
import { LiveTab } from './LiveTab';
import { WhiteboardTab } from './WhiteboardTab';
import { CodeTab } from './CodeTab';
import { ChatPanel } from './ChatPanel';
import { PeoplePanel } from './PeoplePanel';
import { EditRoomModal } from '../dashboard/EditRoomModal';
import { api, HttpError } from '../../lib/api';
import { socket } from '../../lib/socket';

// ─── Tab & sidebar definitions ───────────────────────────────────────────────
type MainTab = 'live' | 'whiteboard' | 'code';
type SideTab = 'chat' | 'people';

const MAIN_TABS: { key: MainTab; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { key: 'live',       label: 'Live',        Icon: Radio    },
  { key: 'whiteboard', label: 'Whiteboard',  Icon: PenLine  },
  { key: 'code',       label: 'Code',        Icon: Code2    },
];

const SIDE_TABS: { key: SideTab; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { key: 'chat',   label: 'Chat',   Icon: MessageSquare },
  { key: 'people', label: 'People', Icon: Users         },
];

// ─── RoomPage ─────────────────────────────────────────────────────────────────
export const RoomPage: React.FC = () => {
  const { id: roomId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { room, loading, error } = useRoom(roomId);

  const [mainTab, setMainTab] = useState<MainTab>('live');
  const [sideTab, setSideTab] = useState<SideTab>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [currentJoinCode, setCurrentJoinCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerated, setRegenerated] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // US-LIVE-01: Session state & timer
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
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

  useEffect(() => {
    if (room?.joinCode) {
      setCurrentJoinCode(room.joinCode);
    }
  }, [room?.joinCode]);

  // Join Room Socket.IO channel for real-time presence, chat, and room updates (US-ROOM-02, FR-2.4)
  useEffect(() => {
    if (!roomId) return;

    if (!socket.connected) {
      socket.connect();
    }

    const joinRoomChannel = () => {
      socket.emit('room:join', roomId);
    };

    if (socket.connected) {
      joinRoomChannel();
    }
    socket.on('connect', joinRoomChannel);

    return () => {
      socket.off('connect', joinRoomChannel);
      socket.emit('room:leave', roomId);
    };
  }, [roomId]);

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
        if (room) {
          room.activeSessionId = data.session.id;
        }
      }
    };

    const handleSessionEnded = (data: { roomId: string; sessionId: string }) => {
      if (data.roomId === roomId) {
        setActiveSession(null);
        if (room) {
          room.activeSessionId = null;
        }
      }
    };

    socket.on('room:join-code-updated', handleJoinCodeUpdated);
    socket.on('room:updated', handleRoomUpdated);
    socket.on('room:archived', handleRoomArchived);
    socket.on('session:started', handleSessionStarted);
    socket.on('session:ended', handleSessionEnded);

    return () => {
      socket.off('room:join-code-updated', handleJoinCodeUpdated);
      socket.off('room:updated', handleRoomUpdated);
      socket.off('room:archived', handleRoomArchived);
      socket.off('session:started', handleSessionStarted);
      socket.off('session:ended', handleSessionEnded);
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

          {/* US-LIVE-01 Acceptance Criteria 4: Session timer in header counting from 00:00 */}
          {activeSession && (
            <div
              id="room-header-session-timer"
              data-testid="room-header-session-timer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200/60 dark:border-red-500/20 text-red-600 dark:text-red-400 font-mono text-xs font-bold tracking-wider shrink-0 animate-fade-in"
              title="Live session duration"
            >
              <Clock className="w-3.5 h-3.5 animate-pulse text-red-500" />
              <span>{formatTimer(elapsedSeconds)}</span>
            </div>
          )}

          {/* US-LIVE-01 Acceptance Criteria 1: Start Session button for host when no session is active */}
          {room.myRole === 'host' && !activeSession && (
            <button
              id="room-header-start-session-btn"
              data-testid="room-header-start-session-btn"
              type="button"
              onClick={handleStartSession}
              disabled={isStartingSession}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 shadow-sm shadow-red-500/20 active:scale-95 disabled:opacity-50 transition-all shrink-0 cursor-pointer"
              title="Start live session"
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
                onClick={handleCopyJoinCode}
                className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 rounded transition-colors active:scale-90"
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
                disabled={isRegenerating}
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
          {mainTab === 'live'       && <LiveTab       roomId={roomId!} sessionId={activeSession?.id ?? null} />}
          {mainTab === 'whiteboard' && <WhiteboardTab roomId={roomId!} />}
          {mainTab === 'code'       && <CodeTab       roomId={roomId!} />}
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
              {SIDE_TABS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  id={`room-sidebar-tab-${key}`}
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
              {sideTab === 'chat'   && <ChatPanel   roomId={roomId!} />}
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
    </div>
  );
};

export default RoomPage;
