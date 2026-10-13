import React, { useState, useRef, useEffect } from 'react';
import { Send, X, Sparkles, User, Compass, Cpu, Trash2, RefreshCw } from 'lucide-react';
import type { ChatMessage, ChatModelOption, DreamEntry } from '../types';
import { sendSymbolChatMessage, getHealth } from '../services/api';
import type { BackendHealth } from '../services/api';

interface SymbolChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  dream: DreamEntry;
  onUpdateChatHistory: (dreamId: string, newHistory: ChatMessage[]) => Promise<void> | void;
  initialSymbolQuery?: string;
}

const pendingKey = (id: string) => `oneiros_pending_chat_${id}`;

function recoverPendingHistory(id: string): ChatMessage[] | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(pendingKey(id)) || 'null');
    if (!Array.isArray(value) || !value.every((message) =>
      message && (message.role === 'user' || message.role === 'model') &&
      typeof message.content === 'string' && typeof message.timestamp === 'string'
    )) return null;
    return value;
  } catch { return null; }
}

export const SymbolChatModal: React.FC<SymbolChatModalProps> = ({
  isOpen, onClose, dream, onUpdateChatHistory, initialSymbolQuery,
}) => {
  const [recoveredHistory] = useState(() => recoverPendingHistory(dream.id));
  const [isClosing, setIsClosing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(recoveredHistory || dream.chatHistory || []);
  const [pendingHistory, setPendingHistory] = useState<ChatMessage[] | null>(recoveredHistory);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('');
  const [selectedModel, setSelectedModel] = useState<ChatModelOption>('');
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const canChat = health?.capabilities.chat === true;
  const [errorMessage, setErrorMessage] = useState<string | null>(
    recoveredHistory ? 'A reply from your previous session has not been saved. Retry saving it below.' : null
  );
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const pendingHistoryRef = useRef<ChatMessage[] | null>(recoveredHistory);
  const requestAbortRef = useRef<AbortController | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestAbortRef.current?.abort();
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (initialSymbolQuery && isOpen) {
      setInputValue(`Could you analyze the archetypal meaning of "${initialSymbolQuery}" in this dream?`);
    }
  }, [initialSymbolQuery, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    getHealth().then((status) => {
      if (!active) return;
      setHealth(status);
      setSelectedModel((current) => status.chatModels.some((model) => model.id === current) ? current : status.textModel);
    }).catch(() => { if (active) setErrorMessage('无法读取对话服务配置，请重新打开此窗口。'); });
    return () => { active = false; };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen, isLoading, pendingHistory]);

  const rememberPending = (history: ChatMessage[] | null) => {
    pendingHistoryRef.current = history;
    if (mountedRef.current) setPendingHistory(history);
    try {
      if (history) sessionStorage.setItem(pendingKey(dream.id), JSON.stringify(history));
      else sessionStorage.removeItem(pendingKey(dream.id));
    } catch { /* Keep the reply in component memory if storage is full. */ }
  };

  const handleAnimateClose = () => {
    if (isClosing || busyRef.current) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      onClose();
      if (mountedRef.current) setIsClosing(false);
    }, 380);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleAnimateClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isClosing]);

  const persistReply = async (history: ChatMessage[]) => {
    rememberPending(history);
    if (mountedRef.current) setLoadingLabel('Saving the conversation...');
    try {
      await onUpdateChatHistory(dream.id, history);
      rememberPending(null);
      if (mountedRef.current) setErrorMessage(null);
    } catch (error) {
      if (mountedRef.current) {
        setErrorMessage(`The reply is ready but could not be saved. Retry saving below. ${error instanceof Error ? error.message : ''}`);
      }
    }
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = (customPrompt || inputValue).trim();
    if (!textToSend || busyRef.current || pendingHistoryRef.current || isClosing || !canChat) return;
    if (textToSend.length > 8_000) { setErrorMessage('Please keep questions under 8,000 characters.'); return; }
    if (messages.length > 4998) { setErrorMessage('This conversation has reached 5,000 messages. Export a backup, then clear this conversation to continue.'); return; }
    busyRef.current = true;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const previousMessages = messages;
    const updatedMessages: ChatMessage[] = [
      ...previousMessages, { role: 'user', content: textToSend, timestamp: new Date().toISOString() },
    ];
    setMessages(updatedMessages);
    setInputValue('');
    setErrorMessage(null);
    setIsLoading(true);
    setLoadingLabel(`Reflecting on your dream (${selectedModel})...`);
    try {
      const reply = await sendSymbolChatMessage(
        updatedMessages.map((message) => ({ role: message.role, content: message.content })),
        dream, selectedModel, controller.signal
      );
      if (!mountedRef.current || controller.signal.aborted) return;
      const finalHistory: ChatMessage[] = [
        ...updatedMessages, { role: 'model', content: reply, timestamp: new Date().toISOString() },
      ];
      // Show and retain the reply before attempting storage, so a failed save never repeats the AI call.
      setMessages(finalHistory);
      await persistReply(finalHistory);
    } catch (error) {
      if (mountedRef.current && !controller.signal.aborted) {
        setMessages(previousMessages);
        setInputValue(textToSend);
        setErrorMessage(error instanceof Error ? error.message : 'The reply was interrupted. Your question is ready to retry.');
      }
    } finally {
      busyRef.current = false;
      requestAbortRef.current = null;
      if (mountedRef.current) setIsLoading(false);
    }
  };

  const handleRetrySave = async () => {
    const history = pendingHistoryRef.current;
    if (!history || busyRef.current) return;
    busyRef.current = true;
    setIsLoading(true);
    setErrorMessage(null);
    try { await persistReply(history); }
    finally {
      busyRef.current = false;
      if (mountedRef.current) setIsLoading(false);
    }
  };

  const handleClearChat = async () => {
    if (busyRef.current || isClosing) return;
    busyRef.current = true;
    setIsLoading(true);
    setLoadingLabel('Clearing the conversation...');
    setErrorMessage(null);
    try {
      await onUpdateChatHistory(dream.id, []);
      rememberPending(null);
      if (mountedRef.current) setMessages([]);
    } catch (error) {
      if (mountedRef.current) setErrorMessage(error instanceof Error ? error.message : 'Chat history could not be cleared.');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleAnimateClose();
        }
      }}
      className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/65 backdrop-blur-md transition-all ${
        isClosing ? 'animate-backdrop-out' : 'animate-backdrop-in'
      }`}
    >
      <div
        className={`relative w-full max-w-4xl h-[90vh] bg-[#FAF8F5] border border-[#DCD6CA] rounded-xl shadow-2xl flex flex-col overflow-hidden text-[#1C1917] ${
          isClosing ? 'animate-dream-out' : 'animate-dream-in'
        }`}
      >
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-[#E7E2DA] flex items-center justify-between gap-4 bg-[#F5F1EB]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[#1C1917] text-[#FAF8F5] flex items-center justify-center font-cinzel text-sm shrink-0">
              Ψ
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#78716C] truncate">
                <span>Jungian Symbol Dialogue</span>
                <span aria-hidden="true">·</span>
                <span className="truncate max-w-[150px] sm:max-w-xs">{dream.title}</span>
              </div>
              <h3 className="font-editorial text-lg font-semibold text-[#1C1917] truncate">
                Active Imagination & Symbol Inquiry
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Model Tier Selector */}
            <div className="hidden sm:flex items-center gap-2 bg-[#FAF8F5] border border-[#DCD6CA] rounded-md px-2.5 py-1 text-xs">
              <Cpu className="w-3.5 h-3.5 text-[#78716C]" />
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as ChatModelOption)}
                disabled={isLoading || !!pendingHistory || !canChat}
                className="bg-transparent text-xs font-medium text-[#1C1917] focus:outline-none cursor-pointer"
              >
                {!health && <option value="">正在读取模型…</option>}
                {health?.chatModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            </div>

            {messages.length > 0 && (
              <button
                onClick={handleClearChat}
                disabled={isLoading || isClosing}
                title="Clear thread history"
                className="p-2 text-[#78716C] hover:text-red-700 hover:bg-[#EAE4D9] rounded transition-colors"
                aria-label="Clear chat"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}

            {/* Prominent High-Visibility Close Button */}
            <button
              onClick={handleAnimateClose}
              disabled={isClosing || isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#1C1917] bg-[#FAF8F5] hover:bg-[#1C1917] hover:text-[#FAF8F5] border-2 border-[#1C1917] rounded-lg transition-all duration-200 shadow-sm cursor-pointer group active:scale-95"
              title="Close dialogue and awaken (ESC)"
              aria-label="Close dialogue"
            >
              <X className="w-3.5 h-3.5 transition-transform group-hover:rotate-90" />
              <span>Close</span>
              <kbd className="hidden sm:inline-block text-[10px] bg-black/10 group-hover:bg-white/20 px-1.5 py-0.5 rounded font-mono font-medium">
                ESC
              </kbd>
            </button>
          </div>
        </div>

        {/* Quick Symbol Anchor Strip */}
        {dream.interpretation?.symbols && dream.interpretation.symbols.length > 0 && (
          <div className="px-6 py-2.5 bg-[#FAF8F5] border-b border-[#E7E2DA] flex items-center gap-2 overflow-x-auto text-xs">
            <span className="text-[#78716C] whitespace-nowrap font-medium flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-[#B45309]" /> Explore Symbol:
            </span>
            {dream.interpretation.symbols.map((sym, idx) => (
              <button
                key={idx}
                onClick={() =>
                  handleSendMessage(
                    `What is the deeper archetypal meaning of "${sym.symbol}" in relation to my dream's core theme?`
                  )
                }
                disabled={isLoading || !!pendingHistory || !canChat}
                className="whitespace-nowrap px-2.5 py-1 text-xs font-medium text-[#1C1917] bg-[#F3EFEA] hover:bg-[#E7E1D6] border border-[#DDD6C8] rounded transition-colors cursor-pointer disabled:opacity-50"
              >
                {sym.symbol}
              </button>
            ))}
          </div>
        )}

        {/* Scrollable Conversation Thread */}
        <div className="flex-1 p-6 overflow-y-auto space-y-6">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto p-6 space-y-4">
              <div className="w-12 h-12 rounded-full bg-[#EAE4D9] flex items-center justify-center text-[#78716C]">
                <Compass className="w-6 h-6" />
              </div>
              <h4 className="font-editorial text-xl font-medium text-[#1C1917]">
                Begin the Psychoanalytic Inquiry
              </h4>
              <p className="text-xs text-[#78716C] leading-relaxed font-body-serif">
                Ask about specific figures, strange feelings, recurring motifs, or unusual transformations in your dream.
                The analyst will connect them to Carl Jung’s collective unconscious and individuation path.
              </p>
              <div className="pt-2 flex flex-col gap-2 w-full text-xs">
                <button
                  disabled={isLoading || !!pendingHistory || !canChat}
                  onClick={() =>
                    handleSendMessage('What is the central unconscious conflict presented in this dream?')
                  }
                  className="p-2.5 text-left bg-white border border-[#DCD6CA] hover:border-[#1C1917] rounded-md transition-all text-[#44403C]"
                >
                  → "What is the central unconscious conflict presented in this dream?"
                </button>
                <button
                  disabled={isLoading || !!pendingHistory || !canChat}
                  onClick={() =>
                    handleSendMessage('How can I perform Active Imagination with the primary archetype in this dream?')
                  }
                  className="p-2.5 text-left bg-white border border-[#DCD6CA] hover:border-[#1C1917] rounded-md transition-all text-[#44403C]"
                >
                  → "How can I perform Active Imagination with the primary archetype?"
                </button>
              </div>
            </div>
          )}

          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex gap-3.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'model' && (
                <div className="w-8 h-8 rounded-full bg-[#1C1917] text-[#FAF8F5] flex items-center justify-center shrink-0 mt-1 font-cinzel text-xs">
                  Ψ
                </div>
              )}

              <div
                className={`max-w-[80%] rounded-lg p-4 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[#1C1917] text-[#FAF8F5] shadow-xs'
                    : 'bg-white border border-[#E2DDD3] text-[#1C1917] font-body-serif shadow-xs'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
                <div
                  className={`text-[10px] mt-2 opacity-60 ${
                    msg.role === 'user' ? 'text-right text-[#FAF8F5]' : 'text-left text-[#78716C]'
                  }`}
                >
                  {new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>

              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-[#ECE7DE] text-[#57534E] flex items-center justify-center shrink-0 mt-1 text-xs font-semibold">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-3.5 items-start">
              <div className="w-8 h-8 rounded-full bg-[#1C1917] text-[#FAF8F5] flex items-center justify-center shrink-0 mt-1 font-cinzel text-xs">
                Ψ
              </div>
              <div className="bg-white border border-[#E2DDD3] rounded-lg p-4 text-xs text-[#78716C] flex items-center gap-2 shadow-xs">
                <Sparkles className="w-3.5 h-3.5 animate-spin text-[#B45309]" />
                <span>{loadingLabel}</span>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-md">
              {errorMessage}
            </div>
          )}

          {pendingHistory && (
            <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-md flex flex-wrap items-center justify-between gap-3" role="status">
              <span>This reply has not been saved to the archive yet. It is retained in this browser tab.</span>
              <button
                type="button"
                onClick={() => void handleRetrySave()}
                disabled={isLoading}
                className="px-3 py-2 rounded border border-amber-700 font-semibold flex items-center gap-2 disabled:opacity-40"
              >
                <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                Retry saving
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t border-[#E7E2DA] bg-[#FAF8F5]">
          {health && !canChat && <div role="status" className="mb-3 text-xs text-amber-900">尚未配置对话服务密钥。配置后即可继续探索梦境；现有对话已保留。</div>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask the analyst about a symbol, figure, color, or emotional tension..."
              disabled={isLoading || !!pendingHistory || !canChat}
              maxLength={8000}
              className="flex-1 px-4 py-3 bg-white border border-[#DCD6CA] rounded-lg text-sm text-[#1C1917] placeholder:text-[#A8A29E] focus:outline-none focus:ring-2 focus:ring-[#1C1917] transition-all disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isLoading || !!pendingHistory || !inputValue.trim() || !canChat}
              className="px-5 py-3 bg-[#1C1917] hover:bg-[#2F2B28] text-[#FAF8F5] rounded-lg text-xs font-semibold uppercase tracking-wider flex items-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Inquire</span>
            </button>
          </form>
          <div className="flex items-center justify-between text-[11px] text-[#78716C] mt-2 px-1">
            <span>Role: Jungian Depth Psychoanalyst</span>
            <span>Press ESC or click backdrop to close dialogue</span>
          </div>
        </div>
      </div>
    </div>
  );
};
