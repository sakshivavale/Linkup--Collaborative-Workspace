import { useEffect, useRef } from 'react';
import { Participant } from './participantUtils';

export type { Participant };

const MuteIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 9v6h4l5 5V4l-5 5H9z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2 2l20 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CameraOffIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 10l4-3v10l-4-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2 2l20 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function ParticipantTile({
  participant,
  isStrip = false,
}: {
  participant: Participant;
  isStrip?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Attach video stream to video element when stream is present and camera is on
  useEffect(() => {
    if (!videoRef.current) return;
    if (participant.stream && !participant.cameraOff) {
      try {
        if (participant.isSelf) {
          videoRef.current.muted = true;
        }
        if (videoRef.current.srcObject !== participant.stream) {
          videoRef.current.srcObject = participant.stream as any;
        }
        videoRef.current.play().catch(() => {});
      } catch (err) {
        // ignore attach errors in demo
      }
    } else {
      videoRef.current.srcObject = null;
    }
  }, [participant.stream, participant.cameraOff, participant.isSelf]);

  // For remote participants, play audio even if camera is off
  useEffect(() => {
    if (!audioRef.current || participant.isSelf) return;
    if (participant.stream) {
      try {
        const stream = participant.stream as MediaStream;
        if (stream.getAudioTracks && stream.getAudioTracks().length > 0) {
          if (audioRef.current.srcObject !== stream) {
            audioRef.current.srcObject = stream;
          }
          audioRef.current.play().catch(() => {});
        }
      } catch (err) {
        // ignore audio attach errors
      }
    } else {
      audioRef.current.srcObject = null;
    }
  }, [participant.stream, participant.isSelf]);

  const ringClass = participant.isSpeaking ? 'ring-4 ring-indigo-400' : 'ring-0';

  return (
    <div
      id={`participant-tile-${participant.id}`}
      data-testid={`participant-tile-${participant.id}`}
      className={`relative bg-slate-900 rounded-xl overflow-hidden shadow-md border border-slate-800 ${ringClass} ${
        isStrip ? 'w-44 shrink-0' : 'w-full'
      }`}
    >
      {/* Remote participant audio (plays continuously even if video is off, muted for self to prevent echo) */}
      {!participant.isSelf && (
        <audio
          ref={audioRef}
          autoPlay
          playsInline
          className="hidden"
          data-testid={`participant-audio-${participant.id}`}
        />
      )}

      {/* Hand raised indicator badge (US-PERM-07, FR-4.8) */}
      {participant.handRaised && (
        <div
          id={`participant-hand-raised-${participant.id}`}
          data-testid={`participant-hand-raised-${participant.id}`}
          className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[11px] font-bold flex items-center gap-1 shadow-md z-10 animate-bounce"
          title={`${participant.name} raised hand`}
        >
          <span>✋</span>
        </div>
      )}

      {participant.cameraOff ? (
        <div
          className={`flex items-center justify-center w-full bg-slate-800/90 ${
            isStrip ? 'h-28' : 'h-36 sm:h-40'
          }`}
        >
          <div className="w-10 h-10 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-white font-bold text-sm shadow">
            {participant.name.charAt(0).toUpperCase()}
          </div>
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full ${isStrip ? 'h-28' : 'h-36 sm:h-40'} object-cover bg-black`}
        />
      )}

      <div className="absolute left-0 right-0 bottom-0 p-2 bg-gradient-to-t from-black/85 via-black/50 to-transparent flex items-center justify-between">
        <div className="text-xs font-medium text-white truncate max-w-[100px]">
          {participant.name} {participant.isSelf ? '(You)' : ''}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {participant.isMuted && (
            <div
              className="text-white/80"
              data-testid={`participant-muted-${participant.id}`}
              title="Microphone muted"
            >
              <MuteIcon />
            </div>
          )}
          {participant.cameraOff && (
            <div
              className="text-white/80"
              data-testid={`participant-camera-off-${participant.id}`}
              title="Camera off"
            >
              <CameraOffIcon />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
