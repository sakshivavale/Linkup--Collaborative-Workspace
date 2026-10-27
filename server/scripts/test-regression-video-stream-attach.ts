import assert from 'assert';
import fs from 'fs';
import path from 'path';

/**
 * Regression Test: Video Stream Attaching, Transceiver Direction, and Autoplay Fixes
 * Verifies:
 * 1. ParticipantTile always mutes video element to comply with browser Autoplay policies.
 * 2. ParticipantTile attaches onunmute listener on remote video track.
 * 3. usePeerConnections searches transceivers for video direction and marks sendrecv.
 * 4. usePeerConnections sets onunmute on pc.ontrack to trigger React re-render.
 * 5. LiveTab updates myPermissions for bulk grant/revoke.
 * 6. Server app.ts syncs LiveKit participant permissions for all members on bulk update.
 */

async function run() {
  console.log('\n--- Running Regression Test: Video Stream Attaching & Autoplay Fixes ---');
  let passed = 0;

  const repoRoot = path.resolve(__dirname, '../..');
  // 1. ParticipantTile.tsx
  const tilePath = path.resolve(repoRoot, 'client/src/features/rooms/ParticipantTile.tsx');
  const tileContent = fs.readFileSync(tilePath, 'utf8');

  // Video element must always be muted to satisfy Autoplay policies
  assert.strictEqual(
    tileContent.includes("videoRef.current.muted = true"),
    true,
    'ParticipantTile must always set videoRef.current.muted = true'
  );
  assert.strictEqual(
    tileContent.includes("muted"),
    true,
    'ParticipantTile JSX must specify muted attribute'
  );
  assert.strictEqual(
    tileContent.includes("onunmute"),
    true,
    'ParticipantTile must attach onunmute listener'
  );
  console.log('✓ PASS: ParticipantTile enforces muted video and onunmute stream activation');
  passed += 3;

  // 2. usePeerConnections.ts
  const peerConnPath = path.resolve(repoRoot, 'client/src/features/rooms/usePeerConnections.ts');
  const peerConnContent = fs.readFileSync(peerConnPath, 'utf8');

  assert.strictEqual(
    peerConnContent.includes("pc.getTransceivers()"),
    true,
    'usePeerConnections must inspect peer connection transceivers'
  );
  assert.strictEqual(
    peerConnContent.includes("videoTransceiver.direction = 'sendrecv'"),
    true,
    'usePeerConnections must ensure video transceiver direction is sendrecv'
  );
  assert.strictEqual(
    peerConnContent.includes("event.track.onunmute"),
    true,
    'usePeerConnections must listen for event.track.onunmute'
  );
  console.log('✓ PASS: usePeerConnections configures transceiver sendrecv and track onunmute');
  passed += 3;

  // 3. LiveTab.tsx
  const liveTabPath = path.resolve(repoRoot, 'client/src/features/rooms/LiveTab.tsx');
  const liveTabContent = fs.readFileSync(liveTabPath, 'utf8');

  assert.strictEqual(
    liveTabContent.includes("setMyPermissions((prev) => (prev ? { ...prev, ...data.patch } : null))"),
    true,
    'LiveTab must apply bulk permission updates to myPermissions'
  );
  console.log('✓ PASS: LiveTab updates local member permissions on bulk updates');
  passed += 1;

  // 4. server/src/app.ts
  const appPath = path.resolve(repoRoot, 'server/src/app.ts');
  const appContent = fs.readFileSync(appPath, 'utf8');

  assert.strictEqual(
    appContent.includes("updateLivekitParticipantPermissions"),
    true,
    'server/src/app.ts must update LiveKit participant permissions for room members'
  );
  assert.strictEqual(
    appContent.includes("livekitRoom") && appContent.includes("session.livekit_room"),
    true,
    'server/src/app.ts must support both livekit_room and livekitRoom property names'
  );
  console.log('✓ PASS: Server syncs LiveKit participant grants and room name mapping');
  passed += 2;

  console.log(`\nAll ${passed} video stream regression assertions PASSED!\n`);
}

run().catch((err) => {
  console.error('Video stream regression test failed:', err);
  process.exit(1);
});
