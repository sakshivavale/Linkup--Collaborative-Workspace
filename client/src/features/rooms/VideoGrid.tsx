import React from 'react';
import { LiveParticipant } from '@linkup/shared';
import { ParticipantTile } from './ParticipantTile';
import { Users } from 'lucide-react';

export interface VideoGridProps {
  participants: LiveParticipant[];
  localStream?: MediaStream | null;
}

/**
 * VideoGrid — US-LIVE-03: Video Grid with Participant Tiles (FR-3.4)
 * Acceptance Criteria:
 * 1. Each participant tile shows their name, a mute icon when their mic is off, and a camera-off icon when their camera is off.
 * 2. The currently speaking participant's tile is visually highlighted (active speaker highlight).
 * 3. Tiles update dynamically as participants join/leave.
 */
export const VideoGrid: React.FC<VideoGridProps> = ({
  participants,
  localStream,
}) => {
  const count = participants.length;

  // Determine dynamic grid layout class based on participant count
  const getGridClasses = () => {
    if (count <= 1) {
      return 'grid-cols-1 max-w-3xl';
    }
    if (count === 2) {
      return 'grid-cols-1 md:grid-cols-2 max-w-5xl';
    }
    if (count <= 4) {
      return 'grid-cols-1 sm:grid-cols-2 max-w-5xl';
    }
    if (count <= 6) {
      return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 max-w-6xl';
    }
    return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 max-w-7xl';
  };

  if (count === 0) {
    return (
      <div
        id="video-grid-empty"
        data-testid="video-grid-empty"
        className="w-full max-w-md aspect-video rounded-3xl bg-slate-900/60 border border-slate-800/80 flex flex-col items-center justify-center p-8 text-center shadow-xl"
      >
        <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-slate-400 mb-3 shadow-inner">
          <Users className="w-7 h-7 opacity-60" />
        </div>
        <h3 className="text-sm font-semibold text-white mb-1">No Participants In Call</h3>
        <p className="text-xs text-slate-400 max-w-xs">
          Click "Join Live" to enter the session and begin collaborating.
        </p>
      </div>
    );
  }

  return (
    <div
      id="video-grid"
      data-testid="video-grid"
      data-participant-count={count}
      className={`w-full grid gap-4 items-center justify-center transition-all duration-300 ${getGridClasses()}`}
    >
      {participants.map((participant) => (
        <ParticipantTile
          key={participant.userId}
          participant={participant}
          localStream={participant.isLocal ? localStream : undefined}
          totalParticipants={count}
        />
      ))}
    </div>
  );
};
