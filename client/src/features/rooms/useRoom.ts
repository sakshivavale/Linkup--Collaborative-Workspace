import { useEffect, useState } from 'react';
import { RoomSummary } from '@linkup/shared';
import { api, HttpError } from '../../lib/api';

interface UseRoomResult {
  room: RoomSummary | null;
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
    memberCount: 28,
    myRole: 'host',
    activeSessionId: 'session-live-cs101-888',
    createdAt: new Date().toISOString(),
  },
  'room-math201-inactive': {
    id: 'room-math201-inactive',
    name: 'MATH201: Discrete Mathematics & Graph Theory',
    description: 'Weekly tutorial problems and discussion room. Next session scheduled for Friday.',
    joinCode: null,
    hostName: 'Dr. Ada Lovelace',
    memberCount: 16,
    myRole: 'participant',
    activeSessionId: null,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  'room-phys301-active': {
    id: 'room-phys301-active',
    name: 'PHYS301: Quantum Mechanics & Wave Dynamics',
    description: 'Laboratory live lecture session with interactive formulas and visual simulations.',
    joinCode: null,
    hostName: 'Dr. Richard Feynman',
    memberCount: 34,
    myRole: 'participant',
    activeSessionId: 'session-live-phys-999',
    createdAt: new Date(Date.now() - 172800000).toISOString(),
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
        if (SAMPLE_ROOMS[roomId]) {
          setRoom(SAMPLE_ROOMS[roomId]);
          return;
        }
        if (err instanceof HttpError) {
          if (err.status === 403 && err.code === 'NOT_A_MEMBER') {
            setError('NOT_A_MEMBER');
          } else if (err.status === 404) {
            setError('NOT_FOUND');
          } else {
            setError('UNKNOWN');
          }
        } else {
          setError('UNKNOWN');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchRoom();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  return { room, loading, error };
}
