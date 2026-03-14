"use client";

import { useEffect, useRef, useState } from "react";
import { sendGhostMessage } from "@/lib/chat";
import type { ChatMessage } from "@/lib/types";
import { GhostOrb } from "@/components/ghost-orb";
import { MessageContent } from "@/components/message-content";
import { GlassPanel } from "@/components/ui";
import { cn } from "@/lib/utils";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

const initialAssistantMessage: ChatMessage = {
  id: "ghost-welcome",
  role: "assistant",
  content:
    "Ghost is live. Send the first command when you want the surface to shift from presence into operation.",
  createdAt: new Date().toISOString(),
  meta: "standby",
};

// --- Progressive reveal hook ---

interface RevealTarget {
  id: string;
  content: string;
}

function useProgressiveReveal() {
  const [revealTarget, setRevealTarget] = useState<RevealTarget | null>(null);
  const [revealedContent, setRevealedContent] = useState("");
  const [isRevealing, setIsRevealing] = useState(false);

  useEffect(() => {
    if (!isRevealing || !revealTarget) return;

    const { content } = revealTarget;
    let cursor = 0;

    const timer = window.setInterval(() => {
      cursor = Math.min(cursor + 3, content.length);
      setRevealedContent(content.slice(0, cursor));

      if (cursor >= content.length) {
        setIsRevealing(false);
        setRevealTarget(null);
      }
    }, 12);

    return () => window.clearInterval(timer);
  }, [isRevealing, revealTarget]);

  function startReveal(id: string, content: string) {
    setRevealedContent("");
    setRevealTarget({ id, content });
    setIsRevealing(true);
  }

  return { revealTarget, revealedContent, isRevealing, startReveal };
}

// --- Thinking indicator ---

function ThinkingIndicator() {
  return (
    <div className="thinking-indicator" aria-label="Ghost is processing" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}

// --- Send icon ---

function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

// --- Main component ---

export function ChatSurface() {
  const [mode, setMode] = useState<"landing" | "operational">("landing");
  const [phase, setPhase] = useState<"idle" | "transitioning" | "ready">("idle");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([initialAssistantMessage]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const { revealTarget, revealedContent, isRevealing, startReveal } = useProgressiveReveal();

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [messages, mode, revealedContent]);

  useEffect(() => {
    if (mode !== "operational") {
      setPhase("idle");
      return;
    }
    setPhase("transitioning");
    const timer = window.setTimeout(() => setPhase("ready"), 900);
    return () => window.clearTimeout(timer);
  }, [mode]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = draft.trim();
    if (!value || isSending || isRevealing) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: value,
      createdAt: new Date().toISOString(),
      meta: "operator",
    };

    if (mode === "landing") setMode("operational");

    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setIsSending(true);

    try {
      const reply = await sendGhostMessage({ conversationId, message: value });
      setConversationId(reply.conversationId);

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: reply.reply,
        createdAt: new Date().toISOString(),
        meta: [reply.taskClass, reply.modelUsed].filter(Boolean).join(" · ") || "live route",
      };

      setMessages((current) => [...current, assistantMessage]);
      startReveal(assistantMessage.id, assistantMessage.content);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ghost chat request failed.";
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Live backend unavailable. ${message}`,
          createdAt: new Date().toISOString(),
          meta: "adapter fallback",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function handleReset() {
    setMode("landing");
    setConversationId(undefined);
    setMessages([initialAssistantMessage]);
    setDraft("");
    window.setTimeout(() => fieldRef.current?.focus(), 80);
  }

  const isResponding = isSending || isRevealing;

  // ── LANDING MODE ──────────────────────────────────────────────────────────

  if (mode === "landing") {
    return (
      <section className="landing-surface">
        {/* Tight orb bloom — concentrated light behind the orb */}
        <div className="hero-fog" aria-hidden="true" />

        <div className="landing-presence">
          <GhostOrb responding={isResponding} />

          <p className="landing-greeting">Hello, I&apos;m Ghost.</p>

          <form className="landing-prompt-form" onSubmit={handleSubmit}>
            <div className="landing-prompt-bar">
              <textarea
                ref={fieldRef}
                className="landing-prompt-field"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Ask Ghost anything…"
                rows={1}
                disabled={isResponding}
                autoFocus
              />
              <button
                className="landing-prompt-submit"
                disabled={isResponding || !draft.trim()}
                type="submit"
                aria-label="Send"
              >
                <SendIcon />
              </button>
            </div>
          </form>
        </div>
      </section>
    );
  }

  // ── OPERATIONAL MODE ──────────────────────────────────────────────────────

  return (
    <section className={cn("screen", "hero-shell", "operational")}>

      <div
        className={cn(
          "hero-stage",
          "operational",
          phase === "transitioning" && "transitioning",
          phase === "ready" && "ready",
        )}
      >
        <GlassPanel
          className={cn(
            "chat-shell",
            phase === "transitioning" && "transitioning",
            phase === "ready" && "ready",
          )}
        >
          {/* Orb condensed into header — presence compressed, not removed */}
          <div className="chat-header">
            <GhostOrb
              compact
              transitioning={phase === "transitioning"}
              responding={isResponding}
            />
            <div className="chat-identity">
              <span className="chat-title">Ghost</span>
              <span className="chat-subtitle">
                <span className={cn("ghost-status-dot", "active")} />
                {isResponding
                  ? "processing · entity routing"
                  : conversationId
                    ? `entity engaged · ${conversationId.slice(0, 10)}`
                    : "operational · standby"}
              </span>
            </div>
            <button type="button" className="ghost-chip" onClick={handleReset}>
              Reset
            </button>
          </div>

          <div ref={listRef} className="message-list" aria-live="polite">
            {messages.map((message) => {
              const isRevealingThis = isRevealing && revealTarget?.id === message.id;
              const displayContent = isRevealingThis ? revealedContent : message.content;
              const showMeta =
                message.role === "assistant" && !isRevealingThis && Boolean(message.meta);

              return (
                <article key={message.id} className={cn("message", message.role)}>
                  {message.role === "assistant" ? (
                    <MessageContent
                      content={message.content}
                      isRevealing={isRevealingThis}
                      revealedContent={revealedContent}
                    />
                  ) : (
                    <span>{displayContent}</span>
                  )}
                  {isRevealingThis && (
                    <span className="message-cursor" aria-hidden="true" />
                  )}
                  {showMeta && (
                    <div className="message-meta">
                      <span>{message.meta}</span>
                      <time
                        className="message-time"
                        dateTime={message.createdAt}
                        suppressHydrationWarning
                      >
                        {formatTime(message.createdAt)}
                      </time>
                    </div>
                  )}
                </article>
              );
            })}

            {isSending && <ThinkingIndicator />}
          </div>

          <form className="input-stack" onSubmit={handleSubmit}>
            <div className="input-panel">
              <div className="prompt-bar">
                <textarea
                  className="prompt-field"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="Ask Ghost to inspect, plan, route, or operate."
                  rows={2}
                  disabled={isResponding}
                />
                <button
                  className={cn("action-button", isResponding && "responding")}
                  disabled={isResponding}
                  type="submit"
                >
                  {isSending ? "Routing…" : isRevealing ? "Receiving…" : "Send"}
                </button>
              </div>
            </div>
          </form>
        </GlassPanel>
      </div>
    </section>
  );
}
