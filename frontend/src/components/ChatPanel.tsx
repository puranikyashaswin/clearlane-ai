"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Send, ChevronDown, ChevronUp } from "lucide-react";
import { fetchContextSummary } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildContextDocument(summary: Record<string, any> | null): string {
  if (!summary) return "";

  const lines: string[] = [];
  lines.push("BENGALURU PARKING VIOLATIONS DATA SUMMARY");
  lines.push("=========================================");
  lines.push(`Total violations: ${summary.total_violations?.toLocaleString() ?? "N/A"}`);
  lines.push(`Total hotspots (H3 hexagons): ${summary.total_hotspots ?? "N/A"}`);
  lines.push(`Total estimated delay: ${summary.total_estimated_delay_hours ?? "N/A"} hours`);
  lines.push(`Police stations covered: ${summary.police_stations_covered ?? "N/A"}`);
  lines.push("");

  const peak = summary.peak_hour as Record<string, unknown> | undefined;
  if (peak) {
    lines.push(`Peak hour: ${peak.hour}:00 (${peak.violations?.toLocaleString()} violations)`);
    lines.push("");
  }

  // Top locations
  lines.push("TOP LOCATIONS (by violation count):");
  const locs = (summary.top_locations as Record<string, unknown>[]) ?? [];
  for (const loc of locs) {
    lines.push(`  - ${loc.name}: ${(loc.violations as number).toLocaleString()} violations`);
  }
  lines.push("");

  // Police stations
  lines.push("POLICE STATIONS (by violation count):");
  const stations = (summary.police_stations as Record<string, unknown>[]) ?? [];
  for (const s of stations) {
    lines.push(`  - ${s.name}: ${(s.violations as number).toLocaleString()} violations`);
  }
  lines.push("");

  // Hourly
  lines.push("HOURLY VIOLATION DISTRIBUTION:");
  const hours = (summary.hourly_distribution as Record<string, unknown>[]) ?? [];
  for (const h of hours) {
    lines.push(`  ${String(h.hour).padStart(2, "0")}:00 — ${(h.violations as number).toLocaleString()} violations`);
  }
  lines.push("");

  // Vehicles
  lines.push("VEHICLE BREAKDOWN (top 15):");
  const vehicles = (summary.vehicle_breakdown as Record<string, unknown>[]) ?? [];
  for (const v of vehicles) {
    lines.push(`  - ${v.type}: ${(v.count as number).toLocaleString()} violations`);
  }
  lines.push("");

  // Weekdays
  lines.push("WEEKDAY DISTRIBUTION:");
  const weekdays = (summary.weekday_distribution as Record<string, unknown>[]) ?? [];
  for (const d of weekdays) {
    lines.push(`  - ${d.day}: ${(d.violations as number).toLocaleString()} violations`);
  }

  return lines.join("\n");
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "I have the full Bengaluru parking violations dataset loaded. Ask me about traffic hotspots, congestion patterns, specific areas, police stations, or peak hours.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [contextDoc, setContextDoc] = useState<string>("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Fetch the data context summary on mount
  useEffect(() => {
    fetchContextSummary().then((summary) => {
      if (summary) {
        setContextDoc(buildContextDocument(summary));
      }
    });
  }, []);

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
          context: { data_summary: contextDoc },
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Read streaming response
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let accumulated = "";

        // Add a placeholder assistant message
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          // Parse SSE lines
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || "";
                if (content) {
                  accumulated += content;
                  // Update the last assistant message progressively
                  setMessages((prev) => {
                    const next = [...prev];
                    next[next.length - 1] = { role: "assistant", content: accumulated };
                    return next;
                  });
                }
              } catch {
                // Skip malformed JSON lines
              }
            }
          }
        }
      } else {
        // Fallback for non-streaming
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
  }, [input, loading, messages, contextDoc]);

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
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
            >
              <span className="text-xs font-medium text-zinc-400">
                ClearLane AI
              </span>
              {contextDoc && (
                <span className="text-[10px] text-zinc-600">
                  {contextDoc.split("\n")[1]?.trim() ?? "Data loaded"}
                </span>
              )}
              <span className="ml-auto text-zinc-600">
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5" />
                )}
              </span>
            </button>

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
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              contextDoc
                ? "Ask about traffic hotspots, areas, stations, patterns..."
                : "Loading data..."
            }
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
