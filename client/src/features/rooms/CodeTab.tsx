import React from 'react';
import { Code2, Play, ChevronDown } from 'lucide-react';

interface CodeTabProps {
  roomId: string;
}

const LANGUAGES = ['Python', 'JavaScript', 'C++', 'Java'] as const;
type Lang = typeof LANGUAGES[number];

/**
 * CodeTab — collaborative code editor placeholder.
 * Monaco editor + Piston execution will be integrated in a future story.
 */
export const CodeTab: React.FC<CodeTabProps> = () => {
  const [lang, setLang] = React.useState<Lang>('Python');
  const [code, setCode] = React.useState(
    lang === 'Python'
      ? '# Collaborative code editor\n# Real-time sync coming in a future sprint\n\nprint("Hello, Linkup!")\n'
      : '// Collaborative code editor\nconsole.log("Hello, Linkup!");\n'
  );
  const [output, setOutput] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);

  const handleRun = async () => {
    setRunning(true);
    setOutput(null);
    // Placeholder — real execution via Piston API in future story
    await new Promise(r => setTimeout(r, 800));
    setOutput('Hello, Linkup!\n[Execution via Piston API — coming soon]');
    setRunning(false);
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap px-1">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 text-purple-700 dark:text-purple-400 text-xs font-semibold">
          <Code2 className="w-3.5 h-3.5" />
          <span>Code Editor</span>
        </div>

        {/* Language selector */}
        <div className="relative">
          <select
            id="room-code-language"
            value={lang}
            onChange={e => setLang(e.target.value as Lang)}
            className="appearance-none pl-3 pr-8 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            {LANGUAGES.map(l => <option key={l}>{l}</option>)}
          </select>
          <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
        </div>

        <div className="flex-1" />

        <button
          id="room-code-run"
          onClick={handleRun}
          disabled={running}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <Play className="w-3.5 h-3.5" />
          {running ? 'Running…' : 'Run'}
        </button>
      </div>

      {/* Editor area */}
      <div className="flex flex-col flex-1 gap-3 min-h-0">
        <textarea
          id="room-code-editor"
          value={code}
          onChange={e => setCode(e.target.value)}
          spellCheck={false}
          className="flex-1 w-full resize-none rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-emerald-300 font-mono text-sm p-4 leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[240px] shadow-inner"
          placeholder="// Start coding..."
        />

        {/* Output panel */}
        {output !== null && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-black/80 p-3 font-mono text-xs text-green-400 whitespace-pre-wrap max-h-36 overflow-y-auto">
            <span className="text-slate-500 select-none">$ output &gt; </span>
            {output}
          </div>
        )}
      </div>
    </div>
  );
};
