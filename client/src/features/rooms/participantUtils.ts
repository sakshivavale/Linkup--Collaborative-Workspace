import { buildParticipantTiles, PresenceEntry } from '@linkup/shared';

export type Participant = ReturnType<typeof buildParticipantTiles>[number];

export function mapParticipantsFromPresence(
  presence: PresenceEntry[] | undefined,
  activeSpeakerUserId: string | null = null
): Participant[] {
  return buildParticipantTiles(presence, activeSpeakerUserId);
}
