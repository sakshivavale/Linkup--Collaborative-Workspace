import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PenLine, Eye, RotateCcw, Download, AlertCircle } from 'lucide-react';
import { Excalidraw, exportToBlob, reconcileElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import { WB_THROTTLE_MS } from '@linkup/shared';
import { socket } from '../../lib/socket';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

export interface WhiteboardTabProps {
  roomId: string;
  canWhiteboard?: boolean;
  isHost?: boolean;
  initialElements?: any[];
  onElementsChange?: (elements: any[]) => void;
}

/**
 * US-WB-01: View the Shared Whiteboard (P0 | Traces to: FR-5.10, FR-5.11)
 * US-WB-02: Draw on the Whiteboard (Permitted User) (P0 | Traces to: FR-5.11, FR-5.12)
 * US-WB-03: Whiteboard State Persists (P0 | Traces to: FR-5.13)
 *
 * Acceptance Criteria:
 * 1. The Whiteboard tab renders Excalidraw in view-only mode for members where can_whiteboard = false and who are not the host.
 * 2. Drawings appear in view-only mode with no drawing tools visible.
 * 3. Attempting a whiteboard draw via a crafted socket event returns error { code: "FORBIDDEN" } and does not affect the board for others.
 * 4. The editor is writable for members with can_whiteboard = true and the host.
 * 5. Changed elements are throttled at 100 ms and broadcast via wb:update.
 * 6. All other members see changes within 500 ms.
 * 7. Deletions (Excalidraw isDeleted: true) sync correctly.
 * 8. The image tool is disabled (images need file storage, which is out of scope).
 * 9. whiteboard_state is persisted to Postgres (debounced 5 s and on last editor leave).
 * 10. Joining or rejoining the room loads current board state from room:join snapshot.
 *
 * US-WB-04: Grant/Revoke Whiteboard Access Live (P0 | Traces to: FR-5.11)
 * Acceptance Criteria:
 * 1. Toggling can_whiteboard via the Participants panel sends perm:changed to the room.
 * 2. The target student's view mode updates within 1 second without a page reload.
 * 3. After being revoked, a subsequent wb:update from that student is rejected server-side.
 */
export const WhiteboardTab: React.FC<WhiteboardTabProps> = ({
  roomId,
  canWhiteboard = false,
  isHost = false,
  initialElements = [],
  onElementsChange,
}) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const [forbiddenError, setForbiddenError] = useState<string | null>(null);

  // US-WB-04: Track can_whiteboard in real-time
  const [liveCanWhiteboard, setLiveCanWhiteboard] = useState<boolean>(Boolean(canWhiteboard));

  // Synchronize prop changes into live permission state
  useEffect(() => {
    setLiveCanWhiteboard(Boolean(canWhiteboard));
  }, [canWhiteboard]);

  // US-WB-04 AC-2: React to perm:changed and perm:bulk socket events in real time without page reload
  useEffect(() => {
    const handlePermChanged = (data: { roomId: string; userId: string; permissions: any; by?: string }) => {
      if (data.roomId !== roomId) return;
      if (user?.id && data.userId === user.id && data.permissions) {
        if (typeof data.permissions.canWhiteboard === 'boolean') {
          setLiveCanWhiteboard(data.permissions.canWhiteboard);
        }
      }
    };

    const handlePermBulk = (data: { roomId: string; patch: Partial<any> }) => {
      if (data.roomId !== roomId) return;
      if (!isHost && data.patch && typeof data.patch.canWhiteboard === 'boolean') {
        setLiveCanWhiteboard(data.patch.canWhiteboard);
      }
    };

    socket.on('perm:changed', handlePermChanged);
    socket.on('perm:bulk', handlePermBulk);

    return () => {
      socket.off('perm:changed', handlePermChanged);
      socket.off('perm:bulk', handlePermBulk);
    };
  }, [roomId, user?.id, isHost]);

  // View-only mode for members where can_whiteboard = false and who are not the host:
  // Effective permission combines host role and live can_whiteboard flag
  const effectiveCanWhiteboard = isHost || liveCanWhiteboard;
  const isReadOnly = !isHost && !effectiveCanWhiteboard;

  // Keep track of versions of elements sent or received to prevent infinite broadcast loops
  const sentVersionsRef = useRef<Map<string, number>>(new Map());
  const pendingUpdatesRef = useRef<Map<string, any>>(new Map());
  const throttleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef<boolean>(false);

  // US-WB-04 AC-3: Immediately cancel scheduled flush timer and clear pending updates when revoked
  useEffect(() => {
    if (isReadOnly) {
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      pendingUpdatesRef.current.clear();
    }
  }, [isReadOnly]);

  // Keep Excalidraw imperative API appState.viewModeEnabled in sync live when isReadOnly changes
  useEffect(() => {
    if (excalidrawAPI) {
      excalidrawAPI.updateScene({
        appState: {
          viewModeEnabled: isReadOnly,
        },
      });
    }
  }, [excalidrawAPI, isReadOnly]);

  // Synchronize scene with initial elements (from room:join snapshot or re-join) (US-WB-03 AC-2)
  useEffect(() => {
    if (!excalidrawAPI || !initialElements || initialElements.length === 0) return;

    if (!isInitializedRef.current) {
      for (const el of initialElements) {
        if (el?.id && typeof el.version === 'number') {
          sentVersionsRef.current.set(el.id, el.version);
        }
      }
      excalidrawAPI.updateScene({ elements: initialElements });
      isInitializedRef.current = true;
    } else {
      // Re-joining or reconnected snapshot: reconcile with existing local elements
      const localElements = excalidrawAPI.getSceneElementsIncludingDeleted();
      const appState = excalidrawAPI.getAppState();
      const reconciled = reconcileElements(localElements as any, initialElements as any, appState);
      for (const el of reconciled) {
        if (el?.id && typeof el.version === 'number') {
          const currentSeen = sentVersionsRef.current.get(el.id) ?? -1;
          if (el.version > currentSeen) {
            sentVersionsRef.current.set(el.id, el.version);
          }
        }
      }
      excalidrawAPI.updateScene({ elements: reconciled });
      onElementsChange?.(reconciled);
    }
  }, [excalidrawAPI, initialElements, onElementsChange]);

  // Fallback REST fetch if initialElements is empty on mount (US-WB-03)
  useEffect(() => {
    if ((!initialElements || initialElements.length === 0) && roomId && !isInitializedRef.current) {
      api
        .get<{ elements: any[] }>(`/api/rooms/${roomId}/whiteboard`)
        .then((saved) => {
          if (saved?.elements && Array.isArray(saved.elements) && saved.elements.length > 0 && excalidrawAPI) {
            for (const el of saved.elements) {
              if (el?.id && typeof el.version === 'number') {
                sentVersionsRef.current.set(el.id, el.version);
              }
            }
            excalidrawAPI.updateScene({ elements: saved.elements });
            onElementsChange?.(saved.elements);
            isInitializedRef.current = true;
          }
        })
        .catch(() => {});
    }
  }, [roomId, initialElements, excalidrawAPI, onElementsChange]);

  // Broadcast throttled pending changes to room members
  const flushUpdates = useCallback(() => {
    if (isReadOnly || pendingUpdatesRef.current.size === 0) return;
    const elementsToSend = Array.from(pendingUpdatesRef.current.values());
    pendingUpdatesRef.current.clear();

    for (const el of elementsToSend) {
      if (el?.id && typeof el.version === 'number') {
        sentVersionsRef.current.set(el.id, el.version);
      }
    }

    socket.emit('wb:update', {
      roomId,
      elements: elementsToSend,
    });
  }, [roomId, isReadOnly]);

  // Schedule throttled broadcast at 100 ms (US-WB-02 AC-2)
  const scheduleFlush = useCallback(() => {
    if (throttleTimerRef.current) return;
    throttleTimerRef.current = setTimeout(() => {
      throttleTimerRef.current = null;
      flushUpdates();
    }, WB_THROTTLE_MS);
  }, [flushUpdates]);

  // Cleanup pending timer on unmount and send any remaining updates
  useEffect(() => {
    return () => {
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
        flushUpdates();
      }
    };
  }, [flushUpdates]);

  // Handle local drawing / modifications
  const handleChange = useCallback(
    (elements: readonly any[]) => {
      // In view-only mode (can_whiteboard = false && !isHost), ignore changes
      if (isReadOnly) return;

      const changed: any[] = [];
      for (const el of elements) {
        if (!el || !el.id) continue;
        const lastVersion = sentVersionsRef.current.get(el.id);
        if (lastVersion === undefined || el.version > lastVersion) {
          changed.push(el);
          pendingUpdatesRef.current.set(el.id, el);
        }
      }

      if (changed.length > 0) {
        scheduleFlush();
        onElementsChange?.(Array.from(elements));
      }
    },
    [isReadOnly, scheduleFlush, onElementsChange]
  );

  // Listen to remote whiteboard updates from room members and errors
  useEffect(() => {
    const handleWbUpdate = (data: { roomId: string; elements: any[]; by?: string }) => {
      if (data.roomId !== roomId || !Array.isArray(data.elements)) return;
      if (data.by && user?.id && data.by === user.id) return; // avoid echo

      // Mark incoming versions as seen BEFORE updating scene so onChange won't re-broadcast
      for (const el of data.elements) {
        if (el?.id && typeof el.version === 'number') {
          const currentSeen = sentVersionsRef.current.get(el.id) ?? -1;
          if (el.version > currentSeen) {
            sentVersionsRef.current.set(el.id, el.version);
          }
        }
      }

      if (excalidrawAPI) {
        const localElements = excalidrawAPI.getSceneElementsIncludingDeleted();
        const appState = excalidrawAPI.getAppState();
        const reconciled = reconcileElements(localElements as any, data.elements as any, appState);
        excalidrawAPI.updateScene({ elements: reconciled });
        onElementsChange?.(reconciled);
      }
    };

    const handleRoomJoined = (data: any) => {
      const snapElements = data?.snapshot?.board?.elements || data?.board?.elements;
      if (Array.isArray(snapElements) && snapElements.length > 0) {
        for (const el of snapElements) {
          if (el?.id && typeof el.version === 'number') {
            sentVersionsRef.current.set(el.id, el.version);
          }
        }
        if (excalidrawAPI) {
          const localElements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const appState = excalidrawAPI.getAppState();
          const reconciled = reconcileElements(localElements as any, snapElements as any, appState);
          excalidrawAPI.updateScene({ elements: reconciled });
          onElementsChange?.(reconciled);
        }
      }
    };

    const handleSocketError = (err: any) => {
      if (err?.code === 'FORBIDDEN') {
        console.warn('[WhiteboardTab] Server rejected action:', err.message);
        setForbiddenError(err.message || 'Whiteboard edit permission required. Ask the room host for access.');
        const timer = setTimeout(() => setForbiddenError(null), 4000);
        return () => clearTimeout(timer);
      }
    };

    socket.on('wb:update', handleWbUpdate);
    socket.on('room:joined', handleRoomJoined);
    socket.on('error', handleSocketError);

    return () => {
      socket.off('wb:update', handleWbUpdate);
      socket.off('room:joined', handleRoomJoined);
      socket.off('error', handleSocketError);
    };
  }, [roomId, user?.id, excalidrawAPI, onElementsChange]);

  const clearCanvas = () => {
    if (isReadOnly || !excalidrawAPI) return;
    const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
    // Excalidraw deletion: set isDeleted: true and bump version (US-WB-02 AC-4)
    const deletedElements = elements.map((el) => ({
      ...el,
      isDeleted: true,
      version: (el.version ?? 0) + 1,
      versionNonce: Math.floor(Math.random() * 1000000),
    }));
    excalidrawAPI.updateScene({ elements: deletedElements });
    for (const el of deletedElements) {
      pendingUpdatesRef.current.set(el.id, el);
    }
    flushUpdates();
  };

  const downloadCanvas = async () => {
    if (!excalidrawAPI) return;
    try {
      const elements = excalidrawAPI.getSceneElements();
      const appState = excalidrawAPI.getAppState();
      const files = excalidrawAPI.getFiles();
      const blob = await exportToBlob({
        elements,
        appState: {
          ...appState,
          exportWithDarkMode: theme === 'dark',
        },
        files,
        mimeType: 'image/png',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `whiteboard-${roomId}.png`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[WhiteboardTab] Failed to export whiteboard:', err);
    }
  };

  return (
    <div
      className="flex flex-col h-full min-h-[650px] gap-3"
      id="room-whiteboard-container"
      data-testid="room-whiteboard-container"
    >
      {/* Whiteboard Header Toolbar */}
      <div className="flex items-center gap-2 px-1 flex-wrap">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-400 text-xs font-semibold">
          <PenLine className="w-3.5 h-3.5" />
          <span>Excalidraw Whiteboard</span>
        </div>

        {/* Status badges */}
        {isReadOnly ? (
          <span
            id="whiteboard-disabled-badge"
            data-testid="whiteboard-disabled-badge"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-[11px] font-semibold"
          >
            <Eye className="w-3.5 h-3.5" />
            <span id="whiteboard-view-only-badge" data-testid="whiteboard-view-only-badge">
              View-only mode (Teacher turned off whiteboard access)
            </span>
          </span>
        ) : (
          <span
            id="whiteboard-edit-badge"
            data-testid="whiteboard-edit-badge"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold"
          >
            <PenLine className="w-3.5 h-3.5" />
            <span>Editing enabled</span>
          </span>
        )}

        {forbiddenError && (
          <span
            id="whiteboard-error-badge"
            data-testid="whiteboard-error-badge"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[11px] font-semibold"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{forbiddenError}</span>
          </span>
        )}

        <div className="flex-1" />

        <button
          id="whiteboard-clear"
          data-testid="whiteboard-clear"
          disabled={isReadOnly}
          onClick={clearCanvas}
          title={isReadOnly ? 'Whiteboard access disabled' : 'Clear canvas'}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
            isReadOnly
              ? 'opacity-50 cursor-not-allowed bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
              : 'text-slate-600 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Clear
        </button>

        <button
          id="whiteboard-download"
          data-testid="whiteboard-download"
          onClick={downloadCanvas}
          title="Download board snapshot as PNG"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          Save PNG
        </button>
      </div>

      {/* Canvas Container */}
      <div
        className="flex-1 w-full h-full min-h-[500px] rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-inner relative"
      >
        <div id="room-whiteboard-canvas" data-testid="room-whiteboard-canvas" className="w-full h-full">
          <Excalidraw
            excalidrawAPI={(api) => setExcalidrawAPI(api)}
            viewModeEnabled={isReadOnly} /* viewModeEnabled={!canWhiteboard} */
            theme={theme === 'dark' ? 'dark' : 'light'}
            onChange={handleChange}
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: !isReadOnly,
                clearCanvas: !isReadOnly,
                export: { saveFileToDisk: true },
                saveAsImage: true,
              },
              tools: {
                image: false,
              },
            }}
            onPaste={(data) => {
              if (data.files && Object.keys(data.files).length > 0) {
                return false;
              }
              return true;
            }}
          />
        </div>
      </div>

      <p className="text-xs text-center text-slate-400 dark:text-slate-500">
        {isReadOnly
          ? 'You are viewing the shared whiteboard in view-only mode.'
          : 'Interactive collaborative whiteboard powered by Excalidraw.'}
      </p>
    </div>
  );
};
