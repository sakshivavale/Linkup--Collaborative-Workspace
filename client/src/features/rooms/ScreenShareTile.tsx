import React, { useEffect, useRef, useState } from 'react';
import {
  Monitor,
  Maximize2,
  Minimize2,
  StopCircle,
  Radio,
  Sparkles,
} from 'lucide-react';

interface ScreenShareTileProps {
  sharerName: string;
  isSelf: boolean;
  canStop: boolean; // true if isSelf or isHost
  stream?: MediaStream | null;
  onStop: () => void;
}

export const ScreenShareTile: React.FC<ScreenShareTileProps> = ({
  sharerName,
  isSelf,
  canStop,
  stream,
  onStop,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!videoRef.current) return;
    if (stream) {
      try {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      } catch (err) {
        console.warn('[ScreenShareTile] Error attaching stream:', err);
      }
    } else {
      videoRef.current.srcObject = null;
    }
  }, [stream]);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.warn('[ScreenShareTile] Fullscreen error:', err);
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  return (
    <div
      ref={containerRef}
      id="focused-screen-share-tile"
      data-testid="focused-screen-share-tile"
      className="relative w-full max-w-5xl aspect-video max-h-[62vh] rounded-2xl bg-slate-950 border border-slate-700/60 shadow-2xl overflow-hidden flex flex-col group transition-all"
    >
      {/* Top stage header overlay */}
      <div className="absolute top-0 inset-x-0 z-20 px-4 py-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between pointer-events-auto">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-semibold backdrop-blur-md">
            <Monitor className="w-3.5 h-3.5 text-indigo-400" />
            <span id="screen-share-sharer-name" data-testid="screen-share-sharer-name">
              {isSelf ? 'Your Screen Share' : `${sharerName}'s Screen`}
            </span>
          </div>

          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/30 text-[10px] font-bold text-red-400 uppercase tracking-wider backdrop-blur-md">
            <Radio className="w-2.5 h-2.5 animate-pulse text-red-500" />
            <span>Live Stage</span>
          </div>

          <span className="hidden sm:inline-flex text-[10px] text-slate-400 font-mono bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/40">
            1080p • 60fps
          </span>
        </div>

        <div className="flex items-center gap-2">
          {canStop && (
            <button
              id="stage-stop-screen-share-btn"
              data-testid="stage-stop-screen-share-btn"
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600/90 hover:bg-red-600 text-white text-xs font-semibold shadow-lg shadow-red-500/20 active:scale-95 transition-all"
              title="Stop sharing screen"
            >
              <StopCircle className="w-3.5 h-3.5" />
              <span>{isSelf ? 'Stop Sharing' : 'Stop Stream'}</span>
            </button>
          )}

          <button
            id="stage-fullscreen-toggle"
            type="button"
            onClick={toggleFullscreen}
            className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition-colors"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Video Display / Simulated Canvas */}
      <div className="relative flex-1 w-full h-full bg-slate-950 flex items-center justify-center overflow-hidden">
        {stream ? (
          <video
            ref={videoRef}
            id="active-screen-share-video"
            data-testid="active-screen-share-video"
            autoPlay
            playsInline
            muted
            className="w-full h-full object-contain bg-black"
          />
        ) : (
          <div className="relative w-full h-full flex flex-col items-center justify-center p-6 bg-gradient-to-b from-slate-900 via-slate-950 to-black select-none">
            {/* Elegant simulated presentation background graphics */}
            <div className="absolute inset-0 opacity-15 pointer-events-none bg-[radial-gradient(#4f46e5_1px,transparent_1px)] [background-size:16px_16px]" />

            <div className="relative z-10 flex flex-col items-center gap-4 text-center max-w-md px-4">
              <div className="relative">
                <div className="w-20 h-20 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-xl shadow-indigo-500/10 backdrop-blur-sm animate-pulse">
                  <Monitor className="w-10 h-10" />
                </div>
                <div className="absolute -bottom-1 -right-1 p-1 rounded-full bg-emerald-500 text-slate-950">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
              </div>

              <div>
                <h3 className="text-base font-bold text-white tracking-tight">
                  {isSelf ? 'You are sharing your screen' : `${sharerName} is presenting`}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Active presentation broadcast to all participants in this live room.
                </p>
              </div>

              {isSelf && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  Your screen is currently active
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Subtle bottom indicator */}
      <div className="absolute bottom-2 left-4 z-20 pointer-events-none opacity-70 group-hover:opacity-100 transition-opacity">
        <span className="text-[10px] text-slate-400 tracking-wide font-medium bg-black/60 px-2 py-0.5 rounded-md backdrop-blur-sm">
          Focused Screen Share
        </span>
      </div>
    </div>
  );
};
