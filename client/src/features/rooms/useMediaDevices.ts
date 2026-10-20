import { useState, useEffect, useRef, useCallback } from 'react';

export interface DeviceInfo {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
  groupId?: string;
}

const STORAGE_KEYS = {
  AUDIO_INPUT: 'linkup_preferred_audio_input',
  VIDEO_INPUT: 'linkup_preferred_video_input',
  AUDIO_OUTPUT: 'linkup_preferred_audio_output',
};

const DEFAULT_DEVICES = {
  AUDIO_INPUT: {
    deviceId: 'default',
    label: 'Default Microphone',
    kind: 'audioinput' as MediaDeviceKind,
  },
  VIDEO_INPUT: {
    deviceId: 'default',
    label: 'Default Camera (Built-in)',
    kind: 'videoinput' as MediaDeviceKind,
  },
  AUDIO_OUTPUT: {
    deviceId: 'default',
    label: 'Default System Speaker',
    kind: 'audiooutput' as MediaDeviceKind,
  },
};

export const PERMISSION_DENIED_MESSAGE = 'Allow camera/mic access in your browser settings';
export const BROWSER_PERMISSION_HELP_URL = 'https://support.google.com/chrome/answer/2693767';

/**
 * Checks whether an error from getUserMedia or mediaDevices is a browser permission denial
 * (US-ERR-03 / FRD Section 7)
 */
export function isPermissionDeniedError(err: any): boolean {
  if (!err) return false;
  const name = err.name || '';
  const message = (err.message || '').toLowerCase();
  return (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    name === 'SecurityError' ||
    name === 'AbortError' ||
    message.includes('permission denied') ||
    message.includes('not allowed') ||
    message.includes('permission dismissed') ||
    message.includes('permission') ||
    message.includes('denied')
  );
}

export interface UseMediaDevicesOptions {
  enableAudioOnStart?: boolean;
  enableVideoOnStart?: boolean;
  onDeviceSwitched?: (kind: MediaDeviceKind, deviceId: string, label: string) => void;
}

