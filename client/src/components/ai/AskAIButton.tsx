import React from 'react';
import { Sparkles } from 'lucide-react';
import { useAiAssistant } from '../../context/AiAssistantContext';

export const AskAIButton: React.FC = () => {
  const { toggleDrawer, isOpen } = useAiAssistant();

  // If the drawer is already open, do not render the floating button so it doesn't obstruct
  // the drawer's input controls or send button at the bottom right.
  if (isOpen) {
    return null;
  }

  return (
    <button
      id="floating-ask-ai-btn"
      data-testid="floating-ask-ai-btn"
      type="button"
      onClick={toggleDrawer}
      aria-label="Ask AI Assistant"
      title="Ask AI Assistant"
      className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-50 flex items-center justify-center gap-2 p-3 sm:px-4 sm:py-3 rounded-full bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-600 active:from-indigo-700 active:to-indigo-600 text-white shadow-lg shadow-indigo-500/30 dark:shadow-indigo-950/60 border border-indigo-400/30 transition-transform duration-200 hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900 cursor-pointer group"
    >
      <Sparkles className="w-5 h-5 text-indigo-100 group-hover:rotate-12 transition-transform duration-300 animate-pulse" />
      <span className="hidden sm:inline text-xs sm:text-sm font-semibold tracking-wide select-none">
        Ask AI
      </span>
    </button>
  );
};

