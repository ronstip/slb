import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Square, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { streamChat } from '../../api/sse-client.ts';
import { useAuth } from '../../auth/useAuth.ts';
import { isUpdateDashboardResult } from '../../lib/event-parser.ts';
import { cn } from '../../lib/utils.ts';
import type { SSEEvent } from '../../api/types.ts';

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

interface Message {
  id: string;
  role: 'user' | 'agent';
  text: string;
  isStreaming?: boolean;
}

interface DashboardChatOverlayProps {
  artifactId: string;
}

export function DashboardChatOverlay({ artifactId }: DashboardChatOverlayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isResponding, setIsResponding] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isExpanded) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isExpanded]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [inputText]);

  useEffect(() => {
    if (isExpanded) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isExpanded]);

  const processEvent = useCallback((event: SSEEvent, agentMsgId: string) => {
    switch (event.event_type) {
      case 'partial_text': {
        const clean = event.content.replace(HTML_COMMENT_RE, '');
        if (clean) {
          setMessages(prev => prev.map(m =>
            m.id === agentMsgId ? { ...m, text: m.text + clean } : m
          ));
        }
        break;
      }
      case 'text': {
        const clean = event.content.replace(HTML_COMMENT_RE, '').trim();
        if (clean) {
          setMessages(prev => prev.map(m =>
            m.id === agentMsgId ? { ...m, text: clean } : m
          ));
        }
        break;
      }
      case 'tool_result': {
        const { name: toolName, result } = event.metadata;
        if (result && isUpdateDashboardResult(toolName, result)) {
          // Reset the initialised flag so SocialDashboardView picks up the new layout
          window.dispatchEvent(new CustomEvent('dashboard-agent-updated', { detail: { dashboardId: artifactId } }));
          // Force immediate refetch so the dashboard updates live without refresh
          queryClient.invalidateQueries({ queryKey: ['dashboard-layout', artifactId] });
          queryClient.refetchQueries({ queryKey: ['dashboard-layout', artifactId] });
        }
        break;
      }
      case 'done': {
        setSessionId(event.session_id);
        break;
      }
    }
  }, [artifactId, queryClient]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isResponding) return;

    const userMsgId = `user-${Date.now()}`;
    const agentMsgId = `agent-${Date.now()}`;

    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', text },
      { id: agentMsgId, role: 'agent', text: '', isStreaming: true },
    ]);
    setInputText('');
    setIsResponding(true);
    setIsExpanded(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const stream = streamChat(
        { message: text, session_id: sessionId, active_dashboard_id: artifactId },
        getToken,
        controller.signal,
      );

      for await (const event of stream) {
        if (controller.signal.aborted) break;
        processEvent(event, agentMsgId);
      }
    } catch {
      if (!controller.signal.aborted) {
        setMessages(prev => prev.map(m =>
          m.id === agentMsgId ? { ...m, text: 'Something went wrong. Please try again.' } : m
        ));
      }
    } finally {
      setMessages(prev => prev.map(m =>
        m.id === agentMsgId ? { ...m, isStreaming: false } : m
      ));
      setIsResponding(false);
    }
  }, [isResponding, sessionId, artifactId, getToken, processEvent]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputText);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsResponding(false);
    setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m));
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
      <div className="w-full max-w-2xl px-4 pb-4 pointer-events-auto">
        {/* Message history */}
        {isExpanded && hasMessages && (
          <div className="mb-2 max-h-72 overflow-y-auto rounded-2xl border border-border bg-card/95 shadow-xl backdrop-blur-sm">
            <div className="flex flex-col gap-2 p-3">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={cn(
                    'flex max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'ml-auto bg-accent-vibrant text-white'
                      : 'mr-auto bg-muted text-foreground',
                  )}
                >
                  {msg.text || (msg.isStreaming && (
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
                    </span>
                  ))}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* Input bar */}
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-card/95 shadow-xl backdrop-blur-sm px-4 py-3">
          <div className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-vibrant/10">
            <Sparkles className="h-3.5 w-3.5 text-accent-vibrant" />
          </div>

          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isResponding}
            placeholder="Ask AI to edit this dashboard…"
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />

          {hasMessages && (
            <button
              onClick={() => setIsExpanded(prev => !prev)}
              className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={isExpanded ? 'Hide conversation' : 'Show conversation'}
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          )}

          {isResponding ? (
            <button
              onClick={handleCancel}
              className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              title="Stop"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          ) : (
            <button
              onClick={() => sendMessage(inputText)}
              disabled={!inputText.trim()}
              className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-30"
              title="Send"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
