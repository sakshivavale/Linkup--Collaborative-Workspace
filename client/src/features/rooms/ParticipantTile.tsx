import React, { useEffect, useRef } from 'react';
import { Mic, MicOff, VideoOff, Volume2, Hand } from 'lucide-react';
import { LiveParticipant } from '@linkup/shared';

export interface ParticipantTileProps {
  participant: LiveParticipant;
  localStream?: MediaStream | null;
  totalParticipants?: number;
}

// Generate consistent gradient avatar colors from name
function getAvatarGradient(name: string): string {
  const gradients = [
    'from-indigo-600 to-violet-700',
    'from-blue-600 to-cyan-600',
    'from-emerald-600 to-teal-700',
    'from-rose-600 to-pink-700',
    'from-amber-600 to-orange-700',
    'from-purple-600 to-fuchsia-700',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % gradients.length;
  return gradients[index];
}

function getInitials(name: string): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * ParticipantTile — US-LIVE-03: Video Grid with Participant Tiles (FR-3.4)
 * Acceptance Criteria:
 * 1. Each participant tile shows their name, a mute icon when their mic is off, and a camera-off icon when their camera is off.
 * 2. The currently speaking participant's tile is visually highlighted (active speaker highlight).
 * 3. Tiles update dynamically as participants join/leave.
 */
export const ParticipantTile: React.FC<ParticipantTileProps> = ({
  participant,
  localStream,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Attach local camera stream if available and camera is on
  useEffect(() => {
    if (participant.isLocal && localStream && participant.cameraOn && videoRef.current) {
      videoRef.current.srcObject = localStream;
      videoRef.current.play().catch(() => {});
    }
  }, [participant.isLocal, localStream, participant.cameraOn]);

  const isSpeaking = participant.isSpeaking && participant.micOn;

  return (
    <div
      id={`participant-tile-${participant.userId}`}
      data-testid={`participant-tile-${participant.userId}`}
      data-speaking={isSpeaking ? 'true' : 'false'}
      className={`relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-900 border transition-all duration-300 flex items-center justify-center select-none group shadow-lg ${
        isSpeaking
          ? 'ring-4 ring-emerald-500 border-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.45)] scale-[1.01]'
          : 'border-slate-800/80 hover:border-slate-700'
      }`}
    >
      {/* ── Active Speaker Highlight Badge (AC-2) ── */}
      {isSpeaking && (
        <div
          data-testid="active-speaker-highlight"
          id={`active-speaker-${participant.userId}`}
          className="absolute top-3 left-3 z-20 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/90 text-white text-[11px] font-bold shadow-lg shadow-emerald-500/30 backdrop-blur-md animate-fade-in"
        >
          <Volume2 className="w-3.5 h-3.5 animate-pulse" />
          <span className="tracking-wide uppercase text-[10px]">Speaking</span>
          {/* Animated sound bars */}
          <div className="flex items-end gap-0.5 h-2.5 ml-0.5">
            <span className="w-0.5 bg-white rounded-full animate-bounce h-2" style={{ animationDelay: '0ms' }} />
            <span className="w-0.5 bg-white rounded-full animate-bounce h-3" style={{ animationDelay: '150ms' }} />
            <span className="w-0.5 bg-white rounded-full animate-bounce h-1.5" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      )}

      {/* ── Hand raised indicator ── */}
      {participant.handRaised && (
        <div className="absolute top-3 right-3 z-20 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/90 text-white text-[10px] font-bold shadow-lg animate-bounce">
          <Hand className="w-3.5 h-3.5" />
          <span>Hand Raised</span>
        </div>
      )}

      {/* ── Camera ON: Video Stream ── */}
      {participant.cameraOn ? (
        <div className="w-full h-full relative overflow-hidden bg-black flex items-center justify-center">
          {participant.isLocal && localStream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover -scale-x-100"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-slate-900 via-indigo-950/40 to-slate-900 flex flex-col items-center justify-center relative">
              {/* Simulated camera feed representation */}
              <div className="w-20 h-20 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-2xl shadow-inner animate-pulse">
                {getInitials(participant.fullName)}
              </div>
              <div className="absolute top-3 right-3 flex items-center gap-1 bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>LIVE VIDEO</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── Camera OFF: Avatar with Camera-off icon (AC-1) ── */
        <div
          data-testid="cam-off-indicator"
          id={`cam-off-indicator-${participant.userId}`}
          className="flex flex-col items-center justify-center gap-3 p-4 z-10"
        >
          {/* Avatar with initials */}
          <div className="relative">
            <div
              className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-tr ${getAvatarGradient(
                participant.fullName
              )} text-white font-bold text-lg sm:text-2xl flex items-center justify-center shadow-2xl border-2 border-white/20`}
            >
              {getInitials(participant.fullName)}
            </div>
            {/* Small camera off badge on avatar */}
            <div
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-slate-800 border-2 border-slate-900 text-slate-400 flex items-center justify-center shadow"
              title="Camera is off"
            >
              <VideoOff className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-slate-400 text-xs font-medium bg-slate-800/80 px-2.5 py-1 rounded-full border border-slate-700/60 shadow-sm">
            <VideoOff className="w-3.5 h-3.5 text-slate-500" />
            <span>Camera is off</span>
          </div>
        </div>
      )}

      {/* ── Bottom Overlay: Participant Name & Mute Indicator (AC-1) ── */}
      <div className="absolute inset-x-0 bottom-0 p-3 pt-8 bg-gradient-to-t from-slate-950/95 via-slate-950/60 to-transparent flex items-center justify-between z-20 pointer-events-none">
        {/* Name label */}
        <div className="flex items-center gap-2 min-w-0 pointer-events-auto">
          <span
            id={`participant-name-${participant.userId}`}
            data-testid="participant-name"
            className="text-xs sm:text-sm font-semibold text-white drop-shadow truncate max-w-[140px] sm:max-w-[200px]"
            title={participant.fullName}
          >
            {participant.fullName}
          </span>

          {participant.isLocal && (
            <span className="shrink-0 text-[10px] font-bold bg-slate-800/90 text-slate-300 border border-slate-700/60 px-1.5 py-0.5 rounded-md">
              You
            </span>
          )}

          {participant.role === 'teacher' && (
            <span className="shrink-0 text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded-md">
              Teacher
            </span>
          )}
        </div>

        {/* Indicators: Mic & Camera */}
        <div className="flex items-center gap-1.5 shrink-0 pointer-events-auto">
          {/* Mute indicator (AC-1) */}
          <div
            id={`mute-indicator-${participant.userId}`}
            data-testid="mute-indicator"
            className={`w-7 h-7 rounded-full flex items-center justify-center shadow-md transition-all ${
              !participant.micOn
                ? 'bg-rose-500/90 text-white'
                : 'bg-slate-800/90 text-emerald-400 border border-slate-700/80'
            }`}
            title={participant.micOn ? 'Microphone on' : 'Microphone muted'}
            aria-label={participant.micOn ? 'Microphone on' : 'Microphone muted'}
          >
            {!participant.micOn ? (
              <MicOff className="w-3.5 h-3.5" data-testid="mic-off-icon" />
            ) : (
              <Mic className="w-3.5 h-3.5" data-testid="mic-on-icon" />
            )}
          </div>

          {/* Camera status indicator badge (AC-1) */}
          {!participant.cameraOn && (
            <div
              id={`cam-status-${participant.userId}`}
              data-testid="cam-off-status-badge"
              className="w-7 h-7 rounded-full bg-slate-800/90 text-slate-400 border border-slate-700/80 flex items-center justify-center shadow-md"
              title="Camera off"
              aria-label="Camera off"
            >
              <VideoOff className="w-3.5 h-3.5" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
