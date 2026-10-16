import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Mic,
  Video,
  Volume2,
  RefreshCw,
  Check,
  ShieldAlert,
  Play,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { DeviceInfo } from './useMediaDevices';

interface DevicePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioInputs: DeviceInfo[];
  videoInputs: DeviceInfo[];
  audioOutputs: DeviceInfo[];
  selectedAudioInput: string;
  selectedVideoInput: string;
  selectedAudioOutput: string;
  onSelectAudioInput: (deviceId: string) => Promise<boolean>;
  onSelectVideoInput: (deviceId: string) => Promise<boolean>;
  onSelectAudioOutput: (deviceId: string) => Promise<boolean>;
  onRefreshDevices: () => Promise<any>;
  onRequestPermissions: () => Promise<boolean>;
  onPlayTestSound: () => Promise<void>;
  hasPermission: boolean;
  audioLevel?: number;
  previewStream?: MediaStream | null;
  onStartPreview?: () => void;
  onStopPreview?: () => void;
  inCall?: boolean;
}

/**
 * DevicePickerModal:
 * Interactive modal for switching microphones, cameras, and audio output devices (US-LIVE-08).
 * Acceptance Criteria:
 * - A device-picker control is accessible from the control bar.
 * - Switching does not disconnect the user from the call.
 */
