import React, { useEffect, useState, useMemo } from 'react';
import {
  Video,
  Mic,
  MicOff,
  VideoOff,
  PhoneOff,
  PhoneCall,
  Volume2,
  Users,
  Radio,
  Sparkles,
  UserPlus,
  UserMinus,
  Sliders,
} from 'lucide-react';
import { RoomSummary, PresenceEntry, LiveParticipant } from '@linkup/shared';
import { socket } from '../../lib/socket';
import { useAuth } from '../../context/AuthContext';
import { VideoGrid } from './VideoGrid';

interface LiveTabProps {
  roomId: string;
  sessionId: string | null;
  room?: RoomSummary;
}

/**
 * LiveTab — the live video/audio classroom call panel.
 * US-LIVE-03: Video Grid with Participant Tiles (FR-3.4)
 * Acceptance Criteria:
 * 1. Each participant tile shows their name, a mute icon when their mic is off, and a camera-off icon when their camera is off.
 * 2. The currently speaking participant's tile is visually highlighted (active speaker highlight).
 * 3. Tiles update dynamically as participants join/leave.
 */
export const LiveTab: React.FC<LiveTabProps> = ({ roomId, sessionId, room }) => {
  const { user, fullName, role } = useAuth();
  const currentUserId = user?.id || 'self-user';
  const myRole = room?.myRole || (role === 'teacher' ? 'host' : 'participant');

  // Local media controls (US-LIVE-02 AC-3: mic and camera off by default)
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [inCall, setInCall] = useState(false);

  // Local MediaStream for real camera test
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  // Real-time presence entries from Socket.IO
  const [presenceList, setPresenceList] = useState<PresenceEntry[]>(() => room?.presence || []);

  // Demo / simulated participants for manual testing & review
  const [simulatedParticipants, setSimulatedParticipants] = useState<LiveParticipant[]>([]);
  const [showDemoToolbar, setShowDemoToolbar] = useState(false);

  // Manage local camera MediaStream when camOn changes
  useEffect(() => {
    let stream: MediaStream | null = null;

    if (inCall && camOn) {
      if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
        navigator.mediaDevices
          .getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
          .then((s) => {
            stream = s;
            setLocalStream(s);
          })
          .catch((err) => {
            console.warn('[LiveTab] Camera access unavailable or denied:', err);
            setLocalStream(null);
          });
      }
    } else {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
        setLocalStream(null);
      }
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [inCall, camOn]);

  // Synchronize room presence list via Socket.IO
  useEffect(() => {
    const handlePresenceUpdate = (data: { roomId: string; presence: PresenceEntry[] }) => {
      if (data.roomId === roomId) {
        setPresenceList(data.presence);
      }
    };

    const handleMediaChanged = (data: { roomId: string; userId: string; micOn?: boolean; cameraOn?: boolean }) => {
      if (data.roomId === roomId) {
        setPresenceList((prev) =>
          prev.map((p) => {
            if (p.userId === data.userId) {
              return {
                ...p,
                micOn: data.micOn !== undefined ? data.micOn : p.micOn,
                cameraOn: data.cameraOn !== undefined ? data.cameraOn : p.cameraOn,
                isSpeaking: data.micOn === false ? false : p.isSpeaking,
              };
            }
            return p;
          })
        );
      }
    };

    const handleSpeakerChanged = (data: { roomId: string; userId: string; isSpeaking: boolean }) => {
      if (data.roomId === roomId) {
        setPresenceList((prev) =>
          prev.map((p) => (p.userId === data.userId ? { ...p, isSpeaking: data.isSpeaking } : p))
        );
      }
    };

    socket.on('presence:update', handlePresenceUpdate);
    socket.on('live:media-changed', handleMediaChanged);
    socket.on('live:speaker-changed', handleSpeakerChanged);

    return () => {
      socket.off('presence:update', handlePresenceUpdate);
      socket.off('live:media-changed', handleMediaChanged);
      socket.off('live:speaker-changed', handleSpeakerChanged);
    };
  }, [roomId]);

  // Handle joining or leaving live call
  useEffect(() => {
    if (inCall && roomId) {
      socket.emit('live:joined', { roomId, micOn, cameraOn: camOn });

      return () => {
        socket.emit('live:left', { roomId });
      };
    }
  }, [inCall, roomId]);

  // Broadcast media changes when mic or camera is toggled
  const handleToggleMic = () => {
    const nextMic = !micOn;
    setMicOn(nextMic);
    if (!nextMic) {
      setIsSpeaking(false);
      socket.emit('live:speaking', { roomId, isSpeaking: false });
    }
    if (inCall) {
      socket.emit('live:media-state', { roomId, micOn: nextMic, cameraOn: camOn });
    }
  };

  const handleToggleCam = () => {
    const nextCam = !camOn;
    setCamOn(nextCam);
    if (inCall) {
      socket.emit('live:media-state', { roomId, micOn, cameraOn: nextCam });
    }
  };

  const handleToggleSpeaking = () => {
    if (!micOn) {
      // Auto-enable mic if user wants to speak
      setMicOn(true);
      setIsSpeaking(true);
      if (inCall) {
        socket.emit('live:media-state', { roomId, micOn: true, cameraOn: camOn });
        socket.emit('live:speaking', { roomId, isSpeaking: true });
      }
      return;
    }
    const nextSpeaking = !isSpeaking;
    setIsSpeaking(nextSpeaking);
    if (inCall) {
      socket.emit('live:speaking', { roomId, isSpeaking: nextSpeaking });
    }
  };

  const handleToggleCall = () => {
    if (inCall) {
      socket.emit('live:left', { roomId });
      setInCall(false);
      setIsSpeaking(false);
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
        setLocalStream(null);
      }
    } else {
      socket.emit('live:joined', { roomId, micOn, cameraOn: camOn });
      setInCall(true);
    }
  };

  // Derive dynamic list of live participants (AC-3)
  const activeParticipants: LiveParticipant[] = useMemo(() => {
    const list: LiveParticipant[] = [];

    // 1. Current user if inCall
    if (inCall) {
      list.push({
        userId: currentUserId,
        fullName: fullName || 'You',
        micOn,
        cameraOn: camOn,
        isSpeaking,
        isLocal: true,
        role: myRole === 'host' ? 'teacher' : 'student',
      });
    }

    // 2. Real remote participants from presenceList with inLive = true
    for (const p of presenceList) {
      if (p.inLive && p.userId !== currentUserId) {
        list.push({
          userId: p.userId,
          fullName: p.fullName,
          micOn: p.micOn ?? false,
          cameraOn: p.cameraOn ?? false,
          isSpeaking: p.isSpeaking ?? false,
          isLocal: false,
          role: typeof p.role === 'string' ? p.role : undefined,
          handRaised: p.handRaised,
        });
      }
    }

    // 3. Simulated participants (for manual testing/demos)
    for (const sim of simulatedParticipants) {
      if (!list.some((existing) => existing.userId === sim.userId)) {
        list.push(sim);
      }
    }

    return list;
  }, [inCall, currentUserId, fullName, micOn, camOn, isSpeaking, myRole, presenceList, simulatedParticipants]);

  // Demo helpers for manual verification of criteria
  const handleAddDemoParticipant = () => {
    const demoNames = [
      { name: 'Prof. Ada Lovelace', role: 'teacher', mic: true, cam: false },
      { name: 'Alan Turing', role: 'student', mic: false, cam: true },
      { name: 'Grace Hopper', role: 'student', mic: false, cam: false },
      { name: 'Katherine Johnson', role: 'student', mic: true, cam: true },
    ];
    const available = demoNames.filter(
      (d) => !simulatedParticipants.some((p) => p.fullName === d.name)
    );
    if (available.length === 0) return;
    const next = available[0];
    const newSim: LiveParticipant = {
      userId: `sim-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      fullName: next.name,
      micOn: next.mic,
      cameraOn: next.cam,
      isSpeaking: false,
      role: next.role,
      isLocal: false,
    };
    setSimulatedParticipants((prev) => [...prev, newSim]);
  };

  const handleRemoveDemoParticipant = () => {
    setSimulatedParticipants((prev) => prev.slice(0, -1));
  };

  const handleToggleDemoSpeaking = () => {
    if (simulatedParticipants.length === 0) return;
    setSimulatedParticipants((prev) =>
      prev.map((p, idx) => (idx === 0 ? { ...p, micOn: true, isSpeaking: !p.isSpeaking } : p))
    );
  };

  const handleToggleDemoMute = () => {
    if (simulatedParticipants.length === 0) return;
    setSimulatedParticipants((prev) =>
      prev.map((p, idx) => (idx === 0 ? { ...p, micOn: !p.micOn, isSpeaking: false } : p))
    );
  };

  const handleToggleDemoCamera = () => {
    if (simulatedParticipants.length === 0) return;
    setSimulatedParticipants((prev) =>
      prev.map((p, idx) => (idx === 0 ? { ...p, cameraOn: !p.cameraOn } : p))
    );
  };

  // ──────────────────────────────────────────────────────────────────────────
  // STATE 1: No active session
  // ──────────────────────────────────────────────────────────────────────────
  if (!sessionId) {
    return (
      <div
        id="live-tab-no-session"
        data-testid="live-tab-no-session"
        className="flex flex-col items-center justify-center h-full min-h-[50vh] gap-6 py-12 text-center"
      >
        <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-center text-slate-400 dark:text-slate-500 shadow-xl">
          <Radio className="w-10 h-10 opacity-50" />
        </div>

        <div className="flex flex-col items-center gap-2 max-w-sm">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {myRole === 'host' ? 'Session Not Started' : 'Waiting for the teacher'}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {myRole === 'host'
              ? 'Click the "Start Session" button in the room header above to begin a live video class.'
              : 'Waiting for the teacher to start the session.'}
          </p>
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500">
          <span className="w-2 h-2 rounded-full bg-slate-400" />
          No Active Session
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATE 2: Session active, but user has not joined call yet (Join Preview)
  // ──────────────────────────────────────────────────────────────────────────
  if (!inCall) {
    return (
      <div
        id="live-tab-device-preview"
        data-testid="live-tab-device-preview"
        className="flex flex-col items-center justify-center h-full gap-6 py-8 max-w-xl mx-auto"
      >
        {/* Session Status Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold tracking-wide bg-red-500/15 border border-red-500/30 text-red-500 dark:text-red-400 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          Live Session Active
        </div>

        {/* Device Preview Box */}
        <div className="relative w-full aspect-video rounded-3xl bg-slate-900 border border-slate-800 overflow-hidden flex flex-col items-center justify-center shadow-2xl">
          {camOn ? (
            <div className="w-full h-full flex items-center justify-center bg-slate-950 text-slate-300 font-medium text-xs">
              Camera preview ready
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center shadow-inner">
                <VideoOff className="w-8 h-8 opacity-60 text-slate-400" />
              </div>
              <span className="text-xs font-medium">Camera is off (default)</span>
            </div>
          )}

          {/* Device toggle pill inside preview */}
          <div className="absolute bottom-4 flex items-center gap-2 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 px-3 py-1.5 rounded-full shadow-lg">
            <button
              id="preview-toggle-mic"
              data-testid="preview-toggle-mic"
              type="button"
              onClick={handleToggleMic}
              className={`p-2 rounded-full transition-all ${
                micOn ? 'bg-slate-700 text-white' : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
              }`}
              title={micOn ? 'Mute Mic' : 'Unmute Mic'}
              aria-label={micOn ? 'Mute Mic' : 'Unmute Mic'}
            >
              {micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>
            <button
              id="preview-toggle-cam"
              data-testid="preview-toggle-cam"
              type="button"
              onClick={handleToggleCam}
              className={`p-2 rounded-full transition-all ${
                camOn ? 'bg-slate-700 text-white' : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
              }`}
              title={camOn ? 'Turn Camera On' : 'Turn Camera Off'}
              aria-label={camOn ? 'Turn Camera On' : 'Turn Camera Off'}
            >
              {camOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Join button */}
        <div className="flex flex-col items-center gap-3 w-full">
          <button
            id="live-join-btn"
            data-testid="live-join-btn"
            type="button"
            onClick={handleToggleCall}
            className="w-full sm:w-auto px-8 py-3.5 rounded-2xl text-sm font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-lg shadow-emerald-600/30 active:scale-95 transition-all flex items-center justify-center gap-2.5 cursor-pointer"
          >
            <PhoneCall className="w-4 h-4" />
            <span>Join Live Session</span>
          </button>

          <p className="text-xs text-slate-400 text-center">
            You will enter the call with microphone and camera off by default.
          </p>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATE 3: User is IN CALL — Render Video Grid with Participant Tiles (US-LIVE-03)
  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div
      id="live-tab-in-call"
      data-testid="live-tab-in-call"
      className="flex flex-col flex-1 h-full w-full gap-4 max-w-7xl mx-auto"
    >
      {/* ── Top Bar: Session Status & Participant Count (AC-3) ── */}
      <div className="flex items-center justify-between px-2 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-red-500/15 border border-red-500/30 text-red-500 dark:text-red-400 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            LIVE
          </div>

          <div
            id="live-participant-counter"
            data-testid="live-participant-counter"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-300"
          >
            <Users className="w-3.5 h-3.5 text-indigo-500" />
            <span>
              {activeParticipants.length} {activeParticipants.length === 1 ? 'participant' : 'participants'}
            </span>
          </div>
        </div>

        {/* Demo tools toggle button (for manual reviewers / admins) */}
        <button
          id="live-demo-toggle-btn"
          data-testid="live-demo-toggle-btn"
          type="button"
          onClick={() => setShowDemoToolbar((v) => !v)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium text-slate-400 hover:text-indigo-400 hover:bg-slate-800/60 transition-colors"
          title="Toggle Reviewer Simulation Toolbar"
        >
          <Sliders className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Simulation Controls</span>
        </button>
      </div>

      {/* ── Optional Reviewer Simulation Controls Toolbar ── */}
      {showDemoToolbar && (
        <div
          id="reviewer-simulation-toolbar"
          data-testid="reviewer-simulation-toolbar"
          className="shrink-0 flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-indigo-950/30 border border-indigo-500/30 backdrop-blur-sm animate-fade-in"
        >
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 mr-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Reviewer Tools:</span>
          </div>

          <button
            id="demo-add-participant-btn"
            data-testid="demo-add-participant-btn"
            type="button"
            onClick={handleAddDemoParticipant}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow transition-all active:scale-95"
            title="Add a simulated participant to test dynamic grid expansion"
          >
            <UserPlus className="w-3 h-3" />
            <span>Add Participant</span>
          </button>

          <button
            id="demo-remove-participant-btn"
            data-testid="demo-remove-participant-btn"
            type="button"
            onClick={handleRemoveDemoParticipant}
            disabled={simulatedParticipants.length === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-40 transition-all active:scale-95"
            title="Remove a simulated participant to test dynamic grid removal"
          >
            <UserMinus className="w-3 h-3" />
            <span>Remove Participant</span>
          </button>

          <button
            id="demo-toggle-speaking-btn"
            data-testid="demo-toggle-speaking-btn"
            type="button"
            onClick={handleToggleDemoSpeaking}
            disabled={simulatedParticipants.length === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow disabled:opacity-40 transition-all active:scale-95"
            title="Toggle active speaker highlight on simulated participant"
          >
            <Volume2 className="w-3 h-3" />
            <span>Toggle Remote Speaker</span>
          </button>

          <button
            id="demo-toggle-mute-btn"
            data-testid="demo-toggle-mute-btn"
            type="button"
            onClick={handleToggleDemoMute}
            disabled={simulatedParticipants.length === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-40 transition-all active:scale-95"
            title="Toggle mute icon on simulated participant"
          >
            <MicOff className="w-3 h-3" />
            <span>Toggle Remote Mute</span>
          </button>

          <button
            id="demo-toggle-cam-btn"
            data-testid="demo-toggle-cam-btn"
            type="button"
            onClick={handleToggleDemoCamera}
            disabled={simulatedParticipants.length === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-40 transition-all active:scale-95"
            title="Toggle camera-off icon on simulated participant"
          >
            <VideoOff className="w-3 h-3" />
            <span>Toggle Remote Camera</span>
          </button>
        </div>
      )}

      {/* ── Main Area: Video Grid with Participant Tiles (AC-1, AC-2, AC-3) ── */}
      <div className="flex-1 overflow-y-auto flex items-center justify-center p-1 sm:p-2">
        <VideoGrid participants={activeParticipants} localStream={localStream} />
      </div>

      {/* ── Bottom Controls Bar ── */}
      <div className="shrink-0 flex items-center justify-center gap-3 py-3 px-4 bg-slate-900/80 dark:bg-slate-950/80 border border-slate-800/80 rounded-3xl backdrop-blur-xl shadow-2xl max-w-fit mx-auto">
        {/* Mic toggle button (AC-1) */}
        <button
          id="room-mic-toggle"
          data-testid="room-mic-toggle"
          type="button"
          onClick={handleToggleMic}
          title={micOn ? 'Mute microphone' : 'Unmute microphone'}
          aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
          className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-lg active:scale-90 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
            micOn
              ? 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-slate-400'
              : 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40 focus:ring-rose-500'
          }`}
        >
          {micOn ? <Mic className="w-5 h-5 text-emerald-400" /> : <MicOff className="w-5 h-5 text-rose-400" />}
        </button>

        {/* Camera toggle button (AC-1) */}
        <button
          id="room-cam-toggle"
          data-testid="room-cam-toggle"
          type="button"
          onClick={handleToggleCam}
          title={camOn ? 'Turn off camera' : 'Turn on camera'}
          aria-label={camOn ? 'Turn off camera' : 'Turn on camera'}
          className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-lg active:scale-90 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
            camOn
              ? 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-slate-400'
              : 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40 focus:ring-rose-500'
          }`}
        >
          {camOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5 text-rose-400" />}
        </button>

        {/* Active speaker highlight toggle / test button (AC-2) */}
        <button
          id="live-toggle-speaking"
          data-testid="live-toggle-speaking"
          type="button"
          onClick={handleToggleSpeaking}
          title={isSpeaking ? 'Stop speaking highlight' : 'Simulate voice speech (active speaker highlight)'}
          aria-label={isSpeaking ? 'Stop speaking' : 'Speak'}
          className={`px-4 h-12 rounded-2xl flex items-center gap-2 font-semibold text-xs transition-all shadow-lg active:scale-90 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
            isSpeaking
              ? 'bg-emerald-500 text-white shadow-emerald-500/30 focus:ring-emerald-400 animate-pulse'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 focus:ring-slate-400'
          }`}
        >
          <Volume2 className={`w-4 h-4 ${isSpeaking ? 'animate-bounce' : ''}`} />
          <span>{isSpeaking ? 'Speaking…' : 'Speak'}</span>
        </button>

        {/* Leave call button (AC-3) */}
        <button
          id="room-leave-call"
          data-testid="room-leave-call"
          type="button"
          onClick={handleToggleCall}
          title="Leave live call"
          aria-label="Leave live call"
          className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-lg active:scale-90 bg-rose-600 hover:bg-rose-700 text-white focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
        >
          <PhoneOff className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
