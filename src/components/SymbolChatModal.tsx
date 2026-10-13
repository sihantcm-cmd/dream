import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  X,
  Sparkles,
  User,
  Compass,
  Cpu,
  Trash2,
} from 'lucide-react';
import { ChatMessage, ChatModelOption, DreamEntry } from '../types';
import { sendSymbolChatMessage } from '../services/api';

interface SymbolChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  dream: DreamEntry;
  onUpdateChatHistory: (dreamId: string, newHistory: ChatMessage[]) => void;
  initialSymbolQuery?: string;
}

export const SymbolChatModal: React.FC<SymbolChatModalProps> = ({
  isOpen,
  onClose,
  dream,
  onUpdateChatHistory,
  initialSymbolQuery,
}) => {
  const [isClosing, setIsClosing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(dream.chatHistory || []);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ChatModelOption>('gemini-3.5-flash');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Sync when dream changes
  useEffect(() => {
    setMessages(dream.chatHistory || []);
  }, [dream]);

  // Handle initial symbol query if passed
  useEffect(() => {
    if (initialSymbolQuery && isOpen) {
      setInputValue(`Could you analyze the archetypal meaning of "${initialSymbolQuery}" in this dream?`);
    }
  }, [initialSymbolQuery, isOpen]);

  // Scroll to bottom on new message
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isLoading]);

  // Keyboard shortcut: ESC to trigger animated dissolution
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleAnimateClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleAnimateClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 380);
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || inputValue;
    if (!textToSend.trim() || isLoading) return;

    setErrorMessage(null);
    const userMsg: ChatMessage = {
      role: 'user',
      content: textToSend.trim(),
      timestamp: new Date().toISOString(),
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputValue('');
    setIsLoading(true);

    try {
      const reply = await sendSymbolChatMessage(
        updatedMessages.map((m) => ({ role: m.role, content: m.content })),
        dream,
        selectedModel
      );

      const assistantMsg: ChatMessage = {
        role: 'model',
        content: reply,
        timestamp: new Date().toISOString(),
      };

      const finalHistory = [...updatedMessages, assistantMsg];
      setMessages(finalHistory);
      onUpdateChatHistory(dream.id, finalHistory);
    } catch (err: any) {
      console.error('Chat error:', err);
      setErrorMessage(
        err.message || 'Symbol consultation was interrupted. Please check your connection or retry.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    onUpdateChatHistory(dream.id, []);
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
                className="bg-transparent text-xs font-medium text-[#1C1917] focus:outline-none cursor-pointer"
              >
                <option value="gemini-3.5-flash">gemini-3.5-flash (General Tasks)</option>
                <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (Complex Tasks)</option>
                <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Fast Tasks)</option>
              </select>
            </div>

            {messages.length > 0 && (
              <button
                onClick={handleClearChat}
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
              disabled={isClosing}
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
                disabled={isLoading}
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
                  onClick={() =>
                    handleSendMessage('What is the central unconscious conflict presented in this dream?')
                  }
                  className="p-2.5 text-left bg-white border border-[#DCD6CA] hover:border-[#1C1917] rounded-md transition-all text-[#44403C]"
                >
                  → "What is the central unconscious conflict presented in this dream?"
                </button>
                <button
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
                <span>Analyst contemplating archetypal nuances ({selectedModel})...</span>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-md">
              {errorMessage}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t border-[#E7E2DA] bg-[#FAF8F5]">
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
              disabled={isLoading}
              className="flex-1 px-4 py-3 bg-white border border-[#DCD6CA] rounded-lg text-sm text-[#1C1917] placeholder:text-[#A8A29E] focus:outline-none focus:ring-2 focus:ring-[#1C1917] transition-all disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isLoading || !inputValue.trim()}
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
