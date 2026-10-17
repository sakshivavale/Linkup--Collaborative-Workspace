import React, { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Editor, { OnMount } from '@monaco-editor/react';
import {
  Code2,
  ArrowLeft,
  Play,
  RotateCcw,
  Loader2,
  Terminal,
  AlertTriangle,
  ChevronDown,
  Sparkles,
  Trash2,
  Shield,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { Language, RunResult } from '@linkup/shared';
import { api } from '../../lib/api';

export interface PlaygroundLanguageOption {
  id: Language;
  label: string;
  monacoLang: string;
  starterSnippet: string;
}

export const PLAYGROUND_LANGUAGES: PlaygroundLanguageOption[] = [
  {
    id: 'python',
    label: 'Python 3',
    monacoLang: 'python',
    starterSnippet: `# Python Personal Playground (US-CODE-07)
def greet(name: str) -> str:
    return f"Hello, {name}! Welcome to your personal playground."

print(greet("Developer"))
`,
  },
  {
    id: 'javascript',
    label: 'JavaScript (Node.js)',
    monacoLang: 'javascript',
    starterSnippet: `// JavaScript Personal Playground (US-CODE-07)
function greet(name) {
  return \`Hello, \${name}! Welcome to your personal playground.\`;
}

console.log(greet("Developer"));
`,
  },
  {
    id: 'cpp',
    label: 'C++ (GCC)',
    monacoLang: 'cpp',
    starterSnippet: `// C++ Personal Playground (US-CODE-07)
#include <iostream>
#include <string>

int main() {
    std::string name = "Developer";
    std::cout << "Hello, " << name << "! Welcome to your personal playground." << std::endl;
    return 0;
}
`,
  },
  {
    id: 'java',
    label: 'Java (OpenJDK)',
    monacoLang: 'java',
    starterSnippet: `// Java Personal Playground (US-CODE-07)
public class Main {
    public static void main(String[] args) {
        String name = "Developer";
        System.out.println("Hello, " + name + "! Welcome to your personal playground.");
    }
}
`,
  },
];

/**
 * US-CODE-07: Personal Playground (P1)
 * Module: Code Workspace
 * Traces to: FR-5.8
 *
 * Acceptance Criteria:
 * 1. A /playground route shows a Monaco editor, language selector, stdin box, Run button, and output panel.
 * 2. Code runs via POST /execute without a roomId; output is shown only to the user.
 * 3. No code or output is shared to any room.
 * 4. Same rate limits apply (10 runs/minute).
 */
export const PlaygroundPage: React.FC = () => {
  const [language, setLanguage] = useState<Language>('python');
  
  // Per-language code snippets state so switching languages preserves draft code
  const [snippets, setSnippets] = useState<Record<Language, string>>(() => ({
    python: PLAYGROUND_LANGUAGES.find((l) => l.id === 'python')!.starterSnippet,
    javascript: PLAYGROUND_LANGUAGES.find((l) => l.id === 'javascript')!.starterSnippet,
    cpp: PLAYGROUND_LANGUAGES.find((l) => l.id === 'cpp')!.starterSnippet,
    java: PLAYGROUND_LANGUAGES.find((l) => l.id === 'java')!.starterSnippet,
  }));

  const [stdin, setStdin] = useState<string>('');
  const [running, setRunning] = useState<boolean>(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const currentCode = snippets[language] || '';

  const currentLangConfig = useMemo(() => {
    return PLAYGROUND_LANGUAGES.find((l) => l.id === language) || PLAYGROUND_LANGUAGES[0];
  }, [language]);

  const handleCodeChange = (value: string | undefined) => {
    const updated = value ?? '';
    setSnippets((prev) => ({
      ...prev,
      [language]: updated,
    }));
  };

  const handleLanguageChange = (newLang: Language) => {
    setLanguage(newLang);
    setRunError(null);
  };

  const handleResetSnippet = () => {
    const starter = currentLangConfig.starterSnippet;
    setSnippets((prev) => ({
      ...prev,
      [language]: starter,
    }));
  };

  const handleClearOutput = () => {
    setRunResult(null);
    setRunError(null);
  };

  // AC 2: Code runs via POST /execute without a roomId; output is shown only to the user.
  // AC 3: No code or output is shared to any room.
  // AC 4: Same rate limits apply (10 runs/minute).
  const handleRun = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setRunError(null);

    try {
      // POST /execute without roomId
      const res = await api.post<RunResult>('/execute', {
        language,
        code: currentCode,
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
  }, [running, language, currentCode, stdin]);

  // Bind Ctrl+Enter / Cmd+Enter hotkey to run
  const handleEditorMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleRun();
    });
  };

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
      {/* Top Header & Breadcrumbs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link
            to="/"
            id="playground-back-button"
            data-testid="playground-back-button"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Dashboard</span>
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-500/20">
                <Code2 className="w-5 h-5" />
              </span>
              <span>Personal Playground</span>
            </h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
              <Shield className="w-3 h-3" />
              <span>Private Sandbox</span>
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Write and execute code privately. Your code, inputs, and execution output are never shared to any room.
          </p>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Language Selector */}
          <div className="relative">
            <select
              id="playground-language-select"
              data-testid="playground-language-select"
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value as Language)}
              className="appearance-none pl-3 pr-8 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm cursor-pointer transition-all"
            >
              {PLAYGROUND_LANGUAGES.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
          </div>

          {/* Reset Starter Snippet */}
          <button
            id="playground-reset-button"
            data-testid="playground-reset-button"
            type="button"
            onClick={handleResetSnippet}
            title="Reset to starter snippet"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>

          {/* Run Button */}
          <button
            id="playground-run-button"
            data-testid="playground-run-button"
            type="button"
            onClick={handleRun}
            disabled={running}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-indigo-600/20 focus:outline-none focus:ring-2 focus:ring-indigo-500 active:scale-95 cursor-pointer"
          >
            {running ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            <span>{running ? 'Running…' : 'Run Code'}</span>
            <span className="hidden md:inline text-[10px] text-indigo-200 font-normal opacity-80">(Ctrl+↵)</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-[580px] flex-1">
        {/* Editor Column (7 cols on large screens) */}
        <div className="lg:col-span-7 flex flex-col gap-3 min-h-[380px]">
          <div
            id="playground-editor-wrapper"
            data-testid="playground-editor-wrapper"
            className="flex-1 w-full min-h-[420px] rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-950 shadow-inner relative flex flex-col"
          >
            {/* Editor Sub-Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800/80 bg-slate-900/60 text-xs">
              <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
                <span className="ml-1 text-slate-300 font-semibold">{currentLangConfig.label}</span>
              </div>
              <span className="text-[10px] text-slate-500">Monaco Editor &bull; Private Buffer</span>
            </div>

            {/* Monaco Editor Component */}
            <Editor
              height="100%"
              language={currentLangConfig.monacoLang}
              value={currentCode}
              theme="vs-dark"
              onChange={handleCodeChange}
              onMount={handleEditorMount}
              options={{
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
                renderLineHighlight: 'line',
              }}
              loading={
                <div className="flex items-center justify-center h-full text-slate-400 gap-2 text-xs">
                  <Sparkles className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Loading Monaco Editor...</span>
                </div>
              }
            />

            {/* Synchronized accessible textarea for headless inspection & tests */}
            <textarea
              id="playground-code-editor-sync"
              data-testid="playground-code-editor-sync"
              value={currentCode}
              readOnly
              aria-hidden="true"
              tabIndex={-1}
              className="sr-only"
            />
          </div>

          {/* Stdin Box */}
          <div
            id="playground-stdin-container"
            data-testid="playground-stdin-container"
            className="glass-panel rounded-2xl p-3 border border-slate-200 dark:border-slate-800 flex flex-col gap-1.5"
          >
            <div className="flex items-center justify-between">
              <label
                htmlFor="playground-stdin"
                className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5"
              >
                <Terminal className="w-3.5 h-3.5 text-indigo-500" />
                <span>Standard Input (stdin)</span>
                <span className="text-[10px] text-slate-400 font-normal lowercase">(optional)</span>
              </label>
              {stdin && (
                <button
                  type="button"
                  onClick={() => setStdin('')}
                  className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                >
                  Clear input
                </button>
              )}
            </div>
            <textarea
              id="playground-stdin"
              data-testid="playground-stdin"
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              placeholder="Enter input to pass to the program via stdin..."
              rows={2}
              disabled={running}
              className="w-full px-3 py-2 text-xs font-mono rounded-xl bg-slate-900/90 border border-slate-200 dark:border-slate-800 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none shadow-inner"
            />
          </div>
        </div>

        {/* Output Column (5 cols on large screens) */}
        <div className="lg:col-span-5 flex flex-col min-h-[380px]">
          <div
            id="playground-output-panel"
            data-testid="playground-output-panel"
            className="flex-1 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950 p-4 font-mono text-xs shadow-inner flex flex-col gap-3 min-h-[380px]"
          >
            {/* Output Panel Header */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Execution Output
                </span>
              </div>

              <div className="flex items-center gap-2">
                {running && (
                  <div
                    id="playground-output-spinner"
                    data-testid="playground-output-spinner"
                    className="inline-flex items-center gap-1.5 text-indigo-400 text-xs font-semibold animate-pulse"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    <span>Executing...</span>
                  </div>
                )}

                {!running && runResult && (
                  <div
                    id="playground-output-meta"
                    data-testid="playground-output-meta"
                    className="flex items-center gap-2 text-[11px]"
                  >
                    <span
                      id="playground-output-exit-code"
                      data-testid="playground-output-exit-code"
                      className={`px-2 py-0.5 rounded-md font-semibold ${
                        runResult.exitCode === 0
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}
                    >
                      Exit: {runResult.exitCode ?? 'N/A'}
                    </span>
                    <span
                      id="playground-output-time"
                      data-testid="playground-output-time"
                      className="text-slate-400 font-medium px-1.5 py-0.5 rounded-md bg-slate-800/50 flex items-center gap-1"
                    >
                      <Clock className="w-3 h-3 text-slate-500" />
                      <span>{runResult.timeMs} ms</span>
                    </span>
                    {runResult.truncated && (
                      <span
                        id="playground-output-truncated"
                        data-testid="playground-output-truncated"
                        className="text-amber-400 text-[10px] px-1 py-0.5 rounded bg-amber-500/10 border border-amber-500/20"
                      >
                        truncated
                      </span>
                    )}
                  </div>
                )}

                {(runResult || runError) && (
                  <button
                    type="button"
                    onClick={handleClearOutput}
                    title="Clear console output"
                    className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Output Panel Body */}
            <div className="flex-1 overflow-y-auto space-y-2.5 max-h-[500px]">
              {/* Timeout banner */}
              {(runResult?.timedOut || runResult?.stderr?.includes('Time limit exceeded (3 s).')) && (
                <div
                  id="playground-output-timeout"
                  data-testid="playground-output-timeout"
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Time limit exceeded (3 s).</span>
                </div>
              )}

              {/* Error banner (e.g. 429 RATE_LIMITED, 413, 502) */}
              {runError && (
                <div
                  id="playground-output-error"
                  data-testid="playground-output-error"
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold"
                >
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{runError}</span>
                </div>
              )}

              {/* Stdout display */}
              {runResult?.stdout && (
                <div
                  id="playground-output-stdout"
                  data-testid="playground-output-stdout"
                  className="text-emerald-400 whitespace-pre-wrap leading-relaxed font-mono"
                >
                  {runResult.stdout}
                </div>
              )}

              {/* Stderr display */}
              {runResult?.stderr && (
                <div
                  id="playground-output-stderr"
                  data-testid="playground-output-stderr"
                  className="text-rose-400 bg-rose-950/30 p-2.5 rounded-xl border border-rose-900/40 whitespace-pre-wrap leading-relaxed font-mono"
                >
                  {runResult.stderr}
                </div>
              )}

              {/* Idle state */}
              {!running && !runResult && !runError && (
                <div className="text-slate-500 italic text-xs py-4 flex flex-col items-center justify-center h-full gap-2 text-center">
                  <Terminal className="w-8 h-8 text-slate-700 stroke-1" />
                  <p>Click &quot;Run Code&quot; or press Ctrl+↵ to execute your code snippet.</p>
                  <p className="text-[11px] text-slate-600">
                    Execution output will appear here privately.
                  </p>
                </div>
              )}
            </div>

            {/* Footer Status */}
            <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span>Isolated sandbox</span>
              </span>
              <span>Rate limit: 10 runs/min</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};

export default PlaygroundPage;
