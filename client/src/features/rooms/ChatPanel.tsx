import React, { useEffect, useRef, useState } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface Message {
  id: number;
  senderName: string;
  body: string;
  createdAt: string;
  isOwn: boolean;
}

interface ChatPanelProps {
  roomId: string;
  disabled?: boolean;
}

/**
 * ChatPanel — sidebar chat for the room.
 * Real-time sync via Socket.IO events will be wired in a future story.
 */
export const ChatPanel: React.FC<ChatPanelProps> = ({ roomId, disabled = false }) => {
  const { fullName } = useAuth();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      senderName: 'System',
      body: `Welcome to room chat! Real-time messaging via Socket.IO is coming soon.`,
      createdAt: new Date().toISOString(),
      isOwn: false,
    },
  ]);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setMessages(prev => [
      ...prev,
      {
        id: Date.now(),
        senderName: fullName,
        body: trimmed,
        createdAt: new Date().toISOString(),
        isOwn: true,
      },
    ]);
    setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200/70 dark:border-slate-800/70 shrink-0">
        <MessageSquare className="w-4 h-4 text-indigo-500" />
        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
          Chat
        </span>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.map(msg => (
          <div key={msg.id} className={`flex flex-col gap-0.5 ${msg.isOwn ? 'items-end' : 'items-start'}`}>
            <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 px-1">
              {msg.isOwn ? 'You' : msg.senderName} · {formatTime(msg.createdAt)}
            </span>
            <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
              msg.isOwn
                ? 'bg-indigo-600 text-white rounded-br-sm'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-sm'
            }`}>
              {msg.body}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 px-3 py-3 border-t border-slate-200/70 dark:border-slate-800/70">
        <div className="flex items-end gap-2">
          <textarea
            id={`room-chat-input-${roomId}`}
            data-testid="room-chat-input"
            value={draft}
            disabled={disabled}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'Reconnecting... chat is temporarily disabled' : 'Type a message…'}
            rows={1}
            className={`flex-1 resize-none rounded-xl px-3 py-2 text-xs glass-input focus:outline-none focus:ring-2 focus:ring-indigo-500 max-h-24 leading-relaxed ${
              disabled ? 'opacity-50 cursor-not-allowed bg-slate-100 dark:bg-slate-800/40 select-none' : ''
            }`}
          />
          <button
            id={`room-chat-send-${roomId}`}
            data-testid="room-chat-send"
            onClick={sendMessage}
            disabled={disabled || !draft.trim()}
            title={disabled ? 'Reconnecting...' : 'Send message'}
            className="w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-all shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1.5 text-center">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
};
