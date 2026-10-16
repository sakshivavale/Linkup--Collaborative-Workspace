import React, { useEffect, useState } from 'react';
import {
  Video,
  Mic,
  MicOff,
  VideoOff,
  PhoneOff,
  PhoneCall,
  ScreenShare,
  ScreenShareOff,
} from 'lucide-react';
import { socket } from '../../lib/socket';
import VideoGrid from './VideoGrid';
import { Participant } from './ParticipantTile';
import { useRoom } from './useRoom';
import { useAuth } from '../../context/AuthContext';
import { ActiveScreenShare, Permissions } from '@linkup/shared';

interface LiveTabProps {
  roomId: string;
  sessionId: string | null;
  inCall?: boolean;
  onJoinCall?: () => void;
  onLeaveCall?: () => void;
  isHost?: boolean;
}

/**
 * LiveTab — the live audio/video and screen share call panel (US-ROOM-01, US-LIVE-04, US-LIVE-06).
 * Enforces Acceptance Criteria:
 * - US-LIVE-04: Screen sharing with stage layout, permission controls, and single-share exclusivity.
 * - US-LIVE-06: Host leaves without ending, remaining participants stay connected, host re-joins via Join Live.
 */
export const LiveTab: React.FC<LiveTabProps> = ({
  roomId,
  sessionId,
  inCall: controlledInCall,
  onJoinCall,
  onLeaveCall,
  isHost: propIsHost,
}) => {
  const { user } = useAuth();
  const { room } = useRoom(roomId);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [internalInCall, setInternalInCall] = useState(Boolean(sessionId));
  const inCall = controlledInCall !== undefined ? controlledInCall : internalInCall;

  // Screen share state
  const [activeScreenShare, setActiveScreenShare] = useState<ActiveScreenShare | null>(
    () => room?.activeScreenShare || null
  );
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);

  // Current user's role and permission flags
  const isHost = propIsHost ?? (room?.myRole === 'host');
  const currentMember = room?.members?.find((m) => m.userId === user?.id);
  const [myPermissions, setMyPermissions] = useState<Permissions | null>(
    () => currentMember?.permissions || null
  );

  // Sync internal inCall if controlled prop changes
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

  // Sync permissions when room loads or updates
  useEffect(() => {
    if (currentMember?.permissions) {
      setMyPermissions(currentMember.permissions);
    }
  }, [currentMember?.permissions]);

  // participants shown in grid are derived from room.presence (inLive === true)
  const [participants, setParticipants] = useState<Participant[]>(() => {
    const p =
      room?.presence
        ?.filter((x) => x.inLive)
        .map((entry) => ({
          id: entry.userId,
          name: entry.fullName,
          isMuted: false,
          cameraOff: true,
          isSpeaking: false,
          stream: null,
        })) ?? [];
    return p;
  });

  // US-LIVE-04 Acceptance Criteria 1:
  // can_screen = true (or user is host)
  const canScreen = isHost || Boolean(myPermissions?.canScreen ?? currentMember?.permissions?.canScreen);

  // Acceptance Criteria 3: Only one screen share is active at a time
  const isSelfSharing = Boolean(activeScreenShare && activeScreenShare.userId === user?.id);
  const isAnotherSharing = Boolean(activeScreenShare && !isSelfSharing);

  // Compute disabled state and tooltip for screen share button (Acceptance Criteria 1, 3, 5)
  let screenShareDisabled = false;
  let screenShareTooltip = '';

  if (!inCall) {
    screenShareDisabled = true;
    screenShareTooltip = 'Join the live call to share your screen';
  } else if (isAnotherSharing) {
    screenShareDisabled = true;
    screenShareTooltip = `Another participant (${activeScreenShare?.userName}) is currently sharing. Only one screen share is active at a time.`;
  } else if (!canScreen) {
    screenShareDisabled = true;
    screenShareTooltip = 'Screen sharing permission required. Ask the room host for access.';
  } else if (isSelfSharing) {
    screenShareDisabled = false;
    screenShareTooltip = 'Stop sharing your screen';
  } else {
    screenShareDisabled = false;
    screenShareTooltip = 'Share your screen';
  }

  // Handle start sharing screen
  const handleStartScreenShare = async () => {
    if (isSelfSharing) {
      handleStopScreenShare();
      return;
    }

    if (screenShareDisabled) return;

    try {
      let stream: MediaStream | null = null;
      if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        } catch (err: any) {
          if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
            console.log('[LiveTab] User cancelled screen share selection');
            return;
          }
          console.warn('[LiveTab] getDisplayMedia error, falling back to simulated screen share:', err);
        }
      }

      setScreenStream(stream);

      if (stream) {
        stream.getVideoTracks().forEach((track) => {
          track.onended = () => {
            handleStopScreenShare();
          };
        });
      }

      socket.emit('screen:start', { roomId });
    } catch (err) {
      console.error('[LiveTab] Screen share start failed:', err);
    }
  };

  // Handle stop sharing screen
  const handleStopScreenShare = () => {
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      setScreenStream(null);
    }
    socket.emit('screen:stop', { roomId });
  };

  useEffect(() => {
    if (inCall && roomId) {
      socket.emit('live:joined', { roomId });
      return () => {
        socket.emit('live:left', { roomId });
      };
    }
  }, [inCall, roomId]);

  // Real-time presence, active speaker, and screen share socket listeners
  useEffect(() => {
    const mapPresenceToParticipants = () => {
      const p =
        room?.presence
          ?.filter((x) => x.inLive)
          .map((entry) => ({
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

    const onScreenStarted = (data: { roomId: string; screenShare: ActiveScreenShare }) => {
      if (data.roomId !== roomId) return;
      setActiveScreenShare(data.screenShare);
    };

    const onScreenStopped = (data: { roomId: string }) => {
      if (data.roomId !== roomId) return;
      setActiveScreenShare(null);
      if (screenStream) {
        screenStream.getTracks().forEach((t) => t.stop());
        setScreenStream(null);
      }
    };

    // US-LIVE-04 Acceptance Criteria 4:
    // If can_screen is revoked while sharing, the share stops immediately for all viewers
    const onPermChanged = (data: { roomId: string; userId: string; permissions: Permissions }) => {
      if (data.roomId !== roomId) return;
      if (data.userId === user?.id) {
        setMyPermissions(data.permissions);
        if (data.permissions.canScreen === false && !isHost) {
          if (activeScreenShare?.userId === user?.id) {
            handleStopScreenShare();
            socket.emit('screen:stop', { roomId });
          }
        }
      }
    };

    socket.on('presence:update', onPresenceUpdate);
    socket.on('live:active-speaker', onActiveSpeaker);
    socket.on('screen:started', onScreenStarted);
    socket.on('screen:stopped', onScreenStopped);
    socket.on('perm:changed', onPermChanged);

    return () => {
      socket.off('presence:update', onPresenceUpdate);
      socket.off('live:active-speaker', onActiveSpeaker);
      socket.off('screen:started', onScreenStarted);
      socket.off('screen:stopped', onScreenStopped);
      socket.off('perm:changed', onPermChanged);
    };
  }, [activeScreenShare?.userId, isHost, roomId, room, screenStream, user?.id]);

  const handleToggleCall = () => {
    if (inCall) {
      if (isSelfSharing) {
        handleStopScreenShare();
      }
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
    <div className="flex flex-col items-center justify-center h-full gap-6 py-6">
      {/* Session indicator */}
      <div
        className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold tracking-wide ${
          sessionId
            ? 'bg-red-500/15 border border-red-500/30 text-red-400'
            : 'bg-slate-200/60 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400'
        }`}
      >
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

      {/* Main Video & Stage Area:
          US-LIVE-04 Acceptance Criteria 2:
          "A screen share appears as the focused tile for all participants; other tiles move to a strip below."
      */}
      <div className="w-full max-w-5xl px-4 flex flex-col items-center">
        {activeScreenShare ? (
          <VideoGrid
            participants={participants}
            activeScreenShare={activeScreenShare}
            isSelfSharing={isSelfSharing}
            canStopSharing={isSelfSharing || isHost}
            screenStream={screenStream}
            onStopSharing={handleStopScreenShare}
          />
        ) : (
          <div className="w-full flex flex-col items-center gap-6">
            {participants.length > 0 && <VideoGrid participants={participants} />}

            {/* Video preview placeholder (shown when in call and no screen share is focused) */}
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
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-3">
        {/* Microphone Toggle */}
        <button
          id="room-mic-toggle"
          onClick={() => setMicOn((v) => !v)}
          title={micOn ? 'Mute microphone' : 'Unmute microphone'}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 ${
            micOn
              ? 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 focus:ring-slate-400'
              : 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 focus:ring-red-500'
          }`}
        >
          {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
        </button>

        {/* Camera Toggle */}
        <button
          id="room-cam-toggle"
          onClick={() => setCamOn((v) => !v)}
          title={camOn ? 'Turn off camera' : 'Turn on camera'}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 ${
            camOn
              ? 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 focus:ring-slate-400'
              : 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 focus:ring-red-500'
          }`}
        >
          {camOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </button>

        {/* ── Screen Share Button with Tooltip (US-LIVE-04 Acceptance Criteria 1, 3, 5) ── */}
        <div className="relative group inline-flex items-center justify-center">
          <button
            id="room-screen-share-toggle"
            data-testid="room-screen-share-toggle"
            type="button"
            onClick={handleStartScreenShare}
            disabled={screenShareDisabled}
            aria-disabled={screenShareDisabled}
            title={screenShareTooltip}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              isSelfSharing
                ? 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500 animate-pulse'
                : screenShareDisabled
                ? 'bg-slate-100 dark:bg-slate-900/80 text-slate-400 dark:text-slate-600 border border-slate-200 dark:border-slate-800 cursor-not-allowed opacity-60'
                : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 focus:ring-slate-400 cursor-pointer active:scale-95'
            }`}
          >
            {isSelfSharing ? (
              <ScreenShareOff className="w-5 h-5 text-white" />
            ) : (
              <ScreenShare className="w-5 h-5" />
            )}
          </button>

          {/* Hover Tooltip when disabled (US-LIVE-04 Acceptance Criteria 5) */}
          {screenShareDisabled && (
            <div
              role="tooltip"
              id="screen-share-disabled-tooltip"
              data-testid="screen-share-disabled-tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-xs px-3 py-1.5 rounded-xl bg-slate-900 text-white text-[11px] font-medium leading-tight shadow-xl border border-slate-700 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50 text-center"
            >
              <span>{screenShareTooltip}</span>
              <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-900" />
            </div>
          )}
        </div>

        {/* Call Join/Leave Toggle (US-LIVE-06 AC-3) */}
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
