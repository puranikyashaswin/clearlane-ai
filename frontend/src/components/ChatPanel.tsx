"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Bot, Send, ChevronDown, ChevronUp } from "lucide-react";

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
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Ask me anything about the traffic data on this page.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setExpanded(true);
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
          content:
            "Chat service is unavailable right now. Make sure the NVIDIA API key is set in .env.local.",
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

  const hasMessages = messages.length > 1;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
      <div className="w-full max-w-2xl px-4 pb-4 pointer-events-auto">
        {/* Message history — collapsible */}
        {hasMessages && (
          <div className="mb-2 rounded-2xl border border-zinc-700/60 bg-zinc-950/90 shadow-xl shadow-black/30 backdrop-blur-xl">
            {/* Toggle bar */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
            >
              <Bot className="h-3.5 w-3.5 text-zinc-500" />
              <span className="text-xs font-medium text-zinc-400">
                {contextLabel ?? "ClearLane AI"}
              </span>
              <span className="ml-auto text-zinc-600">
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5" />
                )}
              </span>
            </button>

            {/* Messages panel */}
            {expanded && (
              <div
                ref={listRef}
                className="space-y-3 overflow-y-auto border-t border-zinc-800 px-4 py-3"
                style={{ maxHeight: "280px" }}
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
                    <div className="rounded-2xl rounded-bl-md border border-zinc-800/60 bg-zinc-900/60 px-3.5 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: "0ms" }} />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: "150ms" }} />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Input bar — always visible */}
        <div className="flex items-end gap-2 rounded-2xl border border-zinc-700/60 bg-zinc-950/90 px-4 py-3 shadow-xl shadow-black/30 backdrop-blur-xl">
          <Bot className="mb-2 h-5 w-5 shrink-0 text-zinc-500" />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the traffic data..."
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-zinc-200 placeholder-zinc-600 outline-none"
            style={{ minHeight: "24px", maxHeight: "96px" }}
          />
          {loading ? (
            <div className="flex items-center gap-1 px-2">
              <span className="h-1 w-1 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: "0ms" }} />
              <span className="h-1 w-1 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: "150ms" }} />
              <span className="h-1 w-1 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: "300ms" }} />
            </div>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!input.trim()}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-zinc-200 text-zinc-900 transition hover:bg-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChatPanel;
