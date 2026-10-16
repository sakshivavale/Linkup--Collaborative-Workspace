import React, { useEffect, useState } from 'react';
import { Video, Mic, MicOff, VideoOff, PhoneOff, PhoneCall } from 'lucide-react';
import { socket } from '../../lib/socket';
import VideoGrid from './VideoGrid';
import { Participant } from './ParticipantTile';
import { useRoom } from './useRoom';

interface LiveTabProps {
  roomId: string;
  sessionId: string | null;
  inCall?: boolean;
  onJoinCall?: () => void;
  onLeaveCall?: () => void;
  isHost?: boolean;
}

/**
 * LiveTab — the live audio/video call panel.
 * Audio continues even when the user switches to other tabs (US-ROOM-01 AC-3).
 * Emits live:joined / live:left to sync real-time presence (US-ROOM-02 AC-3).
 * Supports host leaving without ending and re-joining via "Join Live" (US-LIVE-06, FR-3.7).
 */
export const LiveTab: React.FC<LiveTabProps> = ({
  roomId,
  sessionId,
  inCall: controlledInCall,
  onJoinCall,
  onLeaveCall,
  isHost = false,
}) => {
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [internalInCall, setInternalInCall] = useState(Boolean(sessionId));
  const inCall = controlledInCall !== undefined ? controlledInCall : internalInCall;
  const { room } = useRoom(roomId);

  // Sync internal state if controlled state is updated or session ends
  useEffect(() => {
    if (controlledInCall !== undefined) {
      setInternalInCall(controlledInCall);
    }
  }, [controlledInCall]);

  useEffect(() => {
    if (!sessionId && inCall) {
      if (onLeaveCall) onLeaveCall();
      setInternalInCall(false);
    }
  }, [sessionId, inCall, onLeaveCall]);

  // participants shown in grid are derived from room.presence (inLive === true)
  const [participants, setParticipants] = useState<Participant[]>(() => {
    const p = room?.presence?.filter((x) => x.inLive).map((entry) => ({
      id: entry.userId,
      name: entry.fullName,
      isMuted: false,
      cameraOff: true,
      isSpeaking: false,
      stream: null,
    })) ?? [];
    return p;
  });

  useEffect(() => {
    if (inCall && roomId) {
      socket.emit('live:joined', { roomId });
      return () => {
        socket.emit('live:left', { roomId });
      };
    }
  }, [inCall, roomId]);

  // Update participant list when room presence changes
  useEffect(() => {
    const mapPresenceToParticipants = () => {
      const p = room?.presence?.filter((x) => x.inLive).map((entry) => ({
        id: entry.userId,
        name: entry.fullName,
        isMuted: false,
        cameraOff: true,
        isSpeaking: false,
        stream: null,
      })) ?? [];
      setParticipants(p);
    };

    mapPresenceToParticipants();

    const onPresenceUpdate = (data: { roomId: string; presence: any[] }) => {
      if (data.roomId !== roomId) return;
      mapPresenceToParticipants();
    };

    const onActiveSpeaker = (data: { roomId: string; userId: string | null }) => {
      if (data.roomId !== roomId) return;
      setParticipants((prev) => prev.map((p) => ({ ...p, isSpeaking: p.id === data.userId })));
    };

    socket.on('presence:update', onPresenceUpdate);
    socket.on('live:active-speaker', onActiveSpeaker);

    return () => {
      socket.off('presence:update', onPresenceUpdate);
      socket.off('live:active-speaker', onActiveSpeaker);
    };
  }, [room, roomId]);

  const handleToggleCall = () => {
    if (inCall) {
      socket.emit('live:left', { roomId });
      if (onLeaveCall) onLeaveCall();
      setInternalInCall(false);
    } else {
      socket.emit('live:joined', { roomId });
      if (onJoinCall) onJoinCall();
      setInternalInCall(true);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 py-12">
      {/* Session indicator */}
      <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold tracking-wide ${
        sessionId
          ? 'bg-red-500/15 border border-red-500/30 text-red-400'
          : 'bg-slate-200/60 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400'
      }`}>
        <span className={`w-2 h-2 rounded-full ${sessionId ? 'bg-red-500 animate-pulse' : 'bg-slate-400'}`} />
        {sessionId ? 'Live Session Active' : 'No Active Session'}
      </div>

      {/* When session is active but current user is not in the call: US-LIVE-06 AC-3 Join Live action */}
      {sessionId && !inCall && (
        <div
          id="room-join-live-card"
          data-testid="room-join-live-card"
          className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-white/70 dark:bg-slate-900/70 border border-emerald-500/30 shadow-xl backdrop-blur-sm max-w-md w-full text-center animate-fade-in"
        >
          <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-500 dark:text-emerald-400">
            <PhoneCall className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {isHost ? 'You left the live call' : 'Live Session in Progress'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
              {isHost
                ? 'The session remains active for other participants. Click below to re-join the call.'
                : 'Click below to connect your audio and video to the ongoing class.'}
            </p>
          </div>
          <button
            id="room-join-live-btn"
            data-testid="room-join-live-btn"
            type="button"
            onClick={handleToggleCall}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-md shadow-emerald-600/30 active:scale-95 transition-all cursor-pointer w-full sm:w-auto"
            title="Join Live"
            aria-label="Join Live"
          >
            <PhoneCall className="w-4 h-4" />
            <span>Join Live</span>
          </button>
        </div>
      )}

      {/* Video grid of in-call participants (visible even if host left, US-LIVE-06 AC-2) */}
      {participants.length > 0 && (
        <div className="w-full max-w-4xl px-4">
          <div className="text-xs font-semibold text-slate-400 dark:text-slate-500 mb-2 px-1">
            Connected Participants ({participants.length})
          </div>
          <VideoGrid participants={participants} />
        </div>
      )}

      {/* Video preview placeholder (only when inCall) */}
      {inCall && (
        <div className="relative w-full max-w-xl aspect-video rounded-2xl bg-slate-900/80 dark:bg-black/60 border border-slate-700/50 overflow-hidden flex items-center justify-center shadow-2xl">
          {camOn ? (
            <div className="text-slate-400 text-sm font-medium">Camera preview (integration pending)</div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-slate-500">
              <VideoOff className="w-12 h-12 opacity-40" />
              <span className="text-xs font-medium">Camera is off</span>
            </div>
          )}
          {/* Self-view PiP */}
          <div className="absolute bottom-3 right-3 w-24 aspect-video rounded-lg bg-slate-800/90 border border-slate-700/60 flex items-center justify-center">
            <VideoOff className="w-5 h-5 text-slate-600" />
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div className="flex items-center gap-3">
        <button
          id="room-mic-toggle"
          onClick={() => setMicOn(v => !v)}
          title={micOn ? 'Mute microphone' : 'Unmute microphone'}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 ${
            micOn
              ? 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 focus:ring-slate-400'
              : 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 focus:ring-red-500'
          }`}
        >
          {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
        </button>

        <button
          id="room-cam-toggle"
          onClick={() => setCamOn(v => !v)}
          title={camOn ? 'Turn off camera' : 'Turn on camera'}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 ${
            camOn
              ? 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 focus:ring-slate-400'
              : 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 focus:ring-red-500'
          }`}
        >
          {camOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </button>

        {inCall ? (
          <button
            id="room-leave-call"
            data-testid="room-leave-call"
            onClick={handleToggleCall}
            title="Leave call"
            aria-label="Leave call"
            className="w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 bg-red-600 hover:bg-red-700 text-white focus:ring-red-500 cursor-pointer"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        ) : (
          <button
            id="room-join-live-btn-control"
            data-testid="join-live-btn"
            onClick={handleToggleCall}
            title="Join Live"
            aria-label="Join Live"
            className="w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 bg-emerald-600 hover:bg-emerald-700 text-white focus:ring-emerald-500 cursor-pointer"
          >
            <PhoneCall className="w-5 h-5" />
          </button>
        )}
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500 text-center max-w-xs">
        {sessionId
          ? 'Audio continues when you switch tabs — you will stay connected to the live call.'
          : 'Waiting for the teacher to start the session.'}
      </p>
    </div>
  );
};
