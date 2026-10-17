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
 * Merge whiteboard elements for a room according to US-WB-02 / architecture §5.6:
 * Keep higher version; tie -> lower versionNonce wins.
 * Deletions (Excalidraw isDeleted: true) sync correctly.
 */
export function mergeWhiteboardElements(roomId: string, incomingElements: any[]): any[] {
  const normalized = roomId?.trim();
  if (!normalized) return [];
  const current = (whiteboardMap.get(normalized) || []) as any[];
  const elementMap = new Map<string, any>(current.map((el) => [el.id, el]));

  for (const el of incomingElements) {
    if (!el || !el.id) continue;
    const existing = elementMap.get(el.id);
    if (!existing) {
      elementMap.set(el.id, el);
    } else {
      const elVersion = typeof el.version === 'number' ? el.version : 0;
      const exVersion = typeof existing.version === 'number' ? existing.version : 0;
      if (elVersion > exVersion) {
        elementMap.set(el.id, el);
      } else if (elVersion === exVersion) {
        const elNonce = typeof el.versionNonce === 'number' ? el.versionNonce : 0;
        const exNonce = typeof existing.versionNonce === 'number' ? existing.versionNonce : 0;
        if (elNonce < exNonce) {
          elementMap.set(el.id, el);
        }
      }
    }
  }

  const merged = Array.from(elementMap.values());
  whiteboardMap.set(normalized, merged);
  return merged;
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
