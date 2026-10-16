import { useEffect, useRef } from 'react';
import { Participant } from './participantUtils';

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

export default function ParticipantTile({ participant }: { participant: Participant }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    if (participant.stream) {
      // Attach stream if provided (WebRTC)
      try {
        videoRef.current.srcObject = participant.stream as any;
        videoRef.current.play().catch(() => {});
      } catch (err) {
        // ignore attach errors in demo
      }
    } else {
      videoRef.current.srcObject = null;
    }
  }, [participant.stream]);

  const ringClass = participant.isSpeaking ? 'ring-4 ring-indigo-400' : 'ring-0';

  return (
    <div className={`relative bg-slate-900 rounded-md overflow-hidden ${ringClass}`}>
      {participant.cameraOff ? (
        <div className="flex items-center justify-center h-40 w-full bg-slate-700">
          <div className="text-white font-medium text-xl">{participant.name.charAt(0).toUpperCase()}</div>
        </div>
      ) : (
        <video ref={videoRef} className="w-full h-40 object-cover bg-black" playsInline muted />
      )}

      <div className="absolute left-0 right-0 bottom-0 p-2 bg-gradient-to-t from-black/75 to-transparent flex items-center justify-between">
        <div className="text-sm text-white truncate">{participant.name}</div>
        <div className="flex items-center gap-2">
          {participant.isMuted && <div className="text-white/90"><MuteIcon /></div>}
          {participant.cameraOff && <div className="text-white/90"><CameraOffIcon /></div>}
        </div>
      </div>
    </div>
  );
}
