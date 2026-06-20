"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Bot, Send, X, ChevronDown } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: Record<string, any>;
  contextLabel?: string;
}

export function ChatPanel({ context, contextLabel }: ChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Ask me anything about the traffic data on this page.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          context,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content;
      if (reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "I could not process that request." },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Chat service is unavailable right now. Make sure the NVIDIA API key is set.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, context]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      {/* Floating trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 grid h-12 w-12 place-items-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300 shadow-lg shadow-black/30 transition-all hover:bg-zinc-800 hover:border-zinc-600 hover:scale-105 active:scale-95"
        aria-label="Toggle AI chat"
        title="Ask ClearLane AI"
      >
        {open ? (
          <X className="h-5 w-5" />
        ) : (
          <Bot className="h-5 w-5" />
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex w-[380px] flex-col rounded-2xl border border-zinc-700/60 bg-zinc-950 shadow-2xl shadow-black/40 backdrop-blur-xl">
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-zinc-800 px-4 py-3.5">
            <div className="grid h-7 w-7 place-items-center rounded-full bg-zinc-800">
              <Bot className="h-3.5 w-3.5 text-zinc-300" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-zinc-200">
                ClearLane AI
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="text-[11px] text-zinc-500">
                  {contextLabel ?? "Analyzing current data"}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid h-7 w-7 place-items-center rounded-full text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div
            ref={listRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
            style={{ maxHeight: "360px", minHeight: "200px" }}
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "rounded-br-md bg-zinc-800 text-zinc-200"
                      : "rounded-bl-md border border-zinc-800/60 bg-zinc-900/60 text-zinc-300"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-zinc-800/60 bg-zinc-900/60 px-3.5 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: "0ms" }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: "150ms" }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-zinc-800 p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about the traffic data..."
                rows={1}
                className="flex-1 resize-none rounded-xl border border-zinc-800 bg-zinc-900/50 px-3.5 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none transition focus:border-zinc-600 focus:bg-zinc-900"
                style={{ minHeight: "40px", maxHeight: "120px" }}
              />
              <button
                type="button"
                onClick={send}
                disabled={!input.trim() || loading}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-zinc-200 text-zinc-900 transition hover:bg-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ChatPanel;
