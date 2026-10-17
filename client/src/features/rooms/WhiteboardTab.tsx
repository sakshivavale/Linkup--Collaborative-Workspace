import React, { useEffect, useState, useRef, useCallback } from 'react';
import { PenLine, Eye, RotateCcw, Download, AlertCircle } from 'lucide-react';
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { socket } from '../../lib/socket';

export interface WhiteboardTabProps {
  roomId: string;
  canWhiteboard?: boolean;
  isHost?: boolean;
  initialElements?: any[];
}

/**
 * US-WB-01: View the Shared Whiteboard
 * Priority: P0 | Traces to: FR-5.10, FR-5.11
 *
 * Acceptance Criteria:
 * 1. The Whiteboard tab renders Excalidraw in view-only mode for members where can_whiteboard = false and who are not the host.
 * 2. Drawings appear in view-only mode with no drawing tools visible.
 * 3. Attempting a whiteboard draw via a crafted socket event returns error { code: "FORBIDDEN" } and does not affect the board for others.
 */
export const WhiteboardTab: React.FC<WhiteboardTabProps> = ({
  roomId,
  canWhiteboard = false,
  isHost = false,
  initialElements = [],
}) => {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [elements, setElements] = useState<any[]>(initialElements);
  const [forbiddenError, setForbiddenError] = useState<string | null>(null);

  // View-only mode for members where can_whiteboard = false and who are not the host
  const isReadOnly = !isHost && !canWhiteboard;

  // Track sent versions to avoid echo loops
  const seenVersionsRef = useRef<Record<string, number>>({});
  const throttleTimerRef = useRef<any>(null);

  // Real-time synchronization from Socket.IO: wb:update, room:joined, error
  useEffect(() => {
    if (!roomId) return;

    const handleRoomJoined = (data: any) => {
      const snapElements = data?.snapshot?.board?.elements || data?.board?.elements;
      if (Array.isArray(snapElements)) {
        setElements(snapElements);
        if (excalidrawAPI) {
          excalidrawAPI.updateScene({ elements: snapElements });
        }
      }
    };

    const handleWbUpdate = (data: any) => {
      if (data?.roomId === roomId && Array.isArray(data?.elements)) {
        const incoming = data.elements;
        setElements(incoming);

        // Update seen versions
        incoming.forEach((el: any) => {
          if (el?.id && el?.version) {
            seenVersionsRef.current[el.id] = el.version;
          }
        });

        if (excalidrawAPI) {
          excalidrawAPI.updateScene({ elements: incoming });
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

    socket.on('room:joined', handleRoomJoined);
    socket.on('wb:update', handleWbUpdate);
    socket.on('error', handleSocketError);

    return () => {
      socket.off('room:joined', handleRoomJoined);
      socket.off('wb:update', handleWbUpdate);
      socket.off('error', handleSocketError);
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
      }
    };
  }, [roomId, excalidrawAPI]);

  // Sync initialElements when API is ready
  useEffect(() => {
    if (excalidrawAPI && initialElements && initialElements.length > 0) {
      excalidrawAPI.updateScene({ elements: initialElements });
    }
  }, [excalidrawAPI, initialElements]);

  // Handle changes from Excalidraw editor
  const handleChange = useCallback(
    (newElements: readonly any[]) => {
      // In view-only mode, NEVER emit updates
      if (isReadOnly) return;

      // Filter for changed elements
      const changed = newElements.filter((el: any) => {
        if (!el?.id) return false;
        const seenVersion = seenVersionsRef.current[el.id] || 0;
        return (el.version || 0) > seenVersion;
      });

      if (changed.length === 0) return;

      // Update seen versions
      changed.forEach((el: any) => {
        seenVersionsRef.current[el.id] = el.version;
      });

      // Throttle broadcast at 100 ms per architecture specification
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
      }

      throttleTimerRef.current = setTimeout(() => {
        socket.emit('wb:update', {
          roomId,
          elements: Array.from(newElements),
        });
      }, 100);
    },
    [isReadOnly, roomId]
  );

  // Clear whiteboard (for permitted users / host)
  const handleClear = useCallback(() => {
    if (isReadOnly || !excalidrawAPI) return;
    excalidrawAPI.resetScene();
    socket.emit('wb:update', {
      roomId,
      elements: [],
    });
  }, [isReadOnly, excalidrawAPI, roomId]);

  // Download board snapshot as PNG
  const handleDownload = useCallback(async () => {
    if (!excalidrawAPI) return;
    try {
      const currentElements = excalidrawAPI.getSceneElements();
      const appState = excalidrawAPI.getAppState();
      const blob = await exportToBlob({
        elements: currentElements,
        appState: {
          ...appState,
          exportWithDarkMode: false,
        },
        files: excalidrawAPI.getFiles(),
        mimeType: 'image/png',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `whiteboard-${roomId}.png`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[WhiteboardTab] Failed to download board:', err);
    }
  }, [excalidrawAPI, roomId]);

  return (
    <div className="flex flex-col h-full min-h-[650px] gap-3" id="room-whiteboard-container" data-testid="room-whiteboard-container">
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
          onClick={handleClear}
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
          onClick={handleDownload}
          title="Download board snapshot as PNG"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          Save PNG
        </button>
      </div>

      {/* Excalidraw Canvas Container */}
      <div
        id="room-whiteboard-canvas"
        data-testid="room-whiteboard-canvas"
        className="flex-1 w-full min-h-[580px] h-[600px] rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-inner relative"
      >
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          initialData={{
            elements: initialElements.length > 0 ? initialElements : elements,
            appState: {
              viewModeEnabled: isReadOnly,
            },
          }}
          viewModeEnabled={isReadOnly}
          onChange={handleChange}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: !isReadOnly,
              clearCanvas: !isReadOnly,
              loadScene: false,
              saveToActiveFile: false,
              export: { saveFileToDisk: true },
              toggleTheme: false,
            },
            tools: {
              image: false, // Images disabled in MVP per architecture spec
            },
          }}
        />
      </div>

      <p className="text-xs text-center text-slate-400 dark:text-slate-500">
        {isReadOnly
          ? 'You are viewing the shared whiteboard in view-only mode.'
          : 'Interactive collaborative whiteboard powered by Excalidraw.'}
      </p>
    </div>
  );
};