export function useMediaDevices(options: UseMediaDevicesOptions = {}) {
  const { onDeviceSwitched } = options;

  const [audioInputs, setAudioInputs] = useState<DeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<DeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<DeviceInfo[]>([]);

  const [selectedAudioInput, setSelectedAudioInput] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.AUDIO_INPUT) || 'default';
  });
  const [selectedVideoInput, setSelectedVideoInput] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.VIDEO_INPUT) || 'default';
  });
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.AUDIO_OUTPUT) || 'default';
  });

  const selectedAudioInputRef = useRef(selectedAudioInput);
  const selectedVideoInputRef = useRef(selectedVideoInput);
  const selectedAudioOutputRef = useRef(selectedAudioOutput);
  useEffect(() => {
    selectedAudioInputRef.current = selectedAudioInput;
  }, [selectedAudioInput]);
  useEffect(() => {
    selectedVideoInputRef.current = selectedVideoInput;
  }, [selectedVideoInput]);
  useEffect(() => {
    selectedAudioOutputRef.current = selectedAudioOutput;
  }, [selectedAudioOutput]);

  const [hasPermission, setHasPermission] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [permissionErrorMessage, setPermissionErrorMessage] = useState<string | null>(null);
  const [isSwitchingDevice, setIsSwitchingDevice] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  const clearPermissionDenied = useCallback(() => {
    setPermissionDenied(false);
    setPermissionErrorMessage(null);
  }, []);

  // Active streams
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);

  // Audio level monitoring
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  /**
   * Enumerate media devices from navigator.mediaDevices
   */
  const refreshDevices = useCallback(async (): Promise<{
    audioIn: DeviceInfo[];
    videoIn: DeviceInfo[];
    audioOut: DeviceInfo[];
  }> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      const audioIn = [DEFAULT_DEVICES.AUDIO_INPUT];
      const videoIn = [DEFAULT_DEVICES.VIDEO_INPUT];
      const audioOut = [DEFAULT_DEVICES.AUDIO_OUTPUT];
      setAudioInputs(audioIn);
      setVideoInputs(videoIn);
      setAudioOutputs(audioOut);
      return { audioIn, videoIn, audioOut };
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();

      let aIn: DeviceInfo[] = [];
      let vIn: DeviceInfo[] = [];
      let aOut: DeviceInfo[] = [];

      let micCounter = 1;
      let camCounter = 1;
      let spkCounter = 1;

      let hasLabels = false;

      devices.forEach((d) => {
        if (d.label) hasLabels = true;

        if (d.kind === 'audioinput') {
          aIn.push({
            deviceId: d.deviceId || `audioinput-${micCounter}`,
            label: d.label || `Microphone ${micCounter++}`,
            kind: d.kind,
            groupId: d.groupId,
          });
        } else if (d.kind === 'videoinput') {
          vIn.push({
            deviceId: d.deviceId || `videoinput-${camCounter}`,
            label: d.label || `Camera ${camCounter++}`,
            kind: d.kind,
            groupId: d.groupId,
          });
        } else if (d.kind === 'audiooutput') {
          aOut.push({
            deviceId: d.deviceId || `audiooutput-${spkCounter}`,
            label: d.label || `Speaker ${spkCounter++}`,
            kind: d.kind,
            groupId: d.groupId,
          });
        }
      });

      if (hasLabels) {
        setHasPermission(true);
      }

      // Ensure at least default devices exist
      if (aIn.length === 0) aIn = [DEFAULT_DEVICES.AUDIO_INPUT];
      if (vIn.length === 0) vIn = [DEFAULT_DEVICES.VIDEO_INPUT];
      if (aOut.length === 0) aOut = [DEFAULT_DEVICES.AUDIO_OUTPUT];

      setAudioInputs(aIn);
      setVideoInputs(vIn);
      setAudioOutputs(aOut);

      // Validate selected devices still exist in list
      if (!aIn.some((d) => d.deviceId === selectedAudioInputRef.current)) {
        const nextId = aIn[0]?.deviceId || 'default';
        setSelectedAudioInput(nextId);
        localStorage.setItem(STORAGE_KEYS.AUDIO_INPUT, nextId);
      }
      if (!vIn.some((d) => d.deviceId === selectedVideoInputRef.current)) {
        const nextId = vIn[0]?.deviceId || 'default';
        setSelectedVideoInput(nextId);
        localStorage.setItem(STORAGE_KEYS.VIDEO_INPUT, nextId);
      }
      if (!aOut.some((d) => d.deviceId === selectedAudioOutputRef.current)) {
        const nextId = aOut[0]?.deviceId || 'default';
        setSelectedAudioOutput(nextId);
        localStorage.setItem(STORAGE_KEYS.AUDIO_OUTPUT, nextId);
      }

      return { audioIn: aIn, videoIn: vIn, audioOut: aOut };
    } catch (err: any) {
      console.warn('[useMediaDevices] Failed to enumerate devices:', err);
      const audioIn = [DEFAULT_DEVICES.AUDIO_INPUT];
      const videoIn = [DEFAULT_DEVICES.VIDEO_INPUT];
      const audioOut = [DEFAULT_DEVICES.AUDIO_OUTPUT];
      setAudioInputs(audioIn);
      setVideoInputs(videoIn);
      setAudioOutputs(audioOut);
      return { audioIn, videoIn, audioOut };
    }
  }, []);

  /**
   * Explicitly request device permissions to reveal device labels
   */
  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPermissionDenied(true);
      setPermissionErrorMessage(PERMISSION_DENIED_MESSAGE);
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      setHasPermission(true);
      setPermissionDenied(false);
      setPermissionErrorMessage(null);
      // Immediately stop temporary permission tracks
      stream.getTracks().forEach((track) => track.stop());
      await refreshDevices();
      return true;
    } catch (err: any) {
      console.warn('[useMediaDevices] Permission request dismissed or denied:', err);
      // Try audio-only if video failed
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioStream.getTracks().forEach((t) => t.stop());
        setHasPermission(true);
        setPermissionDenied(false);
        setPermissionErrorMessage(null);
        await refreshDevices();
        return true;
      } catch (audioErr: any) {
        if (isPermissionDeniedError(err) || isPermissionDeniedError(audioErr)) {
          setPermissionDenied(true);
          setPermissionErrorMessage(PERMISSION_DENIED_MESSAGE);
        }
        return false;
      }
    }
  }, [refreshDevices]);

  /**
   * Listen for hardware device connection/disconnection changes
   */
  useEffect(() => {
    refreshDevices();

    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      const handleDeviceChange = () => {
        console.log('[useMediaDevices] Hardware devices changed, re-enumerating');
        refreshDevices();
      };
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      };
    }
  }, [refreshDevices]);

  /**
   * Setup audio visualizer for testing microphone
   */
  const setupAudioMeter = useCallback((stream: MediaStream) => {
    try {
      if (typeof window === 'undefined') return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return;

      const mediaStreamSource = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      mediaStreamSource.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        // Normalize between 0 and 100
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        setAudioLevel(normalized);
        animFrameRef.current = requestAnimationFrame(checkVolume);
      };

      checkVolume();
    } catch (err) {
      console.warn('[useMediaDevices] Audio meter setup error:', err);
    }
  }, []);

  const stopAudioMeter = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  /**
   * Switch Audio Input (Microphone) without disconnecting call.
   * US-LIVE-08 Acceptance Criteria:
   * - A device-picker control is accessible from the control bar.
   * - Switching does not disconnect the user from the call.
   */
  const switchAudioInput = useCallback(
    async (deviceId: string): Promise<boolean> => {
      setIsSwitchingDevice(true);
      setDeviceError(null);

      try {
        setSelectedAudioInput(deviceId);
        localStorage.setItem(STORAGE_KEYS.AUDIO_INPUT, deviceId);

        // If local stream has active audio, replace track seamlessly
        if (localStream && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
          try {
            const constraints: MediaStreamConstraints = {
              audio: deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true,
            };
            const newStream = await navigator.mediaDevices.getUserMedia(constraints);
            const newAudioTrack = newStream.getAudioTracks()[0];

            if (newAudioTrack) {
              // Stop previous audio tracks
              localStream.getAudioTracks().forEach((oldTrack) => {
                oldTrack.stop();
                localStream.removeTrack(oldTrack);
              });
              localStream.addTrack(newAudioTrack);

              // Update audio level meter with new track
              setupAudioMeter(newStream);
            }
          } catch (err: any) {
            console.warn('[useMediaDevices] Failed to acquire new audio track:', err);
            if (isPermissionDeniedError(err)) {
              setPermissionDenied(true);
              setPermissionErrorMessage(PERMISSION_DENIED_MESSAGE);
            }
            // Non-fatal: do not disconnect call
            setDeviceError('Could not switch microphone hardware: ' + (err.message || 'Access error'));
          }
        }

        const deviceObj = audioInputs.find((d) => d.deviceId === deviceId);
        const label = deviceObj?.label || 'Microphone';
        if (onDeviceSwitched) {
          onDeviceSwitched('audioinput', deviceId, label);
        }

        return true;
      } catch (err: any) {
        setDeviceError(err.message || 'Failed to switch microphone');
        return false;
      } finally {
        setIsSwitchingDevice(false);
      }
    },
    [localStream, audioInputs, onDeviceSwitched, setupAudioMeter]
  );

  /**
   * Switch Video Input (Camera) without disconnecting call.
   * US-LIVE-08 Acceptance Criteria:
   * - A device-picker control is accessible from the control bar.
   * - Switching does not disconnect the user from the call.
   */
  const switchVideoInput = useCallback(
    async (deviceId: string): Promise<boolean> => {
      setIsSwitchingDevice(true);
      setDeviceError(null);

      try {
        setSelectedVideoInput(deviceId);
        localStorage.setItem(STORAGE_KEYS.VIDEO_INPUT, deviceId);

        // If video stream or preview is active, replace video track seamlessly
        if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
          try {
            const constraints: MediaStreamConstraints = {
              video: deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true,
            };
            const newStream = await navigator.mediaDevices.getUserMedia(constraints);
            const newVideoTrack = newStream.getVideoTracks()[0];

            if (newVideoTrack) {
              if (localStream) {
                // Stop previous video tracks
                localStream.getVideoTracks().forEach((oldTrack) => {
                  oldTrack.stop();
                  localStream.removeTrack(oldTrack);
                });
                localStream.addTrack(newVideoTrack);
              }

              // Update preview stream as well
              if (previewStream) {
                previewStream.getVideoTracks().forEach((t) => t.stop());
              }
              setPreviewStream(newStream);
            }
          } catch (err: any) {
            console.warn('[useMediaDevices] Failed to acquire new camera track:', err);
            if (isPermissionDeniedError(err)) {
              setPermissionDenied(true);
              setPermissionErrorMessage(PERMISSION_DENIED_MESSAGE);
            }
            setDeviceError('Could not switch camera hardware: ' + (err.message || 'Access error'));
          }
        }

        const deviceObj = videoInputs.find((d) => d.deviceId === deviceId);
        const label = deviceObj?.label || 'Camera';
        if (onDeviceSwitched) {
          onDeviceSwitched('videoinput', deviceId, label);
        }

        return true;
      } catch (err: any) {
        setDeviceError(err.message || 'Failed to switch camera');
        return false;
      } finally {
        setIsSwitchingDevice(false);
      }
    },
    [localStream, previewStream, videoInputs, onDeviceSwitched]
  );

  /**
   * Switch Audio Output (Speaker / Headphones)
   */
  const switchAudioOutput = useCallback(
    async (deviceId: string, targetMediaElements: HTMLMediaElement[] = []): Promise<boolean> => {
      setSelectedAudioOutput(deviceId);
      localStorage.setItem(STORAGE_KEYS.AUDIO_OUTPUT, deviceId);

      // setSinkId if supported by browser
      for (const el of targetMediaElements) {
        if (typeof (el as any).setSinkId === 'function') {
          try {
            await (el as any).setSinkId(deviceId);
          } catch (err) {
            console.warn('[useMediaDevices] setSinkId error:', err);
          }
        }
      }

      const deviceObj = audioOutputs.find((d) => d.deviceId === deviceId);
      const label = deviceObj?.label || 'Speaker';
      if (onDeviceSwitched) {
        onDeviceSwitched('audiooutput', deviceId, label);
      }

      return true;
    },
    [audioOutputs, onDeviceSwitched]
  );

  /**
   * Play test sound through speaker/headphones to verify output
   */
  const playTestSound = useCallback(async (): Promise<void> => {
    try {
      if (typeof window === 'undefined') return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      // Pleasant two-tone chime (F5 -> C6)
      osc.frequency.setValueAtTime(698.46, ctx.currentTime);
      osc.frequency.setValueAtTime(1046.5, ctx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.45);
    } catch (err) {
      console.warn('[useMediaDevices] playTestSound error:', err);
    }
  }, []);

  /**
   * Start preview for camera in settings modal
   */
  const startCameraPreview = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return;
    }
    try {
      const constraints: MediaStreamConstraints = {
        video: selectedVideoInput !== 'default' ? { deviceId: { exact: selectedVideoInput } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setPreviewStream(stream);
    } catch (err: any) {
      console.warn('[useMediaDevices] startCameraPreview error:', err);
      if (isPermissionDeniedError(err)) {
        setPermissionDenied(true);
        setPermissionErrorMessage(PERMISSION_DENIED_MESSAGE);
      }
    }
  }, [selectedVideoInput]);

  /**
   * Stop camera preview
   */
  const stopCameraPreview = useCallback(() => {
    if (previewStream) {
      previewStream.getTracks().forEach((track) => track.stop());
      setPreviewStream(null);
    }
  }, [previewStream]);

  /**
   * Immediately stops all active audio tracks and cleans up audio meters (US-ERR-04)
   * The media track stops within 1 second.
   */
  const stopAudioTracks = useCallback(() => {
    stopAudioMeter();
    setLocalStream((prev) => {
      if (!prev) return null;
      prev.getAudioTracks().forEach((track) => {
        track.enabled = false;
        try {
          track.stop();
        } catch {
          // Ignore
        }
      });
      const remainingVideo = prev.getVideoTracks();
      return remainingVideo.length > 0 ? new MediaStream(remainingVideo) : null;
    });
  }, [stopAudioMeter]);

  /**
   * Immediately stops all active video tracks and cleans up previews (US-ERR-04)
   * The media track stops within 1 second.
   */
  const stopVideoTracks = useCallback(() => {
    stopCameraPreview();
    setLocalStream((prev) => {
      if (!prev) return null;
      prev.getVideoTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore
        }
      });
      const remainingAudio = prev.getAudioTracks();
      return remainingAudio.length > 0 ? new MediaStream(remainingAudio) : null;
    });
  }, [stopCameraPreview]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudioMeter();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      if (previewStream) {
        previewStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [stopAudioMeter, previewStream]);

  return {
    audioInputs,
    videoInputs,
    audioOutputs,
    selectedAudioInput,
    selectedVideoInput,
    selectedAudioOutput,
    hasPermission,
    permissionDenied,
    permissionErrorMessage,
    clearPermissionDenied,
    isSwitchingDevice,
    deviceError,
    audioLevel,
    localStream,
    setLocalStream,
    previewStream,
    setupAudioMeter,
    refreshDevices,
    requestPermissions,
    switchAudioInput,
    switchVideoInput,
    switchAudioOutput,
    playTestSound,
    startCameraPreview,
    stopCameraPreview,
    stopAudioTracks,
    stopVideoTracks,
  };
}
