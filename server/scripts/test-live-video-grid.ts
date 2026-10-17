import assert from 'node:assert/strict';
import { buildParticipantTiles } from '@linkup/shared';

const participants = buildParticipantTiles([
  { userId: 'u1', fullName: 'Alice', inLive: true, handRaised: false },
  { userId: 'u2', fullName: 'Bob', inLive: true, handRaised: false },
  { userId: 'u3', fullName: 'Charlie', inLive: false, handRaised: false },
], 'u2');

assert.equal(participants.length, 2, 'Only inLive participants are included');
assert.equal(participants[0].name, 'Alice');
assert.equal(participants[1].id, 'u2');
assert.equal(participants[1].isSpeaking, true, 'The active speaker is highlighted');
assert.equal(participants[0].cameraOff, true, 'Default camera-off state is shown until real state is available');
assert.equal(participants[0].isMuted, true, 'Default muted state is shown until real state is available');

const updated = buildParticipantTiles([
  { userId: 'u1', fullName: 'Alice', inLive: true, handRaised: false },
]);
assert.equal(updated.length, 1, 'Participant leaves are reflected in the grid');
assert.equal(updated[0].name, 'Alice');

console.log('Live video grid participant mapping check passed');
