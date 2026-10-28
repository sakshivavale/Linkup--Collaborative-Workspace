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
  CornerDownLeft,
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
      aria-label="LinkUp AI Assistant"
      className="fixed top-3 bottom-3 right-3 left-3 sm:left-auto sm:right-4 sm:top-4 sm:bottom-4 sm:w-[450px] z-50 rounded-3xl bg-white/90 dark:bg-[#0c1220]/85 backdrop-blur-xl border border-slate-200/80 dark:border-white/10 shadow-2xl shadow-indigo-950/20 dark:shadow-black/50 flex flex-col transition-all duration-300 ease-in-out overflow-hidden no-scrollbar ring-1 ring-black/5 dark:ring-white/5"
    >
      {/* ── 1. Drawer Header ── */}
      <header className="px-5 py-3.5 border-b border-slate-200/60 dark:border-white/10 flex items-center justify-between bg-white/60 dark:bg-slate-900/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 p-0.5 shadow-md shadow-indigo-500/25 flex items-center justify-center text-white ring-2 ring-indigo-400/20">
            <Sparkles className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                LinkUp AI
              </h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gradient-to-r from-indigo-500/10 via-purple-500/15 to-pink-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 shadow-xs uppercase tracking-wider">
                v2.0
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              Your intelligent classroom co-pilot
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            id="ai-drawer-clear-btn"
            onClick={clearHistory}
            className="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50/80 dark:hover:bg-rose-950/30 transition-all cursor-pointer"
            title="Clear Chat History"
            aria-label="Clear chat history"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            id="ai-drawer-close-btn"
            onClick={() => setIsOpen(false)}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 transition-all cursor-pointer"
            title="Close Drawer (Esc)"
            aria-label="Close AI Drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── 2. Conversation Message Feed ── */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 no-scrollbar">
        {messages.map((msg, index) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id || index}
              className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* Avatar Icon */}
              <div
                className={`w-7 h-7 shrink-0 rounded-xl flex items-center justify-center text-xs font-bold transition-transform ${
                  isUser
                    ? 'bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-sm shadow-indigo-500/30'
                    : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-800/50 shadow-sm'
                }`}
              >
                {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
              </div>

              {/* Message Bubble */}
              <div
                className={`max-w-[85%] px-4 py-3 text-xs leading-relaxed transition-all ${
                  isUser
                    ? 'rounded-2xl rounded-tr-sm bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/20'
                    : 'rounded-2xl rounded-tl-sm bg-slate-100/90 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/50 text-slate-800 dark:text-slate-100 backdrop-blur-xs shadow-sm'
                }`}
              >
                {/* Code Attachment Badge inside User Bubble */}
                {isUser && msg.codeContext && (
                  <div className="mb-2 pb-2 border-b border-white/20 text-[10px] text-indigo-100 flex items-center gap-1.5 font-medium">
                    <Code2 className="w-3 h-3 text-indigo-200" />
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
                          <div className="relative group my-2 rounded-xl overflow-hidden border border-slate-700/50 bg-slate-950/90 font-mono text-[11px] shadow-sm">
                            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 text-[10px] text-slate-400">
                              <span className="font-semibold text-slate-300">{match ? match[1] : 'code'}</span>
                              <button
                                type="button"
                                onClick={() => handleCopyCode(codeString, codeId)}
                                className="flex items-center gap-1 text-slate-400 hover:text-white px-2 py-0.5 rounded-md hover:bg-slate-800 transition-colors cursor-pointer"
                                title="Copy code"
                              >
                                {copiedId === codeId ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-400" />
                                    <span className="text-emerald-400 font-medium">Copied</span>
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
                            className={`px-1.5 py-0.5 rounded-md text-[11px] font-mono ${
                              isUser
                                ? 'bg-black/20 text-white'
                                : 'bg-slate-200/80 dark:bg-slate-700/60 text-indigo-600 dark:text-indigo-400'
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
                  className={`mt-1.5 text-[9px] text-right font-medium ${
                    isUser ? 'text-indigo-100/70' : 'text-slate-400 dark:text-slate-500'
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
            <div className="w-7 h-7 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-500 border border-indigo-200/60 dark:border-indigo-800/50 shadow-sm">
              <Bot className="w-3.5 h-3.5 animate-bounce" />
            </div>
            <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-slate-100/90 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/50 flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400 shadow-sm">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
              <span>Thinking & formulating guidance…</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── 3. Quick Action Chips ── */}
      <div className="px-4 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => {
              setInputPrompt(prompt);
              textareaRef.current?.focus();
            }}
            className="shrink-0 text-[11px] font-medium px-3.5 py-1.5 rounded-full bg-white/80 dark:bg-slate-800/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200/80 dark:border-white/10 hover:border-indigo-400/50 dark:hover:border-indigo-500/50 hover:shadow-[0_0_12px_rgba(99,102,241,0.25)] active:scale-95 transition-all duration-200 cursor-pointer"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* ── 4. Floating Capsule Input Bar ── */}
      <footer className="p-3 sm:p-4 bg-transparent">
        <div className="relative rounded-2xl sm:rounded-3xl border border-slate-200/80 dark:border-white/10 bg-white/90 dark:bg-slate-900/80 backdrop-blur-md p-2.5 sm:p-3 shadow-lg focus-within:border-indigo-500/70 focus-within:ring-2 focus-within:ring-indigo-500/30 focus-within:shadow-[0_0_20px_rgba(99,102,241,0.25)] transition-all duration-200 flex flex-col gap-2">
          {/* Embedded Code Attachment Chip */}
          {activeCodeSnippet && (
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-200/60 dark:border-white/5 text-[11px]">
              <button
                type="button"
                onClick={() => setIncludeCode((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium transition-all cursor-pointer ${
                  includeCode
                    ? 'bg-indigo-500/15 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30 shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800/60 text-slate-400 border border-slate-200 dark:border-slate-700/60 hover:text-slate-600 dark:hover:text-slate-300'
                }`}
                title={includeCode ? 'Code snippet attached to next prompt' : 'Code snippet excluded'}
              >
                <Code2 className={`w-3.5 h-3.5 ${includeCode ? 'text-indigo-500' : 'text-slate-400'}`} />
                <span className="font-mono text-[10.5px]">Monaco Context ({activeCodeSnippet.split('\n').length} lines)</span>
                {includeCode ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ring-2 ring-emerald-400/30 ml-0.5" />
                ) : (
                  <span className="text-[10px] text-slate-400">(disabled)</span>
                )}
              </button>

              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                {includeCode ? 'Attached to prompt' : 'Click to attach'}
              </span>
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            rows={2}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder="Ask a coding question (Shift+Enter for new line)..."
            className="w-full bg-transparent text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none resize-none px-1.5 py-0.5 leading-relaxed"
          />

          {/* Actions inside capsule */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10.5px] text-slate-400 dark:text-slate-500 flex items-center gap-1 font-medium select-none">
              <CornerDownLeft className="w-3 h-3" />
              <span>Enter to send</span>
            </span>

            <button
              type="button"
              id="ai-drawer-send-btn"
              onClick={handleSend}
              disabled={!inputPrompt.trim() || isLoading}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-600 hover:from-indigo-600 hover:to-purple-700 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md shadow-indigo-500/25 cursor-pointer"
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
