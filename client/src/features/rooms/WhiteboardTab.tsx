import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PenLine, RotateCcw, Download } from 'lucide-react';
import { Excalidraw, exportToBlob, reconcileElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import { WB_THROTTLE_MS } from '@linkup/shared';
import { socket } from '../../lib/socket';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

export interface WhiteboardTabProps {
  roomId: string;
  canWhiteboard?: boolean;
  initialElements?: any[];
  onElementsChange?: (elements: any[]) => void;
}

/**
 * US-WB-02: Draw on the Whiteboard (Permitted User) (Priority: P0 | Traces to: FR-5.11, FR-5.12)
 * Acceptance Criteria:
 * 1. The editor is writable for members with can_whiteboard = true and the host.
 * 2. Changed elements are throttled at 100 ms and broadcast via wb:update.
 * 3. All other members see changes within 500 ms.
 * 4. Deletions (Excalidraw isDeleted: true) sync correctly.
 * 5. The image tool is disabled (images need file storage, which is out of scope).
 */
export const WhiteboardTab: React.FC<WhiteboardTabProps> = ({
  roomId,
  canWhiteboard = true,
  initialElements = [],
  onElementsChange,
}) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);

  // Keep track of versions of elements sent or received to prevent infinite broadcast loops
  const sentVersionsRef = useRef<Map<string, number>>(new Map());
  const pendingUpdatesRef = useRef<Map<string, any>>(new Map());
  const throttleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef<boolean>(false);

  // Initialize scene with initial elements (e.g. from room:join snapshot)
  useEffect(() => {
    if (excalidrawAPI && initialElements && initialElements.length > 0 && !isInitializedRef.current) {
      for (const el of initialElements) {
        if (el?.id && typeof el.version === 'number') {
          sentVersionsRef.current.set(el.id, el.version);
        }
      }
      excalidrawAPI.updateScene({ elements: initialElements });
      isInitializedRef.current = true;
    }
  }, [excalidrawAPI, initialElements]);

  // Broadcast throttled pending changes to room members
  const flushUpdates = useCallback(() => {
    if (pendingUpdatesRef.current.size === 0) return;
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
  }, [roomId]);

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
      // If user is view-only (can_whiteboard = false), ignore
      if (!canWhiteboard) return;

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
    [canWhiteboard, scheduleFlush, onElementsChange]
  );

  // Listen to remote whiteboard updates from room members
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

    socket.on('wb:update', handleWbUpdate);
    return () => {
      socket.off('wb:update', handleWbUpdate);
    };
  }, [roomId, user?.id, excalidrawAPI, onElementsChange]);

  const clearCanvas = () => {
    if (!canWhiteboard || !excalidrawAPI) return;
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
      link.download = 'whiteboard.png';
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export whiteboard:', err);
    }
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-1">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-400 text-xs font-semibold">
          <PenLine className="w-3.5 h-3.5" />
          <span>Whiteboard</span>
        </div>
        {!canWhiteboard && (
          <span
            id="whiteboard-disabled-badge"
            data-testid="whiteboard-disabled-badge"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-[11px] font-semibold"
          >
            Teacher turned off whiteboard access
          </span>
        )}
        <div className="flex-1" />
        <button
          id="whiteboard-clear"
          disabled={!canWhiteboard}
          onClick={clearCanvas}
          title={!canWhiteboard ? 'Whiteboard access disabled' : 'Clear canvas'}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
            !canWhiteboard
              ? 'opacity-50 cursor-not-allowed bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
              : 'text-slate-600 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Clear
        </button>
        <button
          id="whiteboard-download"
          onClick={downloadCanvas}
          title="Download as PNG"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          Save
        </button>
      </div>

      {/* Canvas Container */}
      <div
        id="room-whiteboard-container"
        className="flex-1 w-full h-full min-h-[500px] rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-inner relative"
      >
        <div id="room-whiteboard-canvas" className="w-full h-full">
          <Excalidraw
            excalidrawAPI={(api) => setExcalidrawAPI(api)}
            viewModeEnabled={!canWhiteboard}
            theme={theme === 'dark' ? 'dark' : 'light'}
            onChange={handleChange}
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: true,
                clearCanvas: true,
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
    </div>
  );
};
