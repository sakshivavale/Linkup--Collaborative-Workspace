import { useEffect, useState } from 'react';
import { RoomSummary, Member } from '@linkup/shared';
import { api, HttpError } from '../../lib/api';
import { socket } from '../../lib/socket';

interface UseRoomResult {
  room: RoomSummary | null;
  setRoom: React.Dispatch<React.SetStateAction<RoomSummary | null>>;
  loading: boolean;
  /** null = no error; 'NOT_A_MEMBER' = 403; 'NOT_FOUND' = 404; 'UNKNOWN' = other */
  error: 'NOT_A_MEMBER' | 'NOT_FOUND' | 'UNKNOWN' | null;
}

const SAMPLE_ROOMS: Record<string, RoomSummary> = {
  'room-cs101-active': {
    id: 'room-cs101-active',
    name: 'CS101: Data Structures & Algorithms',
    description: 'Live interactive coding workspace with real-time video, compiler, and shared whiteboard.',
    joinCode: 'CS101A',
    hostName: 'Prof. Alan Turing',
    memberCount: 3,
    myRole: 'host',
    activeSessionId: 'session-live-cs101-888',
    createdAt: new Date().toISOString(),
    members: [
      {
        userId: 'user-turing',
        fullName: 'Prof. Alan Turing',
        userRole: 'teacher',
        memberRole: 'host',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        userId: 'user-grace',
        fullName: 'Grace Hopper',
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: true, canCode: true },
        joinedAt: new Date(Date.now() - 1800000).toISOString(),
      },
      {
        userId: 'user-john',
        fullName: 'John von Neumann',
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: true, canCode: true },
        joinedAt: new Date(Date.now() - 900000).toISOString(),
      },
    ],
    presence: [
      { userId: 'user-turing', fullName: 'Prof. Alan Turing', inLive: true, handRaised: false, micOn: true, cameraOn: false },
      { userId: 'user-grace', fullName: 'Grace Hopper', inLive: true, handRaised: false, micOn: true, cameraOn: false },
    ],
  },
  'room-math201-inactive': {
    id: 'room-math201-inactive',
    name: 'MATH201: Discrete Mathematics & Graph Theory',
    description: 'Weekly tutorial problems and discussion room. Next session scheduled for Friday.',
    joinCode: null,
    hostName: 'Dr. Ada Lovelace',
    memberCount: 2,
    myRole: 'participant',
    activeSessionId: null,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    members: [
      {
        userId: 'user-lovelace',
        fullName: 'Dr. Ada Lovelace',
        userRole: 'teacher',
        memberRole: 'host',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        userId: 'user-babbage',
        fullName: 'Charles Babbage',
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: false, canWhiteboard: true, canCode: true },
        joinedAt: new Date(Date.now() - 86000000).toISOString(),
      },
    ],
    presence: [
      { userId: 'user-lovelace', fullName: 'Dr. Ada Lovelace', inLive: false, handRaised: false, micOn: true, cameraOn: false },
    ],
  },
  'room-phys301-active': {
    id: 'room-phys301-active',
    name: 'PHYS301: Quantum Mechanics & Wave Dynamics',
    description: 'Laboratory live lecture session with interactive formulas and visual simulations.',
    joinCode: null,
    hostName: 'Dr. Richard Feynman',
    memberCount: 2,
    myRole: 'participant',
    activeSessionId: 'session-live-phys-999',
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    members: [
      {
        userId: 'user-feynman',
        fullName: 'Dr. Richard Feynman',
        userRole: 'teacher',
        memberRole: 'host',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date(Date.now() - 172800000).toISOString(),
      },
      {
        userId: 'user-curie',
        fullName: 'Marie Curie',
        userRole: 'student',
        memberRole: 'participant',
        permissions: { canMic: true, canCamera: true, canScreen: true, canWhiteboard: true, canCode: true },
        joinedAt: new Date(Date.now() - 170000000).toISOString(),
      },
    ],
    presence: [
      { userId: 'user-feynman', fullName: 'Dr. Richard Feynman', inLive: true, handRaised: false, micOn: true, cameraOn: false },
      { userId: 'user-curie', fullName: 'Marie Curie', inLive: true, handRaised: false, micOn: true, cameraOn: false },
    ],
  },
};

