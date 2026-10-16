import React, { useEffect, useState } from 'react';
import { Video, Mic, MicOff, VideoOff, PhoneOff, PhoneCall } from 'lucide-react';
import { socket } from '../../lib/socket';

interface LiveTabProps {
  roomId: string;
  sessionId: string | null;
}

/**
 * LiveTab — the live audio/video call panel.
 * Audio continues even when the user switches to other tabs (US-ROOM-01 AC-3).
 * Emits live:joined / live:left to sync real-time presence (US-ROOM-02 AC-3).
 */
export const LiveTab: React.FC<LiveTabProps> = ({ roomId, sessionId }) => {
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [inCall, setInCall] = useState(Boolean(sessionId));

  useEffect(() => {
    if (inCall && roomId) {
      socket.emit('live:joined', { roomId });
      return () => {
        socket.emit('live:left', { roomId });
      };
    }
  }, [inCall, roomId]);

  useEffect(() => {
    if (!sessionId && inCall) {
      setInCall(false);
    }
  }, [sessionId, inCall]);

  const handleToggleCall = () => {
    if (inCall) {
      socket.emit('live:left', { roomId });
      setInCall(false);
    } else {
      socket.emit('live:joined', { roomId });
      setInCall(true);
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

      {/* Video preview placeholder */}
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

        <button
          id="room-leave-call"
          onClick={handleToggleCall}
          title={inCall ? 'Leave call' : 'Join call'}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 ${
            inCall
              ? 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white focus:ring-emerald-500'
          }`}
        >
          {inCall ? <PhoneOff className="w-5 h-5" /> : <PhoneCall className="w-5 h-5" />}
        </button>
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500 text-center max-w-xs">
        Audio continues when you switch tabs — you will stay connected to the live call.
      </p>
    </div>
  );
};
