import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Sparkles,
  X,
  Send,
  Trash2,
  Code2,
  Bot,
  User,
  Copy,
  Check,
  Loader2,
  HelpCircle,
} from 'lucide-react';
import { useAiAssistant } from '../../context/AiAssistantContext';

const QUICK_PROMPTS = [
  'Explain this code',
  'Find potential bugs',
  'How to optimize this?',
  'Add helpful comments',
];

export const AiDrawer: React.FC = () => {
  const {
    isOpen,
    setIsOpen,
    messages,
    sendMessage,
    clearHistory,
    isLoading,
    activeCodeSnippet,
  } = useAiAssistant();

  const [inputPrompt, setInputPrompt] = useState('');
  const [includeCode, setIncludeCode] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, isOpen]);

  // Focus textarea when opened
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => textareaRef.current?.focus(), 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setIsOpen]);

  const handleSend = async () => {
    if (!inputPrompt.trim() || isLoading) return;
    const promptToSend = inputPrompt;
    const codeContextToSend = includeCode && activeCodeSnippet ? activeCodeSnippet : undefined;

    setInputPrompt('');
    await sendMessage(promptToSend, codeContextToSend);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopyCode = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <aside
      id="linkup-ai-drawer"
      data-testid="linkup-ai-drawer"
      aria-label="AI Teaching Assistant Drawer"
      className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-white dark:bg-[#0d131f] border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col transition-all duration-300 ease-in-out no-scrollbar"
    >
      {/* ── 1. Drawer Header ── */}
      <header className="px-4 py-3 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900/50 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-0.5 shadow-md flex items-center justify-center text-white">
            <Sparkles className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
              <span>AI Teaching Assistant</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                Llama 3.3 / Gemini
              </span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Supportive Coding & Learning Companion</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            id="ai-drawer-clear-btn"
            onClick={clearHistory}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Clear Chat History"
            aria-label="Clear chat history"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            id="ai-drawer-close-btn"
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Close Drawer (Esc)"
            aria-label="Close AI Drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* ── 2. Active Code Context Banner ── */}
      {activeCodeSnippet && (
        <div className="px-4 py-2 bg-indigo-50/80 dark:bg-indigo-950/40 border-b border-indigo-100 dark:border-indigo-900/50 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 font-medium truncate">
            <Code2 className="w-4 h-4 shrink-0 text-indigo-500" />
            <span className="truncate">Attached Monaco Code ({activeCodeSnippet.split('\n').length} lines)</span>
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-600 dark:text-slate-300 select-none">
            <input
              type="checkbox"
              checked={includeCode}
              onChange={(e) => setIncludeCode(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
            />
            <span>Include</span>
          </label>
        </div>
      )}

      {/* ── 3. Conversation Message Feed ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
        {messages.map((msg, index) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id || index}
              className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* Avatar Icon */}
              <div
                className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                  isUser
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              {/* Message Bubble */}
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm ${
                  isUser
                    ? 'bg-indigo-600 text-white rounded-tr-none'
                    : 'bg-slate-100/90 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-800 dark:text-slate-100 rounded-tl-none'
                }`}
              >
                {/* Code Attachment Badge inside User Bubble */}
                {isUser && msg.codeContext && (
                  <div className="mb-2 pb-2 border-b border-indigo-400/40 text-[10px] text-indigo-100 flex items-center gap-1">
                    <Code2 className="w-3 h-3" />
                    <span>Included active workspace code</span>
                  </div>
                )}

                {/* Markdown Formatted Body */}
                <div className={`prose prose-xs dark:prose-invert max-w-none ${isUser ? 'text-white' : ''}`}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ node, inline, className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || '');
                        const codeString = String(children).replace(/\n$/, '');
                        const codeId = `code-${Math.random()}`;

                        return !inline ? (
                          <div className="relative group my-2 rounded-lg overflow-hidden border border-slate-700/60 bg-slate-950 font-mono text-[11px]">
                            <div className="flex items-center justify-between px-3 py-1 bg-slate-900 text-[10px] text-slate-400">
                              <span>{match ? match[1] : 'code'}</span>
                              <button
                                type="button"
                                onClick={() => handleCopyCode(codeString, codeId)}
                                className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer"
                                title="Copy code"
                              >
                                {copiedId === codeId ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-400" />
                                    <span className="text-emerald-400">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <pre className="p-3 overflow-x-auto text-emerald-300 no-scrollbar">
                              <code>{children}</code>
                            </pre>
                          </div>
                        ) : (
                          <code
                            className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${
                              isUser
                                ? 'bg-indigo-700/60 text-white'
                                : 'bg-slate-200 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400'
                            }`}
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>

                <div
                  className={`mt-1.5 text-[9px] text-right font-medium opacity-70 ${
                    isUser ? 'text-indigo-100' : 'text-slate-400'
                  }`}
                >
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          );
        })}

        {/* Loading Spinner Bubble */}
        {isLoading && (
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-indigo-500 border border-slate-200 dark:border-slate-700">
              <Bot className="w-4 h-4 animate-bounce" />
            </div>
            <div className="rounded-2xl rounded-tl-none px-4 py-3 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
              <span>Thinking & formulating guidance…</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── 4. Quick Action Prompts ── */}
      <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/30 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => {
              setInputPrompt(prompt);
              textareaRef.current?.focus();
            }}
            className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 dark:hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all shadow-xs cursor-pointer"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* ── 5. Input Controls ── */}
      <footer className="p-3.5 border-t border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-[#0d131f]">
        <div className="relative rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all p-2 flex flex-col gap-2">
          <textarea
            ref={textareaRef}
            rows={2}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder="Ask a coding question (Shift+Enter for new line)..."
            className="w-full bg-transparent text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none resize-none px-1"
          />

          <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <HelpCircle className="w-3 h-3" />
              <span>Enter to send</span>
            </span>

            <button
              type="button"
              id="ai-drawer-send-btn"
              onClick={handleSend}
              disabled={!inputPrompt.trim() || isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-indigo-500/20 cursor-pointer"
              aria-label="Send message"
            >
              {isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  <span>Send</span>
                  <Send className="w-3 h-3" />
                </>
              )}
            </button>
          </div>
        </div>
      </footer>
    </aside>
  );
};

