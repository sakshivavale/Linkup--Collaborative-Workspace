import ParticipantTile, { Participant } from './ParticipantTile';

export default function VideoGrid({ participants }: { participants: Participant[] }) {
  return (
    <div className="w-full">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {participants.map((p) => (
          <ParticipantTile key={p.id} participant={p} />
        ))}
      </div>
    </div>
  );
}
