import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Send, MessageSquare, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { socket } from '../../lib/socket';
import { ChatMessage, ChatHistoryResponse } from '@linkup/shared';

interface ChatPanelProps {
  roomId: string;
  disabled?: boolean;
}

/**
 * ChatPanel — sidebar chat for the room (US-CHAT-01, US-CHAT-02, US-CHAT-03, FR-3.12).
 * Acceptance Criteria for US-CHAT-02:
 * 1. Opening the room loads the last 50 messages (newest at the bottom).
 * 2. Scrolling to the top loads the next 50 older messages (cursor pagination via `before` query param).
 * 3. A "Loading..." indicator is shown during fetch.
 * 4. A "No more messages" indicator is shown when hasMore = false.
 */
/**
 * US-CHAT-04: Plain Text Rendering and Link Auto-linking (FR-3.14)
 * - Auto-links URLs starting with http:// or https:// with target="_blank" and rel="noopener noreferrer"
 * - All other text rendered as plain text via React escaping (markup execution prohibited)
 */
export function renderMessageBody(text: string, isOwn: boolean = false): React.ReactNode {
  if (!text) return null;

  // Match URLs starting with http:// or https://, excluding trailing punctuation
  const urlRegex = /(https?:\/\/[^\s]+(?<![.,?!:;)]))/g;
  const parts = text.split(urlRegex).filter(Boolean);

  return parts.map((part, index) => {
    if (/^https?:\/\/[^\s]+$/.test(part)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="chat-message-link"
          className={`underline break-all font-medium hover:underline ${
            isOwn
              ? 'text-white underline decoration-white/70 hover:opacity-90'
              : 'text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300'
          }`}
        >
          {part}
        </a>
      );
    }

    return part;
  });
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ roomId, disabled = false }) => {
  const { user, fullName, role } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isInitialScrollDoneRef = useRef(false);

  // 1. Initial Load: Fetch last 50 messages when opening room (AC-1, AC-3)
  useEffect(() => {
    let isMounted = true;
    setLoadingInitial(true);
    setMessages([]);
    setHasMore(false);
    isInitialScrollDoneRef.current = false;

    const fetchInitialMessages = async () => {
      try {
        const data = await api.get<ChatHistoryResponse>(`/api/rooms/${roomId}/messages?limit=50`);
        if (!isMounted) return;

        setMessages(Array.isArray(data?.messages) ? data.messages.filter((m): m is ChatMessage => Boolean(m && m.id != null)) : []);
        setHasMore(Boolean(data?.hasMore));
      } catch (err) {
        console.warn('[ChatPanel] Failed to fetch initial chat messages:', err);
      } finally {
        if (isMounted) {
          setLoadingInitial(false);
          // Scroll to bottom (newest at bottom)
          requestAnimationFrame(() => {
            if (bottomRef.current) {
              bottomRef.current.scrollIntoView({ behavior: 'auto' });
              isInitialScrollDoneRef.current = true;
            }
          });
        }
      }
    };

    fetchInitialMessages();

    return () => {
      isMounted = false;
    };
  }, [roomId]);

  // 2. Real-time message listener via Socket.IO
  useEffect(() => {
    const handleNewMessage = (payload: any) => {
      const msg: ChatMessage = payload?.message || payload;
      if (!msg || String(msg.roomId) !== String(roomId)) return;

      const incomingClientId = payload?.clientId || msg.clientId;

      setMessages((prev) => {
        // Prevent duplicate if already confirmed
        if (prev.some((m) => m && m.id === msg.id)) return prev;

        // Replace optimistic message if matching clientId or pending temp message
        const optIndex = prev.findIndex(
          (m) =>
            m &&
            ((incomingClientId && m.clientId === incomingClientId) ||
              (m.id < 0 && m.senderId === msg.senderId && m.body === msg.body))
        );

        if (optIndex !== -1) {
          const next = [...prev];
          next[optIndex] = { ...msg, status: 'confirmed' };
          return next;
        }

        return [...prev, msg];
      });

      // Auto-scroll if user is near bottom
      const el = containerRef.current;
      if (el) {
        const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        if (isNearBottom || msg.senderId === user?.id) {
          requestAnimationFrame(() => {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          });
        }
      }
    };

    socket.on('chat:new', handleNewMessage);
    socket.on('chat:new message', handleNewMessage);
    return () => {
      socket.off('chat:new', handleNewMessage);
      socket.off('chat:new message', handleNewMessage);
    };
  }, [roomId, user?.id]);

  // 3. Upward scroll: Fetch next 50 older messages via cursor pagination (AC-2, AC-3)
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || loadingInitial || !hasMore || messages.length === 0) return;

    const oldest = messages[0];
    if (!oldest?.createdAt) return;

    setLoadingOlder(true);
    const container = containerRef.current;
    const prevScrollHeight = container?.scrollHeight || 0;
    const prevScrollTop = container?.scrollTop || 0;

    try {
      const query = `/api/rooms/${roomId}/messages?limit=50&before=${encodeURIComponent(oldest.createdAt)}`;
      const data = await api.get<ChatHistoryResponse>(query);

      if (data?.messages && data.messages.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newOlder = data.messages.filter((m) => !existingIds.has(m.id));
          return [...newOlder, ...prev];
        });
      }
      setHasMore(Boolean(data?.hasMore));

      // Preserve scroll position so content doesn't jump
      requestAnimationFrame(() => {
        if (containerRef.current) {
          const newScrollHeight = containerRef.current.scrollHeight;
          containerRef.current.scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop;
        }
      });
    } catch (err) {
      console.warn('[ChatPanel] Error fetching older chat messages:', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, loadingInitial, hasMore, messages, roomId]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop <= 15 && hasMore && !loadingOlder && !loadingInitial) {
      loadOlderMessages();
    }
  };

  // 4. Send message handler with optimistic update (US-CHAT-01)
  const sendMessage = async () => {
    const trimmed = draft.trim();
    if (!trimmed || isSending || disabled) return;
    if (trimmed.length > 2000) return;

    const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const tempId = -Date.now();

    // Optimistic message added immediately to state
    const optimisticMsg: ChatMessage = {
      id: tempId,
      roomId,
      senderId: user?.id || 'me',
      senderName: fullName || 'You',
      senderRole: (role as any) || 'student',
      body: trimmed,
      createdAt: new Date().toISOString(),
      clientId,
      status: 'sending',
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setDraft('');
    setIsSending(true);

    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    });

    try {
      if (socket.connected) {
        socket.emit('chat:send', { roomId, body: trimmed, clientId }, (res: any) => {
          if (res?.ok && res?.data) {
            const confirmed: ChatMessage = res.data;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempId || (m.clientId && m.clientId === clientId)
                  ? { ...confirmed, status: 'confirmed' }
                  : m
              )
            );
          } else if (res?.error) {
            console.warn('[ChatPanel] Socket chat:send failed:', res.error);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempId || (m.clientId && m.clientId === clientId)
                  ? { ...m, status: 'failed' }
                  : m
              )
            );
          }
        });
      } else {
        const res = await api.post<{ message: ChatMessage }>(`/api/rooms/${roomId}/messages`, {
          body: trimmed,
          clientId,
        });
        if (res?.message) {
          const confirmed = res.message;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId || (m.clientId && m.clientId === clientId)
                ? { ...confirmed, status: 'confirmed' }
                : m
            )
          );
        }
      }
    } catch (err) {
      console.error('[ChatPanel] Failed to send message:', err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId || (m.clientId && m.clientId === clientId)
            ? { ...m, status: 'failed' }
            : m
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-l border-slate-200/70 dark:border-slate-800/70">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/70 dark:border-slate-800/70 shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-indigo-500" />
          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
            Chat
          </span>
        </div>
        {messages.length > 0 && (
          <span className="text-[10px] text-slate-400 font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800">
            {messages.length} messages
          </span>
        )}
      </div>

      {/* Message list container */}
      <div
        id="chat-messages-container"
        data-testid="chat-messages-container"
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0"
      >
        {/* Loading older messages indicator (AC-3) */}
        {loadingOlder && (
          <div
            id="chat-loading-indicator"
            data-testid="chat-loading-indicator"
            className="flex items-center justify-center gap-2 py-2 text-xs text-indigo-600 dark:text-indigo-400 font-medium"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Loading...</span>
          </div>
        )}

        {/* No more messages indicator (AC-4) */}
        {!hasMore && !loadingInitial && !loadingOlder && (
          <div
            id="chat-no-more-messages"
            data-testid="chat-no-more-messages"
            className="text-center py-2 text-[11px] font-medium text-slate-400 dark:text-slate-500 border-b border-dashed border-slate-200 dark:border-slate-800/60 mb-2"
          >
            No more messages
          </div>
        )}

        {/* Initial loading state indicator (AC-3) */}
        {loadingInitial && (
          <div
            id="chat-loading-indicator"
            data-testid="chat-loading-indicator"
            className="flex flex-col items-center justify-center h-48 gap-2 text-xs text-slate-500 dark:text-slate-400 font-medium"
          >
            <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
            <span>Loading...</span>
          </div>
        )}

        {/* Empty state when no messages at all */}
        {!loadingInitial && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center text-slate-400 dark:text-slate-500 px-4">
            <MessageSquare className="w-8 h-8 stroke-1 text-slate-300 dark:text-slate-600 mb-2" />
            <p className="text-xs font-medium">No messages yet.</p>
            <p className="text-[11px] mt-0.5">Start the conversation below!</p>
          </div>
        )}

        {/* Messages */}
        {!loadingInitial &&
          messages
            .filter((msg): msg is ChatMessage => Boolean(msg && msg.id != null))
            .map((msg) => {
            const isOwn = user?.id ? msg.senderId === user.id : msg.senderName === fullName;
            const isTeacher = msg.senderRole === 'teacher';
            const isOptimistic = msg.id < 0 || msg.status === 'sending';
            const isFailed = msg.status === 'failed';

            return (
              <div
                key={msg.id}
                data-testid="chat-message-item"
                data-message-id={msg.id}
                data-status={msg.status || 'confirmed'}
                data-optimistic={isOptimistic ? 'true' : 'false'}
                className={`flex flex-col gap-0.5 ${isOwn ? 'items-end' : 'items-start'} ${
                  isOptimistic ? 'opacity-85' : ''
                }`}
              >
                <div className="flex items-center gap-1.5 px-1 mb-0.5">
                  <span
                    data-testid="chat-sender-name"
                    className="text-[11px] font-semibold text-slate-700 dark:text-slate-200"
                  >
                    {msg.senderName}
                    {isOwn && (
                      <span className="ml-1 text-[10px] font-normal text-slate-400 dark:text-slate-500">
                        (You)
                      </span>
                    )}
                  </span>
                  {isTeacher && (
                    <span
                      id={`chat-teacher-badge-${msg.id}`}
                      data-testid="chat-teacher-badge"
                      className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60 shadow-xs"
                    >
                      Teacher
                    </span>
                  )}
                  <span
                    data-testid="chat-message-time"
                    title={new Date(msg.createdAt).toLocaleString()}
                    className="text-[10px] text-slate-400 dark:text-slate-500"
                  >
                    · {formatTime(msg.createdAt)}
                  </span>
                  {isOptimistic && (
                    <span
                      data-testid="chat-message-sending"
                      className="text-[9px] text-indigo-400 dark:text-indigo-300 italic font-medium"
                    >
                      (sending...)
                    </span>
                  )}
                  {isFailed && (
                    <span
                      data-testid="chat-message-failed"
                      className="text-[9px] text-rose-500 font-semibold"
                    >
                      (failed)
                    </span>
                  )}
                </div>
                <div
                  className={`max-w-[85%] px-3.5 py-2 rounded-2xl text-xs leading-relaxed break-words whitespace-pre-wrap shadow-sm ${
                    isOwn
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-sm border border-slate-200/50 dark:border-slate-700/50'
                  }`}
                >
                  {renderMessageBody(msg.body, isOwn)}
                </div>
              </div>
            );
          })}
        <div ref={bottomRef} />
      </div>

      {/* Input section */}
      <div className="shrink-0 px-3 py-3 border-t border-slate-200/70 dark:border-slate-800/70 bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex items-end gap-2">
          <textarea
            id={`room-chat-input-${roomId}`}
            data-testid="room-chat-input"
            value={draft}
            disabled={disabled || isSending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled
                ? 'Reconnecting... chat is temporarily disabled'
                : 'Type a message… (Shift+Enter for new line)'
            }
            rows={1}
            maxLength={2000}
            className={`flex-1 resize-none rounded-xl px-3 py-2 text-xs glass-input focus:outline-none focus:ring-2 focus:ring-indigo-500 max-h-24 leading-relaxed bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 ${
              disabled || isSending
                ? 'opacity-50 cursor-not-allowed bg-slate-100 dark:bg-slate-800/40 select-none'
                : ''
            }`}
          />
          <button
            id={`room-chat-send-${roomId}`}
            data-testid="room-chat-send"
            onClick={sendMessage}
            disabled={disabled || isSending || !draft.trim() || draft.trim().length > 2000}
            title={disabled ? 'Reconnecting...' : 'Send message'}
            className="w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-all shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
          >
            {isSending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5 text-center">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
};
