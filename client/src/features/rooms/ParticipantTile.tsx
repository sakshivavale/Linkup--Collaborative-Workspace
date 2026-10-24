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
  participant?: Participant | null;
  isStrip?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const participantId = participant?.id;
  const participantStream = participant?.stream;
  const cameraOff = Boolean(participant?.cameraOff);
  const isSelf = Boolean(participant?.isSelf);
  const isSpeaking = Boolean(participant?.isSpeaking);
  const handRaised = Boolean(participant?.handRaised);
  const name = participant?.name || 'Anonymous';
  const isMuted = Boolean(participant?.isMuted);

  // Attach video stream to video element when stream is present and camera is on
  useEffect(() => {
    if (!videoRef.current) return;
    if (participantStream && !cameraOff) {
      try {
        if (isSelf) {
          videoRef.current.muted = true;
        }
        if (videoRef.current.srcObject !== participantStream) {
          videoRef.current.srcObject = participantStream as any;
        }
        videoRef.current.play().catch(() => {});
      } catch (err) {
        // ignore attach errors in demo
      }
    } else {
      videoRef.current.srcObject = null;
    }
  }, [participantStream, cameraOff, isSelf]);

  // For remote participants, play audio even if camera is off
  useEffect(() => {
    if (!audioRef.current || isSelf) return;
    if (participantStream) {
      try {
        const stream = participantStream as MediaStream;
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
  }, [participantStream, isSelf]);

  if (!participant || !participantId) {
    return null;
  }

  const ringClass = isSpeaking ? 'ring-4 ring-indigo-400' : 'ring-0';

  return (
    <div
      id={`participant-tile-${participantId}`}
      data-testid={`participant-tile-${participantId}`}
      className={`relative bg-slate-900 rounded-xl overflow-hidden shadow-md border border-slate-800 ${ringClass} ${
        isStrip ? 'w-44 shrink-0' : 'w-full'
      }`}
    >
      {/* Remote participant audio (plays continuously even if video is off, muted for self to prevent echo) */}
      {!isSelf && (
        <audio
          ref={audioRef}
          autoPlay
          playsInline
          className="hidden"
          data-testid={`participant-audio-${participantId}`}
        />
      )}

      {/* Hand raised indicator badge (US-PERM-07, FR-4.8) */}
      {handRaised && (
        <div
          id={`participant-hand-raised-${participantId}`}
          data-testid={`participant-hand-raised-${participantId}`}
          className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[11px] font-bold flex items-center gap-1 shadow-md z-10 animate-bounce"
          title={`${name} raised hand`}
        >
          <span>✋</span>
        </div>
      )}

      {cameraOff ? (
        <div
          className={`flex items-center justify-center w-full bg-slate-800/90 ${
            isStrip ? 'h-28' : 'h-36 sm:h-40'
          }`}
        >
          <div className="w-10 h-10 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-white font-bold text-sm shadow">
            {(name.charAt(0) || '?').toUpperCase()}
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
          {name} {isSelf ? '(You)' : ''}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isMuted && (
            <div
              className="text-white/80"
              data-testid={`participant-muted-${participantId}`}
              title="Microphone muted"
            >
              <MuteIcon />
            </div>
          )}
          {cameraOff && (
            <div
              className="text-white/80"
              data-testid={`participant-camera-off-${participantId}`}
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
