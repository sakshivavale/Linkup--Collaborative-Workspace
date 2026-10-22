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
  Hand,
  Radio,
  Info,
  ShieldAlert,
  ExternalLink,
  X,
} from 'lucide-react';
import { socket } from '../../lib/socket';
import VideoGrid from './VideoGrid';
import { mapParticipantsFromPresence, Participant } from './participantUtils';
import { useRoom } from './useRoom';
import { useAuth } from '../../context/AuthContext';
import { ActiveScreenShare, Permissions } from '@linkup/shared';
import { useMediaDevices, isPermissionDeniedError, PERMISSION_DENIED_MESSAGE, BROWSER_PERMISSION_HELP_URL } from './useMediaDevices';
import { DevicePickerModal } from './DevicePickerModal';
import { usePeerConnections } from './usePeerConnections';

interface LiveTabProps {
  roomId: string;
  sessionId: string | null;
  inCall?: boolean;
  onJoinCall?: () => void;
  onLeaveCall?: () => void;
  isHost?: boolean;
  disabled?: boolean;
  isReconnecting?: boolean;
  onMediaPermissionError?: (isDenied: boolean) => void;
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
  onMediaPermissionError,
}) => {
  const isControlsDisabled = Boolean(disabled || isReconnecting);
  const { user, fullName } = useAuth();
  const { room } = useRoom(roomId);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [internalInCall, setInternalInCall] = useState(Boolean(sessionId));
  const inCall = controlledInCall !== undefined ? controlledInCall : internalInCall;

  // Media devices management (US-LIVE-08, US-ERR-03)
  const [isDevicePickerOpen, setIsDevicePickerOpen] = useState(false);
  const [deviceNotification, setDeviceNotification] = useState<string | null>(null);
  const [mediaPermissionDenied, setMediaPermissionDenied] = useState<boolean>(false);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  const mediaDevices = useMediaDevices({
    onDeviceSwitched: (kind, _deviceId, label) => {
      const type = kind === 'audioinput' ? 'Microphone' : kind === 'videoinput' ? 'Camera' : 'Speaker';
      setDeviceNotification(`Switched ${type} to: ${label}`);
      setTimeout(() => setDeviceNotification(null), 3000);
    },
  });

  // US-ERR-03: Sync mediaDevices permission denial state & notify parent
  useEffect(() => {
    setMediaPermissionDenied(mediaDevices.permissionDenied);
  }, [mediaDevices.permissionDenied]);

  useEffect(() => {
    if (onMediaPermissionError) {
      onMediaPermissionError(mediaPermissionDenied);
    }
  }, [mediaPermissionDenied, onMediaPermissionError]);

  // Screen share state - derived from useRoom's socket-synced room.activeScreenShare (single source of truth)
  const activeScreenShare: ActiveScreenShare | null = room?.activeScreenShare || null;
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  // Remote screen-share video received over WebRTC (viewer side only; sharer uses `screenStream` above)
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  // Sharer side: one RTCPeerConnection per viewing student, keyed by their socket id
  const hostPeerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Viewer side: single RTCPeerConnection to the current sharer
  const viewerPeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const viewerHostSocketIdRef = useRef<string | null>(null);
  const viewerPendingIceRef = useRef<RTCIceCandidateInit[]>([]);

  // Current user's role and permission flags
  const isHost = propIsHost ?? (room?.myRole === 'host');
  const currentMember = room?.members?.find((m) => m && m.userId === user?.id);
  const [myPermissions, setMyPermissions] = useState<Permissions | null>(
    () => currentMember?.permissions || null
  );

  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>(() =>
    mapParticipantsFromPresence(room?.presence, activeSpeakerId)
  );

  // WebRTC peer connections for two-way live camera and audio streaming
  const { remoteStreams } = usePeerConnections({
    roomId,
    currentUserId: user?.id,
    inCall: Boolean(inCall),
    participants,
    localStream: mediaDevices.localStream,
    camOn,
    micOn,
  });


  // US-PERM-07: Track whether current user has hand raised (FR-4.8)
  const [isHandRaised, setIsHandRaised] = useState<boolean>(() => {
    const selfPresence = room?.presence?.find((p) => p && p.userId === user?.id);
    return Boolean(selfPresence?.handRaised);
  });

  // Attach local and remote media streams to participant tiles with real-time indicators
  const participantsWithStreams = React.useMemo(() => {
    let list = participants;
    if (inCall && user?.id && !list.some((p) => p.id === user.id)) {
      list = [
        ...list,
        {
          id: user.id,
          name: fullName || 'You',
          isMuted: !micOn,
          cameraOff: !camOn,
          isSpeaking: false,
          handRaised: isHandRaised,
          stream: null,
          isSelf: true,
        },
      ];
    }
    return list.map((p) => {
      const isSelf = p.id === user?.id;
      return {
        ...p,
        isSelf,
        isMuted: isSelf ? !micOn : p.isMuted,
        cameraOff: isSelf ? !camOn : p.cameraOff,
        stream: isSelf
          ? (camOn && mediaDevices.localStream ? mediaDevices.localStream : null)
          : (remoteStreams.get(p.id) || null),
      };
    });
  }, [participants, user?.id, fullName, inCall, camOn, micOn, isHandRaised, mediaDevices.localStream, remoteStreams]);

  // Sync handRaised status when room loads or presence updates
  useEffect(() => {
    if (room?.presence && user?.id) {
      const selfPresence = room.presence.find((p) => p && p.userId === user.id);
      if (selfPresence) {
        setIsHandRaised(Boolean(selfPresence.handRaised));
      }
    }
  }, [room?.presence, user?.id]);

  const [internalSessionId, setInternalSessionId] = useState<string | null>(sessionId);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    setInternalSessionId(sessionId);
  }, [sessionId]);

  // US-ERR-02 Acceptance Criteria 2:
  // When teacher starts, status updates automatically via session:started event without requiring a page reload
  useEffect(() => {
    const handleSessionStarted = (data: { roomId: string; session: { id: string } }) => {
      if (data.roomId === roomId && data.session?.id) {
        setInternalSessionId(data.session.id);
        setJoinError(null);
      }
    };

    const handleSessionEnded = (data: { roomId: string }) => {
      if (data.roomId === roomId) {
        setInternalSessionId(null);
        setInternalInCall(false);
      }
    };

    socket.on('session:started', handleSessionStarted);
    socket.on('session:ended', handleSessionEnded);

    return () => {
      socket.off('session:started', handleSessionStarted);
      socket.off('session:ended', handleSessionEnded);
    };
  }, [roomId]);

  const activeSessionId = sessionId || internalSessionId;

  // Sync internal inCall if controlled prop changes
  useEffect(() => {
    if (controlledInCall !== undefined) {
      setInternalInCall(controlledInCall);
    }
  }, [controlledInCall]);

  useEffect(() => {
    if (!activeSessionId && inCall) {
      if (onLeaveCall) onLeaveCall();
      setInternalInCall(false);
    }
  }, [activeSessionId, inCall, onLeaveCall]);

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
          if (localVideoRef.current.srcObject) {
            const stream = localVideoRef.current.srcObject as MediaStream;
            if (stream.getVideoTracks) {
              stream.getVideoTracks().forEach((t) => {
                try {
                  t.stop();
                } catch {
                  // Ignore
                }
              });
            }
          }
          localVideoRef.current.srcObject = null;
        }
        mediaDevices.stopVideoTracks();
        return;
      }

      // Already have a live track for this device (e.g. switchVideoInput just handled it) - skip redundant getUserMedia
      const existingVideoTrack = mediaDevices.localStream?.getVideoTracks()[0];
      if (existingVideoTrack && existingVideoTrack.readyState === 'live') {
        existingVideoTrack.enabled = true;
        if (localVideoRef.current && localVideoRef.current.srcObject !== mediaDevices.localStream) {
          localVideoRef.current.srcObject = mediaDevices.localStream;
          localVideoRef.current.play().catch(() => {});
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
            setMediaPermissionDenied(false);
            mediaDevices.clearPermissionDenied();
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
        } catch (err: any) {
          console.warn('[LiveTab] Camera getUserMedia error:', err);
          // US-ERR-03: Detect browser camera permission denial
          if (isPermissionDeniedError(err)) {
            setMediaPermissionDenied(true);
            setCamOn(false); // Gracefully disable camera toggle so it does not loop
          }
        }
      }
    };

    updateCameraStream();

    return () => {
      active = false;
    };
  }, [camOn, inCall, mediaDevices.selectedVideoInput]);

  // Synchronize local video preview element with localStream whenever camOn or localStream updates
  useEffect(() => {
    if (localVideoRef.current && camOn && mediaDevices.localStream) {
      const hasLiveVideo = mediaDevices.localStream.getVideoTracks().some(
        (t) => t.readyState === 'live'
      );
      if (hasLiveVideo && localVideoRef.current.srcObject !== mediaDevices.localStream) {
        localVideoRef.current.srcObject = mediaDevices.localStream;
        localVideoRef.current.play().catch(() => {});
      }
    } else if (localVideoRef.current && !camOn) {
      localVideoRef.current.srcObject = null;
    }
  }, [camOn, mediaDevices.localStream]);

  // US-ERR-03: Handle local microphone audio stream with browser permission denial protection
  useEffect(() => {
    let active = true;
    const updateAudioStream = async () => {
      if (!micOn || !inCall) {
        if (!inCall) {
          mediaDevices.stopAudioTracks();
        } else if (mediaDevices.localStream) {
          mediaDevices.localStream.getAudioTracks().forEach((track) => {
            track.enabled = false;
          });
        }
        return;
      }

      // Check if localStream already has an active audio track
      const existingAudioTrack = mediaDevices.localStream?.getAudioTracks()[0];
      if (existingAudioTrack && existingAudioTrack.readyState === 'live') {
        existingAudioTrack.enabled = true;
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          const constraints: MediaStreamConstraints = {
            audio:
              mediaDevices.selectedAudioInput !== 'default'
                ? { deviceId: { exact: mediaDevices.selectedAudioInput } }
                : true,
          };
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (active) {
            setMediaPermissionDenied(false);
            mediaDevices.clearPermissionDenied();
            mediaDevices.setLocalStream((prev) => {
              if (prev) {
                prev.getAudioTracks().forEach((t) => t.stop());
                const videoTracks = prev.getVideoTracks();
                return new MediaStream([...stream.getAudioTracks(), ...videoTracks]);
              }
              return stream;
            });
            mediaDevices.setupAudioMeter(stream);
          }
        } catch (err: any) {
          console.warn('[LiveTab] Microphone getUserMedia error:', err);
          if (isPermissionDeniedError(err)) {
            setMediaPermissionDenied(true);
            setMicOn(false); // Gracefully disable mic toggle so it does not loop
          }
        }
      }
    };

    updateAudioStream();

    return () => {
      active = false;
    };
  }, [micOn, inCall, mediaDevices.selectedAudioInput]);

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

  // Keep other participants' mute/camera-off tile icons in sync with our real mic/cam state
  useEffect(() => {
    if (inCall && roomId) {
      socket.emit('live:media-state', { roomId, micOn, cameraOn: camOn });
    }
  }, [inCall, roomId, micOn, camOn]);

  // Real-time presence, active speaker, and screen share socket listeners
  useEffect(() => {
    const mapPresenceToParticipants = () => {
      setParticipants(mapParticipantsFromPresence(room?.presence, activeSpeakerId));
    };

    mapPresenceToParticipants();

    const onPresenceUpdate = (data: { roomId: string; presence: any[] }) => {
      if (data.roomId !== roomId) return;
      if (Array.isArray(data.presence) && user?.id) {
        const self = data.presence.find((p: any) => p && p.userId === user.id);
        if (self) {
          setIsHandRaised(Boolean(self.handRaised));
        }
      }
      setParticipants(mapParticipantsFromPresence(data.presence, activeSpeakerId));
    };

    // US-PERM-07: Real-time hand:changed listener (FR-4.8)
    const onHandChanged = (data: { roomId: string; userId: string; raised: boolean }) => {
      if (data.roomId !== roomId) return;
      if (data.userId === user?.id) {
        setIsHandRaised(data.raised);
      }
      setParticipants((prev) =>
        (prev || []).map((p) => (p && p.id === data.userId ? { ...p, handRaised: data.raised } : p))
      );
    };

    const onActiveSpeaker = (data: { roomId: string; userId: string | null }) => {
      if (data.roomId !== roomId) return;
      setActiveSpeakerId(data.userId ?? null);
      setParticipants(mapParticipantsFromPresence(room?.presence, data.userId ?? null));
    };

    // activeScreenShare itself comes from useRoom (room.activeScreenShare); this listener only
    // cleans up our own local capture if we were the one stopped (e.g. host force-stopped us).
    const onScreenStopped = (data: { roomId: string }) => {
      if (data.roomId !== roomId) return;
      if (screenStream) {
        screenStream.getTracks().forEach((t) => t.stop());
        setScreenStream(null);
      }
    };

    // US-LIVE-04 Acceptance Criteria 4, US-PERM-06 AC-4, & US-ERR-04 Acceptance Criteria 1, 2:
    // When student's mic/camera/screen permission is revoked while active:
    // - The relevant control is immediately disabled.
    // - The media track stops within 1 second.
    // - No crash or error screen is shown.
    const onPermChanged = (data: { roomId: string; userId: string; permissions: Permissions; reason?: string }) => {
      if (data.roomId !== roomId) return;
      if (data.userId === user?.id) {
        setMyPermissions(data.permissions);
        if (!isHost) {
          if (data.permissions.canScreen === false) {
            if (activeScreenShare?.userId === user?.id || screenStream) {
              handleStopScreenShare();
              socket.emit('screen:stop', { roomId });
            }
          }
          if (data.permissions.canMic === false) {
            setMicOn(false);
            mediaDevices.stopAudioTracks();
            if (mediaDevices.localStream) {
              mediaDevices.localStream.getAudioTracks().forEach((track) => {
                track.enabled = false;
                try {
                  track.stop();
                } catch {
                  // Ignore
                }
              });
            }
          }
          if (data.permissions.canCamera === false) {
            setCamOn(false);
            if (localVideoRef.current?.srcObject) {
              const src = localVideoRef.current.srcObject as MediaStream;
              if (src.getVideoTracks) {
                src.getVideoTracks().forEach((track) => {
                  try {
                    track.stop();
                  } catch {
                    // Ignore
                  }
                });
              }
              localVideoRef.current.srcObject = null;
            }
            mediaDevices.stopVideoTracks();
            if (mediaDevices.localStream) {
              mediaDevices.localStream.getVideoTracks().forEach((track) => {
                try {
                  track.stop();
                } catch {
                  // Ignore
                }
              });
            }
          }
        }
      }
    };

    // US-PERM-06 & US-ERR-04: Bulk permission change handler
    const onPermBulk = (data: { roomId: string; by: string; patch: Partial<Permissions> }) => {
      if (data.roomId !== roomId) return;
      if (!isHost) {
        if (data.patch.canMic === false) {
          setMicOn(false);
          setMyPermissions((prev) => (prev ? { ...prev, canMic: false } : null));
          mediaDevices.stopAudioTracks();
          if (mediaDevices.localStream) {
            mediaDevices.localStream.getAudioTracks().forEach((track) => {
              track.enabled = false;
              try {
                track.stop();
              } catch {
                // Ignore
              }
            });
          }
        }
        if (data.patch.canCamera === false) {
          setCamOn(false);
          setMyPermissions((prev) => (prev ? { ...prev, canCamera: false } : null));
          if (localVideoRef.current?.srcObject) {
            const src = localVideoRef.current.srcObject as MediaStream;
            if (src.getVideoTracks) {
              src.getVideoTracks().forEach((track) => {
                try {
                  track.stop();
                } catch {
                  // Ignore
                }
              });
            }
            localVideoRef.current.srcObject = null;
          }
          mediaDevices.stopVideoTracks();
          if (mediaDevices.localStream) {
            mediaDevices.localStream.getVideoTracks().forEach((track) => {
              try {
                track.stop();
              } catch {
                // Ignore
              }
            });
          }
        }
        if (data.patch.canScreen === false) {
          setMyPermissions((prev) => (prev ? { ...prev, canScreen: false } : null));
          if (activeScreenShare?.userId === user?.id || screenStream) {
            handleStopScreenShare();
            socket.emit('screen:stop', { roomId });
          }
        }
      }
    };

    socket.on('presence:update', onPresenceUpdate);
    socket.on('hand:changed', onHandChanged);
    socket.on('live:active-speaker', onActiveSpeaker);
    socket.on('screen:stopped', onScreenStopped);
    socket.on('perm:changed', onPermChanged);
    socket.on('perm:bulk', onPermBulk);

    return () => {
      socket.off('presence:update', onPresenceUpdate);
      socket.off('hand:changed', onHandChanged);
      socket.off('live:active-speaker', onActiveSpeaker);
      socket.off('screen:stopped', onScreenStopped);
      socket.off('perm:changed', onPermChanged);
      socket.off('perm:bulk', onPermBulk);
    };
  }, [
    activeScreenShare?.userId,
    activeSpeakerId,
    isHost,
    mediaDevices.localStream,
    mediaDevices.stopAudioTracks,
    mediaDevices.stopVideoTracks,
    roomId,
    room,
    screenStream,
    user?.id,
  ]);

  const ICE_SERVERS: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  // Sharer side: answer each viewing student's offer with our own screen-capture tracks
  useEffect(() => {
    if (!isSelfSharing || !screenStream) {
      hostPeerConnectionsRef.current.forEach((pc) => pc.close());
      hostPeerConnectionsRef.current.clear();
      return;
    }

    const onOffer = async (data: { roomId: string; sdp: RTCSessionDescriptionInit; fromSocketId: string; streamType?: string }) => {
      if (data.roomId !== roomId) return;
      if (data.streamType && data.streamType !== 'screen') return;
      const pc = new RTCPeerConnection(ICE_SERVERS);
      hostPeerConnectionsRef.current.set(data.fromSocketId, pc);

      screenStream.getTracks().forEach((track) => pc.addTrack(track, screenStream));

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('webrtc:ice-candidate', { roomId, candidate: e.candidate, targetSocketId: data.fromSocketId, streamType: 'screen' });
        }
      };

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', { roomId, sdp: answer, targetSocketId: data.fromSocketId, streamType: 'screen' });
      } catch (err) {
        console.warn('[LiveTab] WebRTC answer creation failed:', err);
        pc.close();
        hostPeerConnectionsRef.current.delete(data.fromSocketId);
      }
    };

    const onIceCandidate = (data: { roomId: string; candidate: RTCIceCandidateInit; fromSocketId: string; streamType?: string }) => {
      if (data.roomId !== roomId) return;
      if (data.streamType && data.streamType !== 'screen') return;
      const pc = hostPeerConnectionsRef.current.get(data.fromSocketId);
      if (pc) pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
    };

    socket.on('webrtc:offer', onOffer);
    socket.on('webrtc:ice-candidate', onIceCandidate);

    return () => {
      socket.off('webrtc:offer', onOffer);
      socket.off('webrtc:ice-candidate', onIceCandidate);
      hostPeerConnectionsRef.current.forEach((pc) => pc.close());
      hostPeerConnectionsRef.current.clear();
    };
  }, [isSelfSharing, screenStream, roomId]);

  // Viewer side: request the active share from the host over WebRTC (handles joining mid-share too)
  useEffect(() => {
    if (!activeScreenShare || isSelfSharing) {
      if (viewerPeerConnectionRef.current) {
        viewerPeerConnectionRef.current.close();
        viewerPeerConnectionRef.current = null;
      }
      viewerHostSocketIdRef.current = null;
      viewerPendingIceRef.current = [];
      setRemoteScreenStream(null);
      return;
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    viewerPeerConnectionRef.current = pc;

    // We have no local tracks to send - without this, createOffer() below produces an SDP
    // with no media sections at all, so the host's screen tracks have nothing to bind to in
    // the answer and ontrack never fires. Explicitly requesting recv-only transceivers gives
    // the offer the video/audio m= lines the host's addTrack() can negotiate against.
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.ontrack = (e) => {
      setRemoteScreenStream(e.streams[0] ?? null);
    };

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      if (viewerHostSocketIdRef.current) {
        socket.emit('webrtc:ice-candidate', { roomId, candidate: e.candidate, targetSocketId: viewerHostSocketIdRef.current, streamType: 'screen' });
      } else {
        // Host's socket id isn't known yet (no answer received) - flush once it arrives
        viewerPendingIceRef.current.push(e.candidate.toJSON());
      }
    };

    const onAnswer = async (data: { roomId: string; sdp: RTCSessionDescriptionInit; fromSocketId: string; streamType?: string }) => {
      if (data.roomId !== roomId || viewerPeerConnectionRef.current !== pc) return;
      if (data.streamType && data.streamType !== 'screen') return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        viewerHostSocketIdRef.current = data.fromSocketId;
        viewerPendingIceRef.current.forEach((candidate) => {
          socket.emit('webrtc:ice-candidate', { roomId, candidate, targetSocketId: data.fromSocketId, streamType: 'screen' });
        });
        viewerPendingIceRef.current = [];
      } catch (err) {
        console.warn('[LiveTab] Failed to apply WebRTC answer:', err);
      }
    };

    const onIceCandidate = (data: { roomId: string; candidate: RTCIceCandidateInit; fromSocketId: string; streamType?: string }) => {
      if (data.roomId !== roomId || viewerPeerConnectionRef.current !== pc) return;
      if (data.streamType && data.streamType !== 'screen') return;
      pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
    };

    socket.on('webrtc:answer', onAnswer);
    socket.on('webrtc:ice-candidate', onIceCandidate);

    (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc:offer', { roomId, sdp: offer, streamType: 'screen' });
      } catch (err) {
        console.warn('[LiveTab] Failed to create WebRTC offer:', err);
      }
    })();

    return () => {
      socket.off('webrtc:answer', onAnswer);
      socket.off('webrtc:ice-candidate', onIceCandidate);
      pc.close();
      if (viewerPeerConnectionRef.current === pc) {
        viewerPeerConnectionRef.current = null;
      }
      viewerHostSocketIdRef.current = null;
      viewerPendingIceRef.current = [];
    };
    // activeScreenShare?.userId (not the whole object) so we don't tear down/recreate the connection on unrelated screen-share field changes
  }, [activeScreenShare?.userId, isSelfSharing, roomId]);

  // US-PERM-06 AC-4: Ensure actively publishing audio track is instantly muted within 1s
  useEffect(() => {
    if (mediaDevices.localStream) {
      mediaDevices.localStream.getAudioTracks().forEach((track) => {
        track.enabled = micOn;
      });
    }
  }, [micOn, mediaDevices.localStream]);

  // US-PERM-07: Toggle hand raise for current participant (FR-4.8)
  const handleToggleHandRaise = () => {
    if (isControlsDisabled) return;
    const nextVal = !isHandRaised;
    setIsHandRaised(nextVal);
    socket.emit('hand:raise', {
      roomId,
      raised: nextVal,
    });
  };

  const handleToggleCall = () => {
    if (inCall) {
      if (isSelfSharing) {
        handleStopScreenShare();
      }
      socket.emit('live:left', { roomId });
      if (onLeaveCall) onLeaveCall();
      setInternalInCall(false);
    } else {
      if (!activeSessionId) {
        // US-ERR-02: User cannot join live if no session is active (FR-3.2, FRD Section 7)
        setJoinError('Waiting for the teacher to start the session.');
        setTimeout(() => setJoinError(null), 4000);
        return;
      }
      socket.emit('live:joined', { roomId }, (res: any) => {
        if (res && res.ok === false) {
          setJoinError(res.error?.message || 'Waiting for the teacher to start the session.');
          setTimeout(() => setJoinError(null), 4000);
          setInternalInCall(false);
          return;
        }
      });
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
        id="live-session-indicator"
        data-testid="live-session-indicator"
        className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold tracking-wide ${
          activeSessionId
            ? 'bg-red-500/15 border border-red-500/30 text-red-400'
            : 'bg-slate-200/60 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400'
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${activeSessionId ? 'bg-red-500 animate-pulse' : 'bg-slate-400'}`} />
        {activeSessionId ? 'Live Session Active' : 'No Active Session'}
      </div>

      {/* US-ERR-02: Waiting state when session has not started (FR-3.2, FRD Section 7) */}
      {!activeSessionId && (
        <div
          id="room-session-waiting-card"
          data-testid="room-session-waiting-card"
          className="flex flex-col items-center gap-3 p-8 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-amber-500/30 shadow-xl backdrop-blur-sm max-w-md w-full text-center animate-fade-in"
        >
          <div className="w-14 h-14 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500 dark:text-amber-400">
            <Radio className="w-7 h-7 animate-pulse" />
          </div>
          <div>
            <h3
              id="waiting-for-teacher-title"
              data-testid="waiting-for-teacher-title"
              className="text-base font-bold text-slate-900 dark:text-white"
            >
              Waiting for the teacher to start the session.
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-xs leading-relaxed">
              {isHost
                ? 'As the host, click "Start Session" in the header to launch the live video call.'
                : 'The live stream and controls will activate automatically as soon as the session begins.'}
            </p>
          </div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            <span>Waiting for session:started event…</span>
          </div>
        </div>
      )}

      {/* Join live error message banner / toast (US-ERR-02) */}
      {joinError && (
        <div
          id="join-live-error-toast"
          data-testid="join-live-error-toast"
          role="alert"
          className="px-4 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs font-medium flex items-center gap-2 shadow-lg backdrop-blur-sm animate-fade-in"
        >
          <Info className="w-4 h-4 text-amber-500 shrink-0" />
          <span>{joinError}</span>
        </div>
      )}

      {/* US-ERR-03: Camera and Mic Browser Permission Denied (FRD Section 7) */}
      {mediaPermissionDenied && (
        <div
          id="media-permission-denied-alert"
          data-testid="media-permission-denied-alert"
          role="alert"
          className="flex flex-col sm:flex-row items-center justify-between gap-3.5 p-4 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-200 shadow-xl backdrop-blur-sm max-w-2xl w-full text-center sm:text-left animate-fade-in z-20"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <p
                id="media-permission-denied-message"
                data-testid="media-permission-denied-message"
                className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white"
              >
                {PERMISSION_DENIED_MESSAGE}
              </p>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                Camera or microphone access was blocked by your browser. You can still use chat, code, and whiteboard.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              id="media-permission-help-link"
              data-testid="media-permission-help-link"
              href={BROWSER_PERMISSION_HELP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors cursor-pointer"
              title="Learn how to allow camera and mic permissions in your browser"
            >
              <span>Help</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <button
              type="button"
              id="media-permission-retry-btn"
              data-testid="media-permission-retry-btn"
              onClick={async () => {
                try {
                  const granted = await mediaDevices.requestPermissions();
                  if (granted) {
                    setMediaPermissionDenied(false);
                    if (mediaDevices.clearPermissionDenied) {
                      mediaDevices.clearPermissionDenied();
                    }
                  }
                } catch {
                  // Keep permission denied message
                }
              }}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-amber-900 dark:text-amber-200 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 transition-colors cursor-pointer"
            >
              Try Again
            </button>
            <button
              type="button"
              id="media-permission-dismiss-btn"
              data-testid="media-permission-dismiss-btn"
              onClick={() => {
                setMediaPermissionDenied(false);
                if (mediaDevices.clearPermissionDenied) {
                  mediaDevices.clearPermissionDenied();
                }
              }}
              className="p-1 rounded-lg text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors"
              aria-label="Dismiss alert"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* When session is active but current user is not in the call: US-LIVE-06 AC-3 Join Live action */}
      {activeSessionId && !inCall && (
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
            participants={participantsWithStreams}
            activeScreenShare={activeScreenShare}
            isSelfSharing={isSelfSharing}
            canStopSharing={isSelfSharing || isHost}
            screenStream={isSelfSharing ? screenStream : remoteScreenStream}
            onStopSharing={handleStopScreenShare}
          />
        ) : (
          <div className="w-full flex flex-col items-center gap-6">
            {participantsWithStreams.length > 0 && <VideoGrid participants={participantsWithStreams} />}

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
                    {camOn ? (
                      <Video className="w-3 h-3 text-indigo-400" />
                    ) : (
                      <VideoOff className="w-3 h-3 text-slate-500" />
                    )}
                    <span className="truncate max-w-[120px]">{camOn ? activeCamLabel : 'Camera Off'}</span>
                  </div>
                  <div
                    id="active-mic-pill"
                    data-testid="active-mic-pill"
                    className="px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-medium text-slate-300 flex items-center gap-1"
                  >
                    {micOn ? (
                      <Mic className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <MicOff className="w-3 h-3 text-red-400" />
                    )}
                    <span className="truncate max-w-[120px]">{micOn ? activeMicLabel : 'Muted'}</span>
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
            aria-disabled={isControlsDisabled || (!isHost && myPermissions?.canMic === false)}
            onClick={() => {
              if (isControlsDisabled || (!isHost && myPermissions?.canMic === false)) return;
              setMicOn((v) => !v);
            }}
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
            aria-disabled={isControlsDisabled || (!isHost && myPermissions?.canMic === false)}
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
            aria-disabled={isControlsDisabled || (!isHost && myPermissions?.canCamera === false)}
            onClick={() => {
              if (isControlsDisabled || (!isHost && myPermissions?.canCamera === false)) return;
              setCamOn((v) => !v);
            }}
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
            aria-disabled={isControlsDisabled || (!isHost && myPermissions?.canCamera === false)}
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

        {/* ── US-PERM-07: Hand-raise button for all participants in call control bar (FR-4.8) ── */}
        <button
          id="room-hand-raise-toggle"
          data-testid="room-hand-raise-toggle"
          type="button"
          disabled={isControlsDisabled}
          onClick={handleToggleHandRaise}
          title={
            isControlsDisabled
              ? 'Reconnecting...'
              : isHandRaised
              ? 'Lower hand'
              : 'Raise hand'
          }
          aria-label={isHandRaised ? 'Lower hand' : 'Raise hand'}
          aria-pressed={isHandRaised}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 ${
            isControlsDisabled
              ? 'opacity-50 cursor-not-allowed bg-slate-200 dark:bg-slate-800 text-slate-400'
              : isHandRaised
              ? 'bg-amber-500 hover:bg-amber-600 text-white focus:ring-amber-400 ring-2 ring-amber-300 dark:ring-amber-500 cursor-pointer active:scale-95 shadow-amber-500/25'
              : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 hover:text-amber-600 dark:hover:text-amber-400 focus:ring-amber-400 cursor-pointer active:scale-95'
          }`}
        >
          <Hand className={`w-5 h-5 ${isHandRaised ? 'text-white' : ''}`} />
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
            disabled={isControlsDisabled || !activeSessionId}
            onClick={handleToggleCall}
            title={
              isControlsDisabled
                ? 'Reconnecting...'
                : !activeSessionId
                ? 'Waiting for the teacher to start the session.'
                : 'Join Live'
            }
            aria-label={!activeSessionId ? 'Waiting for the teacher to start the session.' : 'Join Live'}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              !activeSessionId
                ? 'bg-slate-300 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-60'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white focus:ring-emerald-500 cursor-pointer active:scale-95'
            } ${isControlsDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
          >
            <PhoneCall className="w-5 h-5" />
          </button>
        )}
      </div>

      <p
        id="live-tab-session-status-text"
        data-testid="live-tab-session-status-text"
        className="text-xs text-slate-400 dark:text-slate-500 text-center max-w-xs"
      >
        {activeSessionId
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
        permissionDenied={mediaDevices.permissionDenied || mediaPermissionDenied}
        audioLevel={mediaDevices.audioLevel}
        previewStream={mediaDevices.previewStream}
        onStartPreview={mediaDevices.startCameraPreview}
        onStopPreview={mediaDevices.stopCameraPreview}
        inCall={inCall}
      />
    </div>
  );
};
