import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  ScreenShare,
  ScreenShareOff,
  PenLine,
  PenOff,
  Code2,
  X,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import {
  PermissionKey,
  Permissions,
  PermChangedPayload,
  diffPermissions,
  getPermissionChangeMessage,
} from '@linkup/shared';
import { socket } from '../../lib/socket';

export interface PermissionToastItem {
  id: string;
  permission: PermissionKey;
  granted: boolean;
  message: string;
  timestamp: number;
}

interface PermissionToastContainerProps {
  roomId?: string;
  currentUserId?: string;
  initialPermissions?: Permissions | null;
}

/**
 * Returns the appropriate icon for a granted or revoked permission.
 */
const getPermissionIcon = (key: PermissionKey, granted: boolean) => {
  if (granted) {
    switch (key) {
      case 'canMic':
        return <Mic className="w-5 h-5 text-emerald-500 shrink-0" />;
      case 'canCamera':
        return <Video className="w-5 h-5 text-emerald-500 shrink-0" />;
      case 'canScreen':
        return <ScreenShare className="w-5 h-5 text-emerald-500 shrink-0" />;
      case 'canWhiteboard':
        return <PenLine className="w-5 h-5 text-emerald-500 shrink-0" />;
      case 'canCode':
        return <Code2 className="w-5 h-5 text-emerald-500 shrink-0" />;
      default:
        return <Sparkles className="w-5 h-5 text-emerald-500 shrink-0" />;
    }
  } else {
    switch (key) {
      case 'canMic':
        return <MicOff className="w-5 h-5 text-amber-500 shrink-0" />;
      case 'canCamera':
        return <VideoOff className="w-5 h-5 text-amber-500 shrink-0" />;
      case 'canScreen':
        return <ScreenShareOff className="w-5 h-5 text-amber-500 shrink-0" />;
      case 'canWhiteboard':
        return <PenOff className="w-5 h-5 text-amber-500 shrink-0" />;
      case 'canCode':
        return <Code2 className="w-5 h-5 text-amber-500 shrink-0" />;
      default:
        return <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0" />;
    }
  }
};

/**
 * US-PERM-03: Permission Change Toast (Student)
 * Priority: P0 | Traces to: FR-4.4
 *
 * Acceptance Criteria:
 * 1. When a permission is revoked, the student sees a toast like: "Teacher turned off your microphone."
 * 2. When a permission is granted, the student sees: "You can now edit the whiteboard."
 * 3. Toasts are non-blocking and auto-dismiss after 4 seconds.
 */
