import ParticipantTile, { Participant } from './ParticipantTile';
import { ScreenShareTile } from './ScreenShareTile';
import { ActiveScreenShare } from '@linkup/shared';

interface VideoGridProps {
  participants: Participant[];
  activeScreenShare?: ActiveScreenShare | null;
  isSelfSharing?: boolean;
  canStopSharing?: boolean;
  screenStream?: MediaStream | null;
  onStopSharing?: () => void;
}

/**
 * VideoGrid:
 * Handles normal grid mode and focused screen-share stage layout (US-LIVE-04 Acceptance Criteria 2):
 * "A screen share appears as the focused tile for all participants; other tiles move to a strip below."
 */
export default function VideoGrid({
  participants,
  activeScreenShare,
  isSelfSharing = false,
  canStopSharing = false,
  screenStream = null,
  onStopSharing,
}: VideoGridProps) {
  // If screen sharing is active -> focused tile + strip below layout
  if (activeScreenShare) {
    return (
      <div id="screen-share-stage-layout" data-testid="screen-share-stage-layout" className="w-full flex flex-col items-center gap-4">
        {/* Focused Screen Share Tile */}
        <ScreenShareTile
          sharerName={activeScreenShare.userName}
          isSelf={isSelfSharing}
          canStop={canStopSharing}
          stream={screenStream}
          onStop={onStopSharing ?? (() => {})}
        />

        {/* Other tiles move to a strip below */}
        {participants.length > 0 && (
          <div className="w-full max-w-5xl">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Participants ({participants.length})
              </span>
            </div>
            <div
              id="participants-strip-below"
              data-testid="participants-strip-below"
              className="flex items-center gap-3 overflow-x-auto py-2 px-1 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent"
            >
              {participants.map((p) => (
                <ParticipantTile key={p.id} participant={p} isStrip={true} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Normal Grid Layout (when no screen share is active)
  return (
    <div className="w-full">
      <div
        id="participants-video-grid"
        data-testid="participants-video-grid"
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
      >
        {participants.map((p) => (
          <ParticipantTile key={p.id} participant={p} isStrip={false} />
        ))}
      </div>
    </div>
  );
}
