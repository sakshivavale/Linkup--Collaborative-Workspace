import React from 'react';
import { Link } from 'react-router-dom';
import { 
  Code2, 
  ArrowLeft, 
  Play, 
  Terminal, 
  Sparkles, 
  ShieldCheck,
  FileCode
} from 'lucide-react';

export const PlaygroundPage: React.FC = () => {
  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
      {/* Navigation breadcrumb */}
      <div className="mb-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Dashboard</span>
        </Link>
      </div>

      {/* Playground Header Banner */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 mb-8 relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-400 text-xs font-medium mb-3">
            <Code2 className="w-3.5 h-3.5" />
            <span>Personal Playground &bull; US-CODE-07</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Personal Playground
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Your private coding sandbox. Write, test, and execute snippets in Python, JavaScript, TypeScript, C++, and Java without sharing your screen or session.
          </p>
        </div>

        <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10 dark:opacity-10 pointer-events-none flex items-center justify-center">
          <FileCode className="w-64 h-64 text-indigo-600 dark:text-indigo-400" />
        </div>
      </div>

      {/* Playground Mock Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Editor Area Mock */}
        <div className="lg:col-span-2 glass-panel rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-rose-500 inline-block" />
              <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />
              <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
              <span className="ml-2 text-xs font-mono text-slate-600 dark:text-slate-300">main.py</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600/70 cursor-not-allowed"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run</span>
              </button>
            </div>
          </div>
          <div className="p-6 font-mono text-xs sm:text-sm text-slate-700 dark:text-slate-300 bg-slate-900/5 dark:bg-black/30 min-h-[220px] flex flex-col justify-between">
            <pre className="text-slate-600 dark:text-slate-400">
              <code>{`# LinkUp Personal Playground (FR-5.8)
def greet(name: str) -> str:
    return f"Hello, {name}! Welcome to LinkUp Playground."

print(greet("Collaborator"))`}</code>
            </pre>
            <div className="text-xs text-slate-400 flex items-center gap-2 mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              <span>Full Monaco editor & Piston execution engine integrated in US-CODE-07.</span>
            </div>
          </div>
        </div>

        {/* Terminal / Output Area Mock */}
        <div className="glass-panel rounded-2xl p-5 flex flex-col justify-between border border-slate-200 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 mb-3 uppercase tracking-wider">
              <Terminal className="w-4 h-4 text-indigo-500" />
              <span>Output Console</span>
            </div>
            <div className="rounded-xl p-4 bg-slate-900 text-emerald-400 font-mono text-xs min-h-[140px]">
              <div>$ python main.py</div>
              <div className="text-slate-300 mt-2">Hello, Collaborator! Welcome to LinkUp Playground.</div>
              <div className="text-slate-500 mt-2">[Program exited with code 0]</div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Protected Route Verified (FR-1.4)</span>
          </div>
        </div>
      </div>
    </main>
  );
};

export default PlaygroundPage;
