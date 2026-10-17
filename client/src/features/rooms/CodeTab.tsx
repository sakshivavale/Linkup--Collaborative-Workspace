import React, { useEffect, useState, useRef, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import {
  Code2,
  Play,
  ChevronDown,
  Eye,
  Edit3,
  Sparkles,
  RotateCcw,
  AlertCircle,
  Loader2,
  Terminal,
  AlertTriangle,
} from 'lucide-react';
import { Language, CodeState, Member, RunResult, MAX_CODE_BYTES, CODE_DEBOUNCE_MS } from '@linkup/shared';
import { socket } from '../../lib/socket';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';

export interface LanguageOption {
  id: Language;
  label: string;
  monacoLang: string;
  starterSnippet: string;
}

export const LANGUAGES: LanguageOption[] = [
  {
    id: 'python',
    label: 'Python',
    monacoLang: 'python',
    starterSnippet: '# Shared Python Code Workspace\nprint("Hello, Linkup!")\n',
  },
  {
    id: 'javascript',
    label: 'JavaScript',
    monacoLang: 'javascript',
    starterSnippet: '// Shared JavaScript Code Workspace\nconsole.log("Hello, Linkup!");\n',
  },
  {
    id: 'cpp',
    label: 'C++',
    monacoLang: 'cpp',
    starterSnippet: '// Shared C++ Code Workspace\n#include <iostream>\n\nint main() {\n    std::cout << "Hello, Linkup!" << std::endl;\n    return 0;\n}\n',
  },
  {
    id: 'java',
    label: 'Java',
    monacoLang: 'java',
    starterSnippet: '// Shared Java Code Workspace\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, Linkup!");\n    }\n}\n',
  },
];

export interface CodeTabProps {
  roomId: string;
  canCode?: boolean;
  members?: Member[];
  initialCodeState?: CodeState | null;
  onCodeStateChange?: (state: CodeState) => void;
  isHost?: boolean;
}

/**
 * US-CODE-01: View the Shared Editor
 * US-CODE-02: Give the Pen to a Student (Host)
 * Acceptance Criteria:
 * 1. A "Give Pen" dropdown lists all participants with can_code = true; a "Take Back" button is shown when a student holds the pen.
 * 2. Clicking assigns the pen: the server emits code:pen { holderId } to all room members; the student's editor becomes writable; the host's editor becomes read-only.
 * 3. A student without can_code is not listed in the dropdown.
 * 4. Only the host can assign the pen; a participant cannot self-assign.
 */
export const CodeTab: React.FC<CodeTabProps> = ({
  roomId,
  canCode = true,
  members = [],
  initialCodeState = null,
  onCodeStateChange,
  isHost,
}) => {
  const { user, fullName } = useAuth();

  const [content, setContent] = useState<string>(
    initialCodeState?.content ?? '# Shared Python Code Workspace\nprint("Hello, Linkup!")\n'
  );
  const [language, setLanguage] = useState<Language>(initialCodeState?.language ?? 'python');
  const [rev, setRev] = useState<number>(initialCodeState?.rev ?? 0);
  const [holderId, setHolderId] = useState<string | null>(initialCodeState?.holderId ?? null);

  const [stdin, setStdin] = useState<string>('');
  const [running, setRunning] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const [localMembers, setLocalMembers] = useState<Member[]>(members);
  useEffect(() => {
    setLocalMembers(members);
  }, [members]);

  const contentRef = useRef<string>(content);
  contentRef.current = content;
  const languageRef = useRef<Language>(language);
  languageRef.current = language;
  const revRef = useRef<number>(rev);
  revRef.current = rev;
  const holderIdRef = useRef<string | null>(holderId);
  holderIdRef.current = holderId;

  const DEBOUNCE_MS = CODE_DEBOUNCE_MS; // 150 ms debounce per US-CODE-03 & FR-5.2
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef<boolean>(false);

  // Synchronize from initialCodeState (e.g. from room:join snapshot or re-join)
  useEffect(() => {
    if (initialCodeState) {
      if (!isInitializedRef.current || holderId !== user?.id) {
        if (typeof initialCodeState.content === 'string') {
          setContent(initialCodeState.content);
        }
        if (initialCodeState.language) {
          setLanguage(initialCodeState.language);
        }
        if (typeof initialCodeState.rev === 'number') {
          setRev(initialCodeState.rev);
        }
        if (initialCodeState.holderId !== undefined) {
          setHolderId(initialCodeState.holderId);
        }
        isInitializedRef.current = true;
      }
    }
  }, [initialCodeState, holderId, user?.id]);

  // Fallback REST fetch if initialCodeState is not provided on mount (US-CODE-06)
  useEffect(() => {
    if (!initialCodeState && roomId) {
      api
        .get<CodeState>(`/api/rooms/${roomId}/code`)
        .then((saved) => {
          if (saved) {
            if (typeof saved.content === 'string') setContent(saved.content);
            if (saved.language) setLanguage(saved.language);
            if (typeof saved.rev === 'number') setRev(saved.rev);
            if (saved.holderId !== undefined) setHolderId(saved.holderId);
            onCodeStateChange?.(saved);
            isInitializedRef.current = true;
          }
        })
        .catch(() => {});
    }
  }, [roomId, initialCodeState, onCodeStateChange]);

  // Determine if current user is host
  const isUserHost = useMemo(() => {
    if (typeof isHost === 'boolean') return isHost;
    const myMember = localMembers.find((m) => m.userId === user?.id);
    return myMember?.memberRole === 'host';
  }, [isHost, localMembers, user?.id]);

  // Identify room host user ID
  const hostUserId = useMemo(() => {
    const hostMember = localMembers.find((m) => m.memberRole === 'host');
    if (hostMember) return hostMember.userId;
    if (isUserHost && user?.id) return user.id;
    return null;
  }, [localMembers, isUserHost, user?.id]);

  // Determine if a student currently holds the pen
  const studentHoldsPen = useMemo(() => {
    if (!holderId) return false;
    if (hostUserId && holderId === hostUserId) return false;
    if (isUserHost && holderId === user?.id) return false;
    return true;
  }, [holderId, hostUserId, isUserHost, user?.id]);

  // AC 1 & AC 3: Filter participants who have can_code = true (non-hosts)
  const eligibleStudents = useMemo(() => {
    return localMembers.filter((m) => {
      const isHostMember = m.memberRole === 'host' || (hostUserId && m.userId === hostUserId);
      if (isHostMember) return false;
      return Boolean(m.permissions?.canCode);
    });
  }, [localMembers, hostUserId]);

  // Determine if current user holds the pen
  const isPenHolder = useMemo(() => {
    if (!user?.id) return false;
    // If holderId is explicitly set, check match
    if (holderId) {
      return holderId === user.id;
    }
    // If holderId is not yet assigned, default to room host
    return isUserHost;
  }, [holderId, isUserHost, user?.id]);

  const canEdit = Boolean(isPenHolder && canCode);
  const isReadOnly = !canEdit;

  // AC 1: "A 'Run' button is visible in the Code tab for the pen holder and the host."
  const canRun = useMemo(() => {
    return Boolean(isPenHolder || isUserHost);
  }, [isPenHolder, isUserHost]);

  // Acceptance Criterion 3: "The editor header shows who is currently editing (e.g., 'Priya is editing')"
  const editorDisplayName = useMemo(() => {
    if (holderId) {
      if (user?.id && holderId === user.id) {
        return fullName || 'You';
      }
      const member = localMembers.find((m) => m.userId === holderId);
      if (member?.fullName) {
        return member.fullName;
      }
    }

    // Fallback: look for host in members
    const hostMember = localMembers.find((m) => m.memberRole === 'host');
    if (hostMember?.fullName) {
      if (user?.id && hostMember.userId === user.id) {
        return fullName || 'You';
      }
      return hostMember.fullName;
    }

    return 'Teacher';
  }, [holderId, localMembers, user, fullName]);

  // US-CODE-02: Host assigns pen to student
  const handleAssignPen = (targetHolderId: string) => {
    if (!targetHolderId || !isUserHost) return;
    socket.emit(
      'code:pen',
      {
        roomId,
        holderId: targetHolderId,
      },
      (ack: any) => {
        if (ack?.ok) {
          setHolderId(targetHolderId);
          onCodeStateChange?.({
            content: contentRef.current,
            language: languageRef.current,
            rev: revRef.current,
            holderId: targetHolderId,
          });
        }
      }
    );
  };

  // US-CODE-02: Host takes back pen from student
  const handleTakeBackPen = () => {
    if (!isUserHost || !user?.id) return;
    const targetId = hostUserId || user.id;
    socket.emit(
      'code:pen',
      {
        roomId,
        holderId: targetId,
      },
      (ack: any) => {
        if (ack?.ok) {
          setHolderId(targetId);
          onCodeStateChange?.({
            content: contentRef.current,
            language: languageRef.current,
            rev: revRef.current,
            holderId: targetId,
          });
        }
      }
    );
  };

  // Real-time Socket.IO listeners: code:state, code:pen, perm:changed, room:joined
  useEffect(() => {
    const handleCodeState = (data: { roomId: string } & CodeState) => {
      if (data.roomId === roomId) {
        // If current user is currently actively editing and holds pen, don't overwrite own local keystrokes
        if (holderIdRef.current === user?.id && data.holderId === user?.id) {
          return;
        }

        setContent(data.content);
        if (data.language) setLanguage(data.language);
        if (typeof data.rev === 'number') setRev(data.rev);
        if (data.holderId !== undefined) setHolderId(data.holderId);

        onCodeStateChange?.(data);
      }
    };

    const handleCodePen = (data: { roomId: string; holderId: string; by?: string }) => {
      if (data.roomId === roomId) {
        setHolderId(data.holderId);
        onCodeStateChange?.({
          content: contentRef.current,
          language: languageRef.current,
          rev: revRef.current,
          holderId: data.holderId,
        });
      }
    };

    const handlePermChanged = (data: { roomId: string; userId: string; permissions: any }) => {
      if (data.roomId === roomId) {
        setLocalMembers((prev) =>
          prev.map((m) =>
            m.userId === data.userId
              ? { ...m, permissions: { ...m.permissions, ...data.permissions } }
              : m
          )
        );
      }
    };

    const handleRoomJoined = (data: any) => {
      if (data?.roomId === roomId && data?.snapshot?.code) {
        const snapCode = data.snapshot.code;
        setContent(snapCode.content);
        if (snapCode.language) setLanguage(snapCode.language);
        if (typeof snapCode.rev === 'number') setRev(snapCode.rev);
        if (snapCode.holderId !== undefined) setHolderId(snapCode.holderId);
        onCodeStateChange?.(snapCode);
      }
    };

    const handleSocketError = (err: any) => {
      if (
        err?.event === 'code:update' ||
        err?.code === 'PAYLOAD_TOO_LARGE' ||
        err?.code === 'NOT_PEN_HOLDER'
      ) {
        setSyncError(err.message || 'Code sync error');
      }
    };

    // AC 3 & AC 5: Shared execution listeners
    const handleRunStarted = (data: { roomId: string; by: string; language: Language }) => {
      if (data.roomId === roomId) {
        setRunning(true);
        setRunError(null);
      }
    };

    const handleRunResult = (data: { roomId: string; result: RunResult }) => {
      if (data.roomId === roomId) {
        setRunning(false);
        setRunResult(data.result);
        setRunError(null);
      }
    };

    socket.on('code:state', handleCodeState);
    socket.on('code:pen', handleCodePen);
    socket.on('perm:changed', handlePermChanged);
    socket.on('room:joined', handleRoomJoined);
    socket.on('error', handleSocketError);
    socket.on('code:run-started', handleRunStarted);
    socket.on('code:run-result', handleRunResult);

    return () => {
      socket.off('code:state', handleCodeState);
      socket.off('code:pen', handleCodePen);
      socket.off('perm:changed', handlePermChanged);
      socket.off('room:joined', handleRoomJoined);
      socket.off('error', handleSocketError);
      socket.off('code:run-started', handleRunStarted);
      socket.off('code:run-result', handleRunResult);
    };
  }, [roomId, user?.id, onCodeStateChange]);

  // Debounced code changes (150 ms debounce per US-CODE-03 & FR-5.2)
  const handleEditorChange = (newVal: string | undefined) => {
    const value = newVal ?? '';
    setContent(value);

    // Immediately keep parent codeState updated so switching tabs retains latest edits
    onCodeStateChange?.({
      content: value,
      language: languageRef.current,
      rev: revRef.current,
      holderId: holderIdRef.current,
    });

    if (!canEdit) return;

    // US-CODE-03 AC-4: Source size must be max 64 KB
    const encoder = new TextEncoder();
    const sizeBytes = encoder.encode(value).length;
    if (sizeBytes > MAX_CODE_BYTES) {
      setSizeError('Source code exceeds the 64 KB limit.');
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      return;
    } else {
      if (sizeError) setSizeError(null);
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      socket.emit(
        'code:update',
        {
          roomId,
          content: value,
          language: languageRef.current,
        },
        (ack: any) => {
          if (ack?.ok && ack?.data?.rev) {
            setRev(ack.data.rev);
            setSyncError(null);
            onCodeStateChange?.({
              content: value,
              language: languageRef.current,
              rev: ack.data.rev,
              holderId: holderIdRef.current,
            });
          } else if (ack?.error) {
            setSyncError(ack.error.message || 'Failed to sync code');
          }
        }
      );
    }, DEBOUNCE_MS);
  };

  // Language selector change
  const handleLanguageChange = (newLang: Language) => {
    setLanguage(newLang);

    if (!canEdit) return;

    socket.emit(
      'code:update',
      {
        roomId,
        content: contentRef.current,
        language: newLang,
      },
      (ack: any) => {
        if (ack?.ok && ack?.data?.rev) {
          setRev(ack.data.rev);
          setSyncError(null);
          onCodeStateChange?.({
            content: contentRef.current,
            language: newLang,
            rev: ack.data.rev,
            holderId: holderIdRef.current,
          });
        } else if (ack?.error) {
          setSyncError(ack.error.message || 'Failed to sync language');
        }
      }
    );
  };

  // Clean up and flush pending debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        if (canEdit) {
          socket.emit('code:update', {
            roomId,
            content: contentRef.current,
            language: languageRef.current,
          });
        }
      }
    };
  }, [canEdit, roomId]);

  // AC 3: Clicking Run emits code:run-started to the room and calls POST /execute via Piston
  const handleRun = async () => {
    if (!canRun || running) return;
    setRunning(true);
    setRunError(null);

    // Emit code:run-started immediately to the room
    socket.emit('code:run-started', {
      roomId,
      by: fullName || (user as any)?.fullName || user?.id || 'User',
      language,
    });

    try {
      const res = await api.post<RunResult>('/api/execute', {
        roomId,
        language,
        code: content,
        stdin: stdin.trim() ? stdin : undefined,
      });
      setRunResult(res);
      setRunError(null);
    } catch (err: any) {
      const errMsg = err?.data?.error?.message || err?.message || 'Execution failed';
      setRunError(errMsg);
    } finally {
      setRunning(false);
    }
  };

  const monacoLanguage = useMemo(() => {
    const matched = LANGUAGES.find((l) => l.id === language);
    return matched?.monacoLang || 'python';
  }, [language]);

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header Toolbar */}
      <div className="flex items-center gap-2 flex-wrap px-1">
        {/* Module Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 text-purple-700 dark:text-purple-300 text-xs font-semibold shadow-sm">
          <Code2 className="w-3.5 h-3.5" />
          <span>Shared Editor</span>
        </div>

        {/* AC 3: Who is currently editing (e.g., "Priya is editing") */}
        <div
          id="code-editor-holder-status"
          data-testid="code-editor-holder-status"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 text-purple-700 dark:text-purple-300 text-xs font-medium shadow-sm transition-all"
        >
          <Edit3 className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
          <span>
            <strong className="text-purple-700 dark:text-purple-300 font-semibold">{editorDisplayName}</strong> is editing
            {isPenHolder && <span className="ml-1 text-[11px] text-purple-500 dark:text-purple-400 font-normal">(You)</span>}
          </span>
        </div>

        {/* Read-Only Badge for Non-Pen Holders */}
        {isReadOnly && (
          <span
            id="code-readonly-badge"
            data-testid="code-readonly-badge"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-medium"
          >
            <Eye className="w-3 h-3 text-slate-500 dark:text-slate-400" />
            <span>Read-only mode</span>
          </span>
        )}

        {/* Disabled Badge if canCode is false */}
        {!canCode && (
          <span
            id="code-disabled-badge"
            data-testid="code-disabled-badge"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-[11px] font-semibold"
          >
            Teacher turned off code editor access
          </span>
        )}

        {/* US-CODE-02: Host Pen Controls */}
        {isUserHost && (
          <div
            id="code-pen-host-controls"
            data-testid="code-pen-host-controls"
            className="inline-flex items-center gap-2"
          >
            {/* Take Back Button (shown when a student holds the pen) */}
            {studentHoldsPen && (
              <button
                id="code-take-back-btn"
                data-testid="code-take-back-btn"
                type="button"
                onClick={handleTakeBackPen}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 active:scale-95 transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                title="Take back edit pen from student"
                aria-label="Take Back"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Take Back</span>
              </button>
            )}

            {/* Give Pen Dropdown (lists all participants with can_code = true) */}
            <div
              id="code-give-pen-container"
              data-testid="code-give-pen-container"
              className="relative inline-flex items-center"
            >
              <select
                id="code-give-pen-select"
                data-testid="code-give-pen-select"
                aria-label="Give Pen"
                value={studentHoldsPen ? (holderId || '') : ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) {
                    handleAssignPen(val);
                  }
                }}
                disabled={eligibleStudents.length === 0}
                className="appearance-none pl-3 pr-8 py-1.5 rounded-xl text-xs font-semibold bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-900/50 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 transition-all focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
              >
                <option value="" disabled={studentHoldsPen}>
                  {eligibleStudents.length === 0 ? 'Give Pen (No eligible students)' : 'Give Pen ▾'}
                </option>
                {eligibleStudents.map((student) => (
                  <option
                    key={student.userId}
                    value={student.userId}
                    id={`give-pen-option-${student.userId}`}
                    data-testid={`give-pen-option-${student.userId}`}
                  >
                    {student.fullName} {holderId === student.userId ? '(Pen Holder)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-purple-500 dark:text-purple-400" />
            </div>
          </div>
        )}

        {/* AC 1: Language selector (Python, JavaScript, C++, Java) */}
        <div className="relative">
          <select
            id="room-code-language"
            data-testid="room-code-language"
            value={language}
            disabled={!canEdit}
            onChange={(e) => handleLanguageChange(e.target.value as Language)}
            aria-label="Code language selector"
            title={!canEdit ? 'Only current pen holder can change language' : 'Select programming language'}
            className="appearance-none pl-3 pr-8 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 transition-all focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
            <option value="cpp">C++</option>
            <option value="java">Java</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
        </div>

        {/* Live sync pulse badge and rev indicator (AC-2) */}
        <div
          id="room-code-sync-badge"
          data-testid="room-code-sync-badge"
          className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] text-slate-500 dark:text-slate-400 font-medium select-none"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span id="room-code-rev" data-testid="room-code-rev" className="hidden sm:inline">
            Live Sync (rev {rev})
          </span>
        </div>

        {/* AC-4: Error notification badge for sync / 64 KB limit */}
        {(sizeError || syncError) && (
          <div
            id="code-sync-error"
            data-testid="code-sync-error"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[11px] font-semibold"
          >
            <AlertCircle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
            <span>{sizeError || syncError}</span>
          </div>
        )}

        <div className="flex-1" />

        {/* AC 1: Run Button (visible for pen holder and host) */}
        {canRun && (
          <button
            id="room-code-run"
            data-testid="room-code-run"
            type="button"
            onClick={handleRun}
            disabled={running || !canCode}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 active:scale-95 cursor-pointer"
          >
            {running ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span>{running ? 'Running…' : 'Run'}</span>
          </button>
        )}
      </div>

      {/* Editor Area with Monaco */}
      <div className="flex flex-col flex-1 gap-3 min-h-0">
        <div
          id="room-code-editor"
          data-testid="room-code-editor"
          data-debounce-ms="150"
          data-max-bytes="65536"
          data-rev={rev}
          data-pen-holder={holderId || ''}
          className="flex-1 w-full min-h-[300px] h-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-950 shadow-inner relative flex flex-col"
        >
          <Editor
            height="100%"
            language={monacoLanguage}
            value={content}
            theme="vs-dark"
            onChange={handleEditorChange}
            options={{
              readOnly: isReadOnly,
              minimap: { enabled: false },
              fontSize: 14,
              fontFamily: 'JetBrains Mono, Fira Code, Menlo, Monaco, Consolas, monospace',
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: 'on',
              padding: { top: 12, bottom: 12 },
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              domReadOnly: isReadOnly,
              renderLineHighlight: isReadOnly ? 'none' : 'line',
            }}
            loading={
              <div className="flex items-center justify-center h-full text-slate-400 gap-2 text-xs">
                <Sparkles className="w-4 h-4 animate-spin text-purple-400" />
                <span>Loading Monaco Editor...</span>
              </div>
            }
          />

          {/* Synchronized accessible textarea for headless inspection & tests */}
          <textarea
            id="room-code-editor-sync"
            data-testid="room-code-editor-sync"
            value={content}
            readOnly={isReadOnly}
            aria-hidden="true"
            tabIndex={-1}
            className="sr-only"
          />
        </div>

        {/* AC 2: Optional stdin text box available before running */}
        <div
          id="room-code-stdin-container"
          data-testid="room-code-stdin-container"
          className="flex flex-col gap-1 px-1 shrink-0"
        >
          <label
            htmlFor="room-code-stdin"
            className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 select-none"
          >
            <Terminal className="w-3 h-3 text-slate-400" />
            <span>Standard Input (stdin)</span>
            <span className="text-[10px] text-slate-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="room-code-stdin"
            data-testid="room-code-stdin"
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
            placeholder="Enter input passed to program on stdin..."
            rows={2}
            disabled={!canRun}
            className="w-full px-3 py-1.5 text-xs font-mono rounded-xl bg-slate-900/90 border border-slate-200 dark:border-slate-800 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none shadow-inner"
          />
        </div>

        {/* AC 4 & AC 5: Shared Output Panel */}
        <div
          id="room-code-output-panel"
          data-testid="room-code-output-panel"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950/95 p-3.5 font-mono text-xs shadow-inner flex flex-col gap-2 max-h-52 overflow-y-auto shrink-0"
        >
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 select-none">
                Execution Output
              </span>
              {runResult?.by && (
                <span className="text-[11px] text-slate-500 select-none">
                  • run by <strong className="text-slate-300 font-medium">{runResult.by}</strong>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {running && (
                <div
                  id="code-run-spinner"
                  data-testid="code-run-spinner"
                  className="inline-flex items-center gap-1.5 text-indigo-400 text-xs font-semibold animate-pulse"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  <span>Running code...</span>
                </div>
              )}

              {!running && runResult && (
                <div
                  id="code-run-meta"
                  data-testid="code-run-meta"
                  className="flex items-center gap-2 text-[11px]"
                >
                  <span
                    id="code-run-exit-code"
                    data-testid="code-run-exit-code"
                    className={`px-2 py-0.5 rounded-md font-semibold ${
                      runResult.exitCode === 0
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}
                  >
                    Exit: {runResult.exitCode ?? 'N/A'}
                  </span>
                  <span
                    id="code-run-time"
                    data-testid="code-run-time"
                    className="text-slate-400 font-medium px-1.5 py-0.5 rounded-md bg-slate-800/50"
                  >
                    {runResult.timeMs} ms
                  </span>
                  {runResult.truncated && (
                    <span className="text-amber-400 text-[10px] px-1 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                      truncated
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Timeout banner */}
          {(runResult?.timedOut || runResult?.stderr?.includes('Time limit exceeded (3 s).')) && (
            <div
              id="code-run-timeout"
              data-testid="code-run-timeout"
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Time limit exceeded (3 s).</span>
            </div>
          )}

          {/* Error banner (e.g. 413, 429, 502) */}
          {runError && (
            <div
              id="code-run-error"
              data-testid="code-run-error"
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold"
            >
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{runError}</span>
            </div>
          )}

          {/* Stdout display */}
          {runResult?.stdout && (
            <div
              id="code-run-stdout"
              data-testid="code-run-stdout"
              className="text-emerald-400 whitespace-pre-wrap leading-relaxed font-mono"
            >
              {runResult.stdout}
            </div>
          )}

          {/* Stderr display (highlighted in red) */}
          {runResult?.stderr && (
            <div
              id="code-run-stderr"
              data-testid="code-run-stderr"
              className="text-rose-400 bg-rose-950/30 p-2.5 rounded-xl border border-rose-900/40 whitespace-pre-wrap leading-relaxed font-mono"
            >
              {runResult.stderr}
            </div>
          )}

          {/* Idle placeholder */}
          {!running && !runResult && !runError && (
            <div className="text-slate-500 italic text-xs py-1 select-none">
              Click &quot;Run&quot; to execute code in the sandbox. Output will appear here for all room members.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