export const PermissionToastContainer: React.FC<PermissionToastContainerProps> = ({
  roomId,
  currentUserId,
  initialPermissions,
}) => {
  const [toasts, setToasts] = useState<PermissionToastItem[]>([]);
  const prevPermissionsRef = useRef<Permissions | null>(initialPermissions || null);

  // Sync initial permissions if provided later
  useEffect(() => {
    if (initialPermissions && !prevPermissionsRef.current) {
      prevPermissionsRef.current = { ...initialPermissions };
    }
  }, [initialPermissions]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (item: Omit<PermissionToastItem, 'id' | 'timestamp'>) => {
      const id = `${item.permission}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const newToast: PermissionToastItem = {
        ...item,
        id,
        timestamp: Date.now(),
      };

      setToasts((prev) => [...prev, newToast]);

      // Auto-dismiss after 4 seconds (4000ms) - US-PERM-03 Acceptance Criteria 3
      const timer = setTimeout(() => {
        removeToast(id);
      }, 4000);

      return () => clearTimeout(timer);
    },
    [removeToast]
  );

  useEffect(() => {
    if (!roomId) return;

    const onPermChanged = (data: PermChangedPayload) => {
      // Must match current room
      if (data.roomId !== roomId) return;

      // Only notify if this change targets the current user (US-PERM-03 / FR-4.4)
      if (currentUserId && data.userId !== currentUserId) {
        return;
      }

      const prev = prevPermissionsRef.current;
      const next = data.permissions;

      if (!prev) {
        // First time seeing permissions, store and don't toast unless changed
        prevPermissionsRef.current = { ...next };
        return;
      }

      const diffs = diffPermissions(prev, next);
      prevPermissionsRef.current = { ...next };

      diffs.forEach((diff) => {
        addToast({
          permission: diff.key,
          granted: diff.granted,
          message: diff.message,
        });
      });
    };

    socket.on('perm:changed', onPermChanged);

    // Also support manual test/debug events dispatched in window
    const onCustomEvent = (event: Event) => {
      const custom = event as CustomEvent<{
        permission: PermissionKey;
        granted: boolean;
        message?: string;
      }>;
      if (custom.detail) {
        const { permission, granted, message } = custom.detail;
        addToast({
          permission,
          granted,
          message: message || getPermissionChangeMessage(permission, granted),
        });
      }
    };

    window.addEventListener('linkup:perm-toast', onCustomEvent);

    return () => {
      socket.off('perm:changed', onPermChanged);
      window.removeEventListener('linkup:perm-toast', onCustomEvent);
    };
  }, [addToast, currentUserId, roomId]);

  if (toasts.length === 0) return null;

  return (
    <aside
      id="permission-toast-container"
      data-testid="permission-toast-container"
      aria-label="Permission Notifications"
      aria-live="polite"
      className="fixed top-5 right-5 z-[9999] flex flex-col gap-3 max-w-sm w-full pointer-events-none"
    >
      {toasts.map((toast) => {
        const isGranted = toast.granted;

        return (
          <div
            key={toast.id}
            id="permission-change-toast"
            data-testid="permission-change-toast"
            data-action={isGranted ? 'granted' : 'revoked'}
            data-perm={toast.permission}
            role="status"
            className={`pointer-events-auto relative overflow-hidden rounded-2xl p-4 shadow-2xl backdrop-blur-xl border transition-all duration-300 transform translate-y-0 opacity-100 ${
              isGranted
                ? 'bg-white/95 dark:bg-slate-900/95 border-emerald-500/40 text-slate-800 dark:text-slate-100 shadow-emerald-500/10'
                : 'bg-white/95 dark:bg-slate-900/95 border-amber-500/40 text-slate-800 dark:text-slate-100 shadow-amber-500/10'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`p-2 rounded-xl shrink-0 ${
                  isGranted
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800'
                }`}
              >
                {getPermissionIcon(toast.permission, isGranted)}
              </div>

              <div className="flex-1 min-w-0 pr-2">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      isGranted
                        ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {isGranted ? 'Permission Granted' : 'Permission Revoked'}
                  </span>
                </div>
                <p
                  id="permission-toast-message"
                  data-testid="permission-toast-message"
                  className="text-xs font-semibold leading-relaxed text-slate-900 dark:text-slate-100"
                >
                  {toast.message}
                </p>
              </div>

              {/* Manual dismiss button */}
              <button
                id={`dismiss-perm-toast-${toast.id}`}
                data-testid="dismiss-perm-toast"
                type="button"
                onClick={() => removeToast(toast.id)}
                title="Dismiss notification"
                aria-label="Dismiss notification"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 4-second Countdown progress bar (US-PERM-03 Acceptance Criteria 3) */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-200/50 dark:bg-slate-800/50 overflow-hidden">
              <div
                className={`h-full ${
                  isGranted
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                    : 'bg-gradient-to-r from-amber-500 to-rose-400'
                }`}
                style={{
                  width: '100%',
                  animation: 'permToastProgress 4000ms linear forwards',
                }}
              />
            </div>
          </div>
        );
      })}

      <style>{`
        @keyframes permToastProgress {
          from {
            width: 100%;
          }
          to {
            width: 0%;
          }
        }
      `}</style>
    </aside>
  );
};
