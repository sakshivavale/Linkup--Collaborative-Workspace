import React, { useEffect, useState, useRef, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import {
  Code2,
  Play,
  ChevronDown,
  Eye,
  Edit3,
  Sparkles,
} from 'lucide-react';
import { Language, CodeState, Member } from '@linkup/shared';
import { socket } from '../../lib/socket';
import { useAuth } from '../../context/AuthContext';

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
}

/**
 * US-CODE-01: View the Shared Editor
 * Acceptance Criteria:
 * 1. The Code tab shows a Monaco editor with a language selector (Python, JavaScript, C++, Java).
 * 2. All members who do not hold the pen see the editor in read-only mode with live updates (under 300 ms after debounce).
 * 3. The editor header shows who is currently editing (e.g., "Priya is editing").
 * 4. Joining the room late shows the current code content from the room:join snapshot.
 */
export const CodeTab: React.FC<CodeTabProps> = ({
  roomId,
  canCode = true,
  members = [],
  initialCodeState = null,
  onCodeStateChange,
}) => {
  const { user, fullName } = useAuth();

  const [content, setContent] = useState<string>(
    initialCodeState?.content ?? '# Shared Python Code Workspace\nprint("Hello, Linkup!")\n'
  );
  const [language, setLanguage] = useState<Language>(initialCodeState?.language ?? 'python');
  const [rev, setRev] = useState<number>(initialCodeState?.rev ?? 0);
  const [holderId, setHolderId] = useState<string | null>(initialCodeState?.holderId ?? null);

  const [output, setOutput] = useState<string | null>(null);
  const [running, setRunning] = useState<boolean>(false);

  const DEBOUNCE_MS = 150;
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

  // Determine if current user holds the pen
  const isPenHolder = useMemo(() => {
    if (!user?.id) return false;
    // If holderId is explicitly set, check match
    if (holderId) {
      return holderId === user.id;
    }
    // If holderId is not yet assigned, default to room host
    const myMember = members.find((m) => m.userId === user.id);
    return myMember?.memberRole === 'host';
  }, [holderId, members, user?.id]);

  const canEdit = Boolean(isPenHolder && canCode);
  const isReadOnly = !canEdit;

  // Acceptance Criterion 3: "The editor header shows who is currently editing (e.g., 'Priya is editing')"
  const editorDisplayName = useMemo(() => {
    if (holderId) {
      if (user?.id && holderId === user.id) {
        return fullName || 'You';
      }
      const member = members.find((m) => m.userId === holderId);
      if (member?.fullName) {
        return member.fullName;
      }
    }

    // Fallback: look for host in members
    const hostMember = members.find((m) => m.memberRole === 'host');
    if (hostMember?.fullName) {
      if (user?.id && hostMember.userId === user.id) {
        return fullName || 'You';
      }
      return hostMember.fullName;
    }

    return 'Teacher';
  }, [holderId, members, user, fullName]);

  // Real-time Socket.IO listeners: code:state, code:pen, room:joined
  useEffect(() => {
    const handleCodeState = (data: { roomId: string } & CodeState) => {
      if (data.roomId === roomId) {
        // If current user is currently actively editing and holds pen, don't overwrite own local keystrokes
        if (canEdit && data.holderId === user?.id) {
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
          content,
          language,
          rev,
          holderId: data.holderId,
        });
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

    socket.on('code:state', handleCodeState);
    socket.on('code:pen', handleCodePen);
    socket.on('room:joined', handleRoomJoined);

    return () => {
      socket.off('code:state', handleCodeState);
      socket.off('code:pen', handleCodePen);
      socket.off('room:joined', handleRoomJoined);
    };
  }, [roomId, canEdit, user?.id, content, language, rev, onCodeStateChange]);

  // Debounced code changes (150 ms debounce per US-CODE-03 & FR-5.2)
  const handleEditorChange = (newVal: string | undefined) => {
    const value = newVal ?? '';
    setContent(value);

    if (!canEdit) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      socket.emit(
        'code:update',
        {
          roomId,
          content: value,
          language,
        },
        (ack: any) => {
          if (ack?.ok && ack?.data?.rev) {
            setRev(ack.data.rev);
            onCodeStateChange?.({
              content: value,
              language,
              rev: ack.data.rev,
              holderId,
            });
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
        content,
        language: newLang,
      },
      (ack: any) => {
        if (ack?.ok && ack?.data?.rev) {
          setRev(ack.data.rev);
          onCodeStateChange?.({
            content,
            language: newLang,
            rev: ack.data.rev,
            holderId,
          });
        }
      }
    );
  };

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleRun = async () => {
    if (!canCode) return;
    setRunning(true);
    setOutput(null);
    // Real execution via Piston API in US-CODE-05
    await new Promise((r) => setTimeout(r, 600));
    setOutput(`[Output - ${language}]\nProgram execution started...\nHello, Linkup!\n[Process finished with exit code 0]`);
    setRunning(false);
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

        {/* Live sync pulse badge */}
        <div className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] text-slate-500 dark:text-slate-400 font-medium select-none">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="hidden sm:inline">Live Sync (rev {rev})</span>
        </div>

        <div className="flex-1" />

        {/* Run Button */}
        <button
          id="room-code-run"
          onClick={handleRun}
          disabled={running || !canCode}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 active:scale-95"
        >
          <Play className="w-3.5 h-3.5" />
          {running ? 'Running…' : 'Run'}
        </button>
      </div>

      {/* Editor Area with Monaco */}
      <div className="flex flex-col flex-1 gap-3 min-h-0">
        <div
          id="room-code-editor"
          data-testid="room-code-editor"
          className="flex-1 w-full min-h-[340px] h-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-950 shadow-inner relative flex flex-col"
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

        {/* Output Panel */}
        {output !== null && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-black/90 p-3 font-mono text-xs text-emerald-400 whitespace-pre-wrap max-h-36 overflow-y-auto shadow-inner">
            <span className="text-slate-500 select-none">$ output &gt; </span>
            {output}
          </div>
        )}
      </div>
    </div>
  );
};
