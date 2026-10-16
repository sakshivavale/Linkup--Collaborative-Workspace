/**
 * LiveKit server operations helper (US-LIVE-05, FR-3.6)
 * Handles room deletion and participant cleanup.
 */

export async function deleteLivekitRoom(roomName: string): Promise<boolean> {
  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!livekitUrl || !apiKey || !apiSecret) {
    // In mock, test, or local setups without active LiveKit Cloud credentials,
    // simulated deletion succeeds safely.
    console.log(`[LiveKit] deleteRoom simulated for: ${roomName}`);
    return true;
  }

  try {
    // Dynamically resolve livekit-server-sdk if installed at runtime
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sdk = eval('require')('livekit-server-sdk');
    const RoomServiceClient = sdk?.RoomServiceClient;
    if (!RoomServiceClient) {
      console.warn(`[LiveKit] RoomServiceClient not found in livekit-server-sdk`);
      return false;
    }
    const svc = new RoomServiceClient(livekitUrl, apiKey, apiSecret);
    await svc.deleteRoom(roomName);
    console.log(`[LiveKit] deleteRoom succeeded for: ${roomName}`);
    return true;
  } catch (err: any) {
    console.warn(`[LiveKit] Failed to delete LiveKit room "${roomName}":`, err?.message || err);
    return false;
  }
}
