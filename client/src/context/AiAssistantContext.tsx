import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AiChatMessage, AiChatRequest, AiChatResponse } from '@linkup/shared';
import { api, HttpError } from '../lib/api';

interface AiAssistantContextType {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  toggleDrawer: () => void;
  messages: AiChatMessage[];
  sendMessage: (prompt: string, codeContext?: string) => Promise<void>;
  clearHistory: () => void;
  isLoading: boolean;
  error: string | null;
  activeCodeSnippet: string | null;
  setActiveCodeSnippet: (code: string | null) => void;
}

const AiAssistantContext = createContext<AiAssistantContextType | undefined>(undefined);

export const AiAssistantProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AiChatMessage[]>(() => [
    {
      id: 'welcome-msg',
      role: 'assistant',
      content:
        "👋 Hello! I'm **LinkUp AI**, your intelligent classroom co-pilot.\n\nNeed help debugging code, explaining algorithms, or understanding concepts? Ask a question or attach your current code snippet from the editor!",
      timestamp: new Date().toISOString(),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCodeSnippet, setActiveCodeSnippet] = useState<string | null>(null);

  const toggleDrawer = useCallback(() => setIsOpen((prev) => !prev), []);

  const clearHistory = useCallback(() => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: 'assistant',
        content: 'Chat history cleared. How can I help you today?',
        timestamp: new Date().toISOString(),
      },
    ]);
    setError(null);
  }, []);

  const sendMessage = useCallback(
    async (prompt: string, codeContext?: string) => {
      if (!prompt.trim() || isLoading) return;

      const userMsgId = `user-${Date.now()}`;
      const userMessage: AiChatMessage = {
        id: userMsgId,
        role: 'user',
        content: prompt.trim(),
        codeContext: codeContext || undefined,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);

      try {
        const historyPayload = messages
          .filter((m) => m.id !== 'welcome-msg')
          .slice(-6)
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));

        const payload: AiChatRequest = {
          prompt: userMessage.content,
          codeContext: userMessage.codeContext,
          history: historyPayload,
        };

        const res = await api.post<AiChatResponse>('/api/ai/chat', payload);

        const assistantMessage: AiChatMessage = {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: res?.response || 'I could not generate a response. Please try again.',
          timestamp: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err: any) {
        let displayError = 'Failed to get a response from the AI assistant.';
        if (err instanceof HttpError) {
          displayError = err.message || displayError;
        } else if (err?.message) {
          displayError = err.message;
        }
        setError(displayError);

        const errorBubble: AiChatMessage = {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ **Error**: ${displayError}`,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorBubble]);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading]
  );

  return (
    <AiAssistantContext.Provider
      value={{
        isOpen,
        setIsOpen,
        toggleDrawer,
        messages,
        sendMessage,
        clearHistory,
        isLoading,
        error,
        activeCodeSnippet,
        setActiveCodeSnippet,
      }}
    >
      {children}
    </AiAssistantContext.Provider>
  );
};

export const useAiAssistant = (): AiAssistantContextType => {
  const context = useContext(AiAssistantContext);
  if (!context) {
    throw new Error('useAiAssistant must be used within an AiAssistantProvider');
  }
  return context;
};
