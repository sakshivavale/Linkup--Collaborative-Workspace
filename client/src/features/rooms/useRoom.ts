import { useEffect, useState } from 'react';
import { RoomSummary } from '@linkup/shared';
import { api, HttpError } from '../../lib/api';

interface UseRoomResult {
  room: RoomSummary | null;
  loading: boolean;
  /** null = no error; 'NOT_A_MEMBER' = 403; 'NOT_FOUND' = 404; 'UNKNOWN' = other */
  error: 'NOT_A_MEMBER' | 'NOT_FOUND' | 'UNKNOWN' | null;
}

/**
 * Fetches the room the current authenticated user is a member of.
 * If the user is not a member the server returns 403 NOT_A_MEMBER —
 * the caller should redirect to the dashboard (US-ROOM-01 FR-2.4).
 */
export function useRoom(roomId: string | undefined): UseRoomResult {
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UseRoomResult['error']>(null);

  useEffect(() => {
    if (!roomId) {
      setError('NOT_FOUND');
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchRoom = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<RoomSummary>(`/api/rooms/${roomId}`);
        if (!cancelled) {
          setRoom(data);
        }
      } catch (err) {
        if (cancelled) return;
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
