// In-memory whiteboard elements: roomId -> elements array
const whiteboardMap = new Map<string, unknown[]>();

/**
 * Get whiteboard elements for a room.
 */
export function getWhiteboardElements(roomId: string): unknown[] {
  const normalized = roomId?.trim();
  if (!normalized) return [];
  return whiteboardMap.get(normalized) || [];
}

/**
 * Update whiteboard elements for a room.
 */
export function setWhiteboardElements(roomId: string, elements: unknown[]): void {
  const normalized = roomId?.trim();
  if (!normalized) return;
  whiteboardMap.set(normalized, Array.isArray(elements) ? elements : []);
}

/**
 * Clear whiteboard elements for a room.
 */
export function clearWhiteboardRoom(roomId: string): void {
  const normalized = roomId?.trim();
  if (!normalized) return;
  whiteboardMap.delete(normalized);
}

/**
 * Clear all whiteboard rooms (for testing)
 */
export function clearWhiteboard(): void {
  whiteboardMap.clear();
}