/**
 * Fetches the room the current authenticated user is a member of.
 * If the user is not a member the server returns 403 NOT_A_MEMBER —
 * the caller should redirect to the dashboard (US-ROOM-01 FR-2.4).
 */
export function useRoom(roomId: string | undefined): UseRoomResult {
  const [room, setRoom] = useState<RoomSummary | null>(() => (roomId ? SAMPLE_ROOMS[roomId] || null : null));
  const [loading, setLoading] = useState(!roomId || !SAMPLE_ROOMS[roomId]);
  const [error, setError] = useState<UseRoomResult['error']>(null);

  useEffect(() => {
    if (!roomId) {
      setError('NOT_FOUND');
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchRoom = async () => {
      if (!SAMPLE_ROOMS[roomId]) {
        setLoading(true);
      }
      setError(null);
      try {
        const data = await api.get<RoomSummary>(`/api/rooms/${roomId}`);
        if (!cancelled) {
          setRoom(data);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof HttpError) {
          if (err.status === 403 && (err.code === 'NOT_A_MEMBER' || err.code === 'FORBIDDEN')) {
            setError('NOT_A_MEMBER');
            return;
          } else if (err.status === 404) {
            setError('NOT_FOUND');
            return;
          } else {
            setError('UNKNOWN');
            return;
          }
        }
        if (SAMPLE_ROOMS[roomId]) {
          setRoom(SAMPLE_ROOMS[roomId]);
          return;
        }
        setError('UNKNOWN');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchRoom();

    const onPermChanged = (data: { roomId: string; userId: string; permissions: any }) => {
      if (data.roomId !== roomId) return;
      setRoom((prev) => {
        if (!prev) return prev;
        const members = prev.members?.map((m) =>
          m.userId === data.userId ? { ...m, permissions: data.permissions } : m
        );
        return { ...prev, members };
      });
    };

    const onScreenStarted = (data: { roomId: string; userId: string; userName: string }) => {
      if (data.roomId !== roomId) return;
      setRoom((prev) =>
        prev
          ? {
              ...prev,
              activeScreenShare: {
                roomId: data.roomId,
                userId: data.userId,
                userName: data.userName,
                startedAt: new Date().toISOString(),
              },
            }
          : prev
      );
    };

    const onScreenStopped = (data: { roomId: string }) => {
      if (data.roomId !== roomId) return;
      setRoom((prev) => (prev ? { ...prev, activeScreenShare: null } : prev));
    };

    const onMemberJoined = (data: { roomId: string; member: Member }) => {
      if (data.roomId !== roomId || !data.member) return;
      setRoom((prev) => {
        if (!prev) return prev;
        if (prev.members?.some((m) => m.userId === data.member.userId)) return prev;
        return {
          ...prev,
          members: [...(prev.members || []), data.member],
          memberCount: prev.memberCount + 1,
        };
      });
    };

    const onMemberRemoved = (data: { roomId: string; userId: string }) => {
      if (data.roomId !== roomId) return;
      setRoom((prev) => {
        if (!prev) return prev;
        const members = prev.members?.filter((m) => m.userId !== data.userId);
        return { ...prev, members, memberCount: Math.max(0, prev.memberCount - 1) };
      });
    };

    socket.on('perm:changed', onPermChanged);
    socket.on('screen:started', onScreenStarted);
    socket.on('screen:stopped', onScreenStopped);
    socket.on('member:joined', onMemberJoined);
    socket.on('member:removed', onMemberRemoved);

    return () => {
      cancelled = true;
      socket.off('perm:changed', onPermChanged);
      socket.off('screen:started', onScreenStarted);
      socket.off('screen:stopped', onScreenStopped);
      socket.off('member:joined', onMemberJoined);
      socket.off('member:removed', onMemberRemoved);
    };
  }, [roomId]);

  return { room, setRoom, loading, error };
}
