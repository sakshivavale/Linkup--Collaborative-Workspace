import React, { useEffect, useState, useRef } from 'react';
import {
  Video,
  Mic,
  MicOff,
  VideoOff,
  PhoneOff,
  PhoneCall,
  ScreenShare,
  ScreenShareOff,
  Sliders,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import { socket } from '../../lib/socket';
import VideoGrid from './VideoGrid';
import { Participant } from './ParticipantTile';
import { useRoom } from './useRoom';
import { useAuth } from '../../context/AuthContext';
import { ActiveScreenShare, Permissions } from '@linkup/shared';
import { useMediaDevices } from './useMediaDevices';
import { DevicePickerModal } from './DevicePickerModal';

interface LiveTabProps {
  roomId: string;
  sessionId: string | null;
  inCall?: boolean;
  onJoinCall?: () => void;
  onLeaveCall?: () => void;
  isHost?: boolean;
  disabled?: boolean;
  isReconnecting?: boolean;
}

/**
 * LiveTab — the live audio/video and screen share call panel (US-ROOM-01, US-LIVE-04, US-LIVE-06, US-LIVE-07, US-LIVE-08).
 * Enforces Acceptance Criteria:
 * - US-LIVE-04: Screen sharing with stage layout, permission controls, and single-share exclusivity.
 * - US-LIVE-06: Host leaves without ending, remaining participants stay connected, host re-joins via Join Live.
 * - US-LIVE-07: Chat input, media controls, and other interactive elements are disabled while reconnecting.
 * - US-LIVE-08: Media device picker accessible from control bar, switching devices does not disconnect from call.
 */
export const LiveTab: React.FC<LiveTabProps> = ({
  roomId,
  sessionId,
  inCall: controlledInCall,
  onJoinCall,
  onLeaveCall,
  isHost: propIsHost,
  disabled = false,
  isReconnecting = false,
}) => {
  const isControlsDisabled = Boolean(disabled || isReconnecting);
  const { user } = useAuth();
  const { room } = useRoom(roomId);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [internalInCall, setInternalInCall] = useState(Boolean(sessionId));
  const inCall = controlledInCall !== undefined ? controlledInCall : internalInCall;

  // Media devices management (US-LIVE-08)
  const [isDevicePickerOpen, setIsDevicePickerOpen] = useState(false);
  const [deviceNotification, setDeviceNotification] = useState<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  const mediaDevices = useMediaDevices({
    onDeviceSwitched: (kind, _deviceId, label) => {
      const type = kind === 'audioinput' ? 'Microphone' : kind === 'videoinput' ? 'Camera' : 'Speaker';
      setDeviceNotification(`Switched ${type} to: ${label}`);
      setTimeout(() => setDeviceNotification(null), 3000);
    },
  });

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

  // Handle local camera preview stream
  useEffect(() => {
    let active = true;
    const updateCameraStream = async () => {
      if (!camOn || !inCall) {
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = null;
        }
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          const constraints: MediaStreamConstraints = {
            video:
              mediaDevices.selectedVideoInput !== 'default'
                ? { deviceId: { exact: mediaDevices.selectedVideoInput } }
                : true,
          };
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (active) {
            mediaDevices.setLocalStream((prev) => {
              if (prev) {
                prev.getVideoTracks().forEach((t) => t.stop());
                const audioTracks = prev.getAudioTracks();
                return new MediaStream([...audioTracks, ...stream.getVideoTracks()]);
              }
              return stream;
            });
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = stream;
              localVideoRef.current.play().catch(() => {});
            }
          }
        } catch (err) {
          console.warn('[LiveTab] Camera getUserMedia error:', err);
        }
      }
    };

    updateCameraStream();

    return () => {
      active = false;
    };
  }, [camOn, inCall, mediaDevices.selectedVideoInput]);

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

  if (isControlsDisabled) {
    screenShareDisabled = true;
    screenShareTooltip = 'Controls disabled while reconnecting...';
  } else if (!inCall) {
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
        if (!isHost) {
          if (data.permissions.canScreen === false) {
            if (activeScreenShare?.userId === user?.id) {
              handleStopScreenShare();
              socket.emit('screen:stop', { roomId });
            }
          }
          if (data.permissions.canMic === false) {
            setMicOn(false);
          }
          if (data.permissions.canCamera === false) {
            setCamOn(false);
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

  const activeCamLabel =
    mediaDevices.videoInputs.find((d) => d.deviceId === mediaDevices.selectedVideoInput)?.label || 'Camera';
  const activeMicLabel =
    mediaDevices.audioInputs.find((d) => d.deviceId === mediaDevices.selectedAudioInput)?.label || 'Microphone';

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
            disabled={isControlsDisabled}
            onClick={handleToggleCall}
            className={`inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-md shadow-emerald-600/30 active:scale-95 transition-all w-full sm:w-auto ${
              isControlsDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'
            }`}
            title={isControlsDisabled ? 'Reconnecting...' : 'Join Live'}
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

            {/* Video preview & active device indicators (shown when in call and no screen share is focused) */}
            {inCall && (
              <div className="relative w-full max-w-xl aspect-video rounded-2xl bg-slate-900/80 dark:bg-black/60 border border-slate-700/50 overflow-hidden flex items-center justify-center shadow-2xl">
                {camOn ? (
                  <video
                    ref={localVideoRef}
                    id="live-local-video-preview"
                    data-testid="live-local-video-preview"
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 text-slate-500">
                    <VideoOff className="w-12 h-12 opacity-40" />
                    <span className="text-xs font-medium">Camera is off</span>
                  </div>
                )}

                {/* Active device pill indicators (US-LIVE-08) */}
                <div className="absolute top-3 left-3 flex flex-wrap items-center gap-1.5 z-10 pointer-events-none">
                  <div
                    id="active-camera-pill"
                    data-testid="active-camera-pill"
                    className="px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-medium text-slate-300 flex items-center gap-1"
                  >
                    <Video className="w-3 h-3 text-indigo-400" />
                    <span className="truncate max-w-[120px]">{activeCamLabel}</span>
                  </div>
                  <div
                    id="active-mic-pill"
                    data-testid="active-mic-pill"
                    className="px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-medium text-slate-300 flex items-center gap-1"
                  >
                    <Mic className="w-3 h-3 text-emerald-400" />
                    <span className="truncate max-w-[120px]">{activeMicLabel}</span>
                  </div>
                </div>

                {/* Self-view PiP / Cam status */}
                <div className="absolute bottom-3 right-3 px-2 py-1 rounded-lg bg-slate-800/90 border border-slate-700/60 flex items-center gap-1.5 text-xs text-slate-300 z-10">
                  {camOn ? (
                    <Video className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <VideoOff className="w-3.5 h-3.5 text-slate-500" />
                  )}
                  <span className="text-[10px] font-semibold">{camOn ? 'Live Video' : 'Cam Off'}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Device switch notification toast */}
      {deviceNotification && (
        <div
          id="device-switch-toast"
          data-testid="device-switch-toast"
          className="px-4 py-1.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-medium flex items-center gap-2 shadow-lg backdrop-blur-sm animate-fade-in"
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span>{deviceNotification}</span>
        </div>
      )}

      {/* ── Controls bar (US-ROOM-01, US-LIVE-04, US-LIVE-06, US-LIVE-07, US-LIVE-08) ── */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Microphone Toggle & Quick Switch Menu */}
        <div className="relative inline-flex items-center">
          <button
            id="room-mic-toggle"
            data-testid="room-mic-toggle"
            disabled={isControlsDisabled || (!isHost && myPermissions?.canMic === false)}
            onClick={() => setMicOn((v) => !v)}
            title={
              isControlsDisabled
                ? 'Reconnecting...'
                : !isHost && myPermissions?.canMic === false
                ? 'Teacher turned off your microphone'
                : micOn
                ? 'Mute microphone'
                : 'Unmute microphone'
            }
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              isControlsDisabled || (!isHost && myPermissions?.canMic === false)
                ? 'opacity-50 cursor-not-allowed bg-slate-200 dark:bg-slate-800 text-slate-400'
                : micOn
                ? 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 focus:ring-slate-400'
                : 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 focus:ring-red-500'
            }`}
          >
            {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>
          <button
            id="room-mic-device-menu-btn"
            data-testid="room-mic-device-menu-btn"
            type="button"
            disabled={isControlsDisabled || (!isHost && myPermissions?.canMic === false)}
            onClick={() => setIsDevicePickerOpen(true)}
            title="Switch microphone"
            aria-label="Switch microphone"
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-slate-700 hover:bg-indigo-600 text-slate-200 hover:text-white flex items-center justify-center text-[10px] shadow border border-slate-600 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>

        {/* Camera Toggle & Quick Switch Menu */}
        <div className="relative inline-flex items-center">
          <button
            id="room-cam-toggle"
            data-testid="room-cam-toggle"
            disabled={isControlsDisabled || (!isHost && myPermissions?.canCamera === false)}
            onClick={() => setCamOn((v) => !v)}
            title={
              isControlsDisabled
                ? 'Reconnecting...'
                : !isHost && myPermissions?.canCamera === false
                ? 'Teacher turned off your camera'
                : camOn
                ? 'Turn off camera'
                : 'Turn on camera'
            }
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              isControlsDisabled || (!isHost && myPermissions?.canCamera === false)
                ? 'opacity-50 cursor-not-allowed bg-slate-200 dark:bg-slate-800 text-slate-400'
                : camOn
                ? 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 focus:ring-slate-400'
                : 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 focus:ring-red-500'
            }`}
          >
            {camOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>
          <button
            id="room-cam-device-menu-btn"
            data-testid="room-cam-device-menu-btn"
            type="button"
            disabled={isControlsDisabled || (!isHost && myPermissions?.canCamera === false)}
            onClick={() => setIsDevicePickerOpen(true)}
            title="Switch camera"
            aria-label="Switch camera"
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-slate-700 hover:bg-indigo-600 text-slate-200 hover:text-white flex items-center justify-center text-[10px] shadow border border-slate-600 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>

        {/* ── Screen Share Button with Tooltip (US-LIVE-04 Acceptance Criteria 1, 3, 5, US-LIVE-07 AC-2) ── */}
        <div className="relative group inline-flex items-center justify-center">
          <button
            id="room-screen-share-toggle"
            data-testid="room-screen-share-toggle"
            type="button"
            onClick={handleStartScreenShare}
            disabled={screenShareDisabled || isControlsDisabled}
            aria-disabled={screenShareDisabled || isControlsDisabled}
            title={screenShareTooltip}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              isControlsDisabled
                ? 'bg-slate-100 dark:bg-slate-900/80 text-slate-400 dark:text-slate-600 border border-slate-200 dark:border-slate-800 cursor-not-allowed opacity-50'
                : isSelfSharing
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

        {/* ── US-LIVE-08: Dedicated Device-Picker Control accessible from the control bar ── */}
        <button
          id="room-device-picker-btn"
          data-testid="room-device-picker-btn"
          type="button"
          disabled={isControlsDisabled}
          onClick={() => setIsDevicePickerOpen(true)}
          title={isControlsDisabled ? 'Reconnecting...' : 'Media Device Settings: Switch Microphone & Camera'}
          aria-label="Media Device Settings"
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 ${
            isControlsDisabled
              ? 'opacity-50 cursor-not-allowed bg-slate-200 dark:bg-slate-800 text-slate-400'
              : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 focus:ring-indigo-400 cursor-pointer active:scale-95'
          }`}
        >
          <Sliders className="w-5 h-5" />
        </button>

        {/* Call Join/Leave Toggle (US-LIVE-06 AC-3, US-LIVE-07 AC-2) */}
        {inCall ? (
          <button
            id="room-leave-call"
            data-testid="room-leave-call"
            disabled={isControlsDisabled}
            onClick={handleToggleCall}
            title={isControlsDisabled ? 'Reconnecting...' : 'Leave call'}
            aria-label="Leave call"
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 bg-red-600 hover:bg-red-700 text-white focus:ring-red-500 ${
              isControlsDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'
            }`}
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        ) : (
          <button
            id="room-join-live-btn-control"
            data-testid="join-live-btn"
            disabled={isControlsDisabled}
            onClick={handleToggleCall}
            title={isControlsDisabled ? 'Reconnecting...' : 'Join Live'}
            aria-label="Join Live"
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 bg-emerald-600 hover:bg-emerald-700 text-white focus:ring-emerald-500 ${
              isControlsDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'
            }`}
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

      {/* ── US-LIVE-08 Device Picker Modal ── */}
      <DevicePickerModal
        isOpen={isDevicePickerOpen}
        onClose={() => setIsDevicePickerOpen(false)}
        audioInputs={mediaDevices.audioInputs}
        videoInputs={mediaDevices.videoInputs}
        audioOutputs={mediaDevices.audioOutputs}
        selectedAudioInput={mediaDevices.selectedAudioInput}
        selectedVideoInput={mediaDevices.selectedVideoInput}
        selectedAudioOutput={mediaDevices.selectedAudioOutput}
        onSelectAudioInput={mediaDevices.switchAudioInput}
        onSelectVideoInput={mediaDevices.switchVideoInput}
        onSelectAudioOutput={mediaDevices.switchAudioOutput}
        onRefreshDevices={mediaDevices.refreshDevices}
        onRequestPermissions={mediaDevices.requestPermissions}
        onPlayTestSound={mediaDevices.playTestSound}
        hasPermission={mediaDevices.hasPermission}
        audioLevel={mediaDevices.audioLevel}
        previewStream={mediaDevices.previewStream}
        onStartPreview={mediaDevices.startCameraPreview}
        onStopPreview={mediaDevices.stopCameraPreview}
        inCall={inCall}
      />
    </div>
  );
};