export const DevicePickerModal: React.FC<DevicePickerModalProps> = ({
  isOpen,
  onClose,
  audioInputs,
  videoInputs,
  audioOutputs,
  selectedAudioInput,
  selectedVideoInput,
  selectedAudioOutput,
  onSelectAudioInput,
  onSelectVideoInput,
  onSelectAudioOutput,
  onRefreshDevices,
  onRequestPermissions,
  onPlayTestSound,
  hasPermission,
  audioLevel = 0,
  previewStream = null,
  onStartPreview,
  onStopPreview,
  inCall = false,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'audio' | 'video'>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTestingSound, setIsTestingSound] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  // Mount/unmount camera preview when modal opens/closes
  useEffect(() => {
    if (isOpen && onStartPreview) {
      onStartPreview();
    }
    return () => {
      if (onStopPreview) {
        onStopPreview();
      }
    };
  }, [isOpen, onStartPreview, onStopPreview]);

  // Bind preview stream to video element
  useEffect(() => {
    if (previewVideoRef.current) {
      if (previewStream) {
        previewVideoRef.current.srcObject = previewStream;
        previewVideoRef.current.play().catch(() => {});
      } else {
        previewVideoRef.current.srcObject = null;
      }
    }
  }, [previewStream]);

  if (!isOpen) return null;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefreshDevices();
      setFeedbackMessage('Devices refreshed');
      setTimeout(() => setFeedbackMessage(null), 2000);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAudioChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const deviceId = e.target.value;
    const ok = await onSelectAudioInput(deviceId);
    if (ok) {
      const dev = audioInputs.find((d) => d.deviceId === deviceId);
      setFeedbackMessage(`Switched microphone to ${dev?.label || 'device'}`);
      setTimeout(() => setFeedbackMessage(null), 2500);
    }
  };

  const handleVideoChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const deviceId = e.target.value;
    const ok = await onSelectVideoInput(deviceId);
    if (ok) {
      const dev = videoInputs.find((d) => d.deviceId === deviceId);
      setFeedbackMessage(`Switched camera to ${dev?.label || 'device'}`);
      setTimeout(() => setFeedbackMessage(null), 2500);
    }
  };

  const handleOutputChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const deviceId = e.target.value;
    const ok = await onSelectAudioOutput(deviceId);
    if (ok) {
      const dev = audioOutputs.find((d) => d.deviceId === deviceId);
      setFeedbackMessage(`Switched speaker to ${dev?.label || 'device'}`);
      setTimeout(() => setFeedbackMessage(null), 2500);
    }
  };

  const handleTestSound = async () => {
    setIsTestingSound(true);
    await onPlayTestSound();
    setTimeout(() => setIsTestingSound(false), 600);
  };

  const currentMic = audioInputs.find((d) => d.deviceId === selectedAudioInput);
  const currentCam = videoInputs.find((d) => d.deviceId === selectedVideoInput);
  const currentSpk = audioOutputs.find((d) => d.deviceId === selectedAudioOutput);

  return (
    <div
      id="device-picker-modal-backdrop"
      data-testid="device-picker-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="device-picker-title"
    >
      <div
        id="device-picker-modal"
        data-testid="device-picker-modal"
        className="relative w-full max-w-xl rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl shadow-indigo-950/40 text-slate-100 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800/80 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 id="device-picker-title" className="text-base font-bold text-white tracking-tight">
                Media Device Settings
              </h2>
              <p className="text-xs text-slate-400">
                Switch microphones, cameras, and audio outputs anytime.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              id="device-picker-refresh-btn"
              data-testid="device-picker-refresh-btn"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Refresh available devices"
              className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
            <button
              type="button"
              id="device-picker-close-btn"
              data-testid="device-picker-close-btn"
              onClick={onClose}
              title="Close device settings"
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Call continuity alert banner */}
        {inCall && (
          <div className="px-6 py-2 bg-emerald-950/40 border-b border-emerald-900/40 flex items-center justify-between text-[11px] text-emerald-300">
            <span className="flex items-center gap-2 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Connected to live call — device switching is seamless with zero disconnect.
            </span>
            <span className="text-emerald-400/80 font-mono text-[10px]">US-LIVE-08</span>
          </div>
        )}

        {/* Toast / Feedback notification */}
        {feedbackMessage && (
          <div
            id="device-switch-feedback"
            data-testid="device-switch-feedback"
            className="px-6 py-2 bg-indigo-950/60 border-b border-indigo-800/40 flex items-center gap-2 text-xs text-indigo-300 font-medium animate-fade-in"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>{feedbackMessage}</span>
          </div>
        )}

        {/* Permission warning banner if browser withheld labels */}
        {!hasPermission && (
          <div className="mx-6 mt-4 p-3 rounded-2xl bg-amber-950/40 border border-amber-800/50 flex items-start gap-3 text-xs text-amber-200">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">Hardware device labels are hidden by browser</p>
              <p className="text-[11px] text-amber-300/80 mt-0.5">
                Grant camera and microphone permissions so your actual device names appear.
              </p>
            </div>
            <button
              type="button"
              onClick={onRequestPermissions}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 transition-colors shrink-0"
            >
              Grant Access
            </button>
          </div>
        )}

        {/* Category Filter Tabs */}
        <div className="flex border-b border-slate-800/80 px-6 bg-slate-900/60">
          <button
            type="button"
            id="device-tab-all"
            data-testid="device-tab-all"
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'all'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            All Devices
          </button>
          <button
            type="button"
            id="device-tab-audio"
            data-testid="device-tab-audio"
            onClick={() => setActiveTab('audio')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'audio'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Audio (Mic & Speaker)
          </button>
          <button
            type="button"
            id="device-tab-video"
            data-testid="device-tab-video"
            onClick={() => setActiveTab('video')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'video'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Video (Camera)
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* ── 1. Microphone (Audio Input) ── */}
          {(activeTab === 'all' || activeTab === 'audio') && (
            <div className="space-y-3 p-4 rounded-2xl bg-slate-950/40 border border-slate-800/70">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="device-select-audio-input"
                  className="flex items-center gap-2 text-xs font-bold text-slate-200 tracking-wide uppercase"
                >
                  <div className="w-6 h-6 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <Mic className="w-3.5 h-3.5" />
                  </div>
                  <span>Microphone</span>
                </label>
              {currentMic && (
                <span
                  id="device-picker-active-mic"
                  data-testid="device-picker-active-mic"
                  className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full truncate max-w-[160px]"
                >
                  {currentMic.label}
                </span>
              )}
            </div>

            <div className="relative">
              <select
                id="device-select-audio-input"
                data-testid="device-select-audio-input"
                value={selectedAudioInput}
                onChange={handleAudioChange}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer"
              >
                {audioInputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId} className="bg-slate-900 text-white">
                    {d.label} {d.deviceId === selectedAudioInput ? '✓' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Audio level meter test */}
            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Input Level Meter (Speak into mic to test)</span>
                <span className="font-mono text-[10px] text-slate-500">{audioLevel}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden p-0.5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-indigo-500 transition-all duration-75"
                  style={{ width: `${Math.max(5, audioLevel)}%` }}
                />
              </div>
            </div>
          </div>
        )}

          {/* ── 2. Camera (Video Input) ── */}
          {(activeTab === 'all' || activeTab === 'video') && (
            <div className="space-y-3 p-4 rounded-2xl bg-slate-950/40 border border-slate-800/70">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="device-select-video-input"
                  className="flex items-center gap-2 text-xs font-bold text-slate-200 tracking-wide uppercase"
                >
                  <div className="w-6 h-6 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <Video className="w-3.5 h-3.5" />
                  </div>
                  <span>Camera</span>
                </label>
              {currentCam && (
                <span
                  id="device-picker-active-cam"
                  data-testid="device-picker-active-cam"
                  className="text-[10px] font-medium text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full truncate max-w-[160px]"
                >
                  {currentCam.label}
                </span>
              )}
            </div>

            <div className="relative">
              <select
                id="device-select-video-input"
                data-testid="device-select-video-input"
                value={selectedVideoInput}
                onChange={handleVideoChange}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer"
              >
                {videoInputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId} className="bg-slate-900 text-white">
                    {d.label} {d.deviceId === selectedVideoInput ? '✓' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Camera live preview tile */}
            <div className="relative w-full aspect-video rounded-xl bg-slate-900 border border-slate-800/80 overflow-hidden flex items-center justify-center">
              <video
                ref={previewVideoRef}
                id="device-camera-preview-video"
                data-testid="device-camera-preview-video"
                className="w-full h-full object-cover"
                autoPlay
                playsInline
                muted
              />
              {!previewStream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 gap-2 p-4 text-center">
                  <Video className="w-8 h-8 opacity-40" />
                  <span className="text-xs font-medium">Camera preview inactive</span>
                  <button
                    type="button"
                    onClick={onStartPreview}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-semibold"
                  >
                    Click to start test preview
                  </button>
                </div>
              )}
              {previewStream && (
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm border border-white/10 text-[10px] font-medium text-emerald-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Previewing {currentCam?.label || 'Camera'}</span>
                </div>
              )}
            </div>
          </div>
        )}

          {/* ── 3. Audio Output (Speaker / Headphones) ── */}
          {(activeTab === 'all' || activeTab === 'audio') && (
            <div className="space-y-3 p-4 rounded-2xl bg-slate-950/40 border border-slate-800/70">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="device-select-audio-output"
                  className="flex items-center gap-2 text-xs font-bold text-slate-200 tracking-wide uppercase"
                >
                  <div className="w-6 h-6 rounded-lg bg-teal-500/15 border border-teal-500/30 flex items-center justify-center text-teal-400">
                    <Volume2 className="w-3.5 h-3.5" />
                  </div>
                  <span>Speaker / Output</span>
                </label>
                {currentSpk && (
                  <span
                    id="device-picker-active-speaker"
                    data-testid="device-picker-active-speaker"
                    className="text-[10px] font-medium text-teal-400 bg-teal-500/10 border border-teal-500/20 px-2 py-0.5 rounded-full truncate max-w-[160px]"
                  >
                    {currentSpk.label}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <select
                  id="device-select-audio-output"
                  data-testid="device-select-audio-output"
                  value={selectedAudioOutput}
                  onChange={handleOutputChange}
                  className="flex-1 bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer"
                >
                  {audioOutputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId} className="bg-slate-900 text-white">
                      {d.label} {d.deviceId === selectedAudioOutput ? '✓' : ''}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  id="device-test-sound-btn"
                  data-testid="device-test-sound-btn"
                  onClick={handleTestSound}
                  disabled={isTestingSound}
                  className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 shrink-0 ${
                    isTestingSound
                      ? 'bg-teal-600 text-white ring-2 ring-teal-400 animate-pulse'
                      : 'bg-slate-800 hover:bg-slate-700 text-teal-300 border border-teal-500/30'
                  }`}
                  title="Play test chime"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Test Sound</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-900/90 flex items-center justify-between">
          <p className="text-[11px] text-slate-400">
            Selected devices are automatically saved for your upcoming sessions.
          </p>
          <button
            type="button"
            id="device-picker-done-btn"
            data-testid="device-picker-done-btn"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 active:scale-95 transition-all shadow-md shadow-indigo-600/30 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Done</span>
          </button>
        </div>
      </div>
    </div>
  );
};
