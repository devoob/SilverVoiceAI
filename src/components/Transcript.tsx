"use client";

/**
 * Dual-feedback transcript (PRD 5).
 *
 * Speech is transient; an elderly user may miss a sentence, or may be in a
 * noisy room, or may be hard of hearing. Every assistant utterance therefore
 * persists here as large text, and the newest reply is mirrored into an
 * aria-live region for screen-reader users.
 */

import { useEffect, useRef } from "react";
import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message } from "@/hooks/useAssistant";

type TranscriptProps = {
  messages: Message[];
  interim: string;
  labels: {
    heading: string;
    you: string;
    assistant: string;
    empty: string;
    liveRegion: string;
    listening: string;
  };
  listening: boolean;
};

export function Transcript({ messages, interim, labels, listening }: TranscriptProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const last = messages[messages.length - 1];

  // Keep the newest exchange in view without hijacking scroll position while
  // the user is reading back through the conversation.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 240;
    if (nearBottom || messages.length <= 1) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages.length, interim]);

  return (
    <section
      aria-labelledby="transcript-heading"
      className="flex min-h-0 flex-1 flex-col rounded-3xl border-4 border-line bg-white"
    >
      <header className="flex items-center justify-between gap-4 border-b-4 border-line px-6 py-4">
        <h2 id="transcript-heading" className="text-lg font-extrabold text-ink">
          {labels.heading}
        </h2>
        {listening ? (
          <span className="text-base font-bold text-info" data-testid="listening-flag">
            {labels.listening}
          </span>
        ) : null}
      </header>

      {/* Screen-reader mirror of the most recent assistant turn. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="live-region">
        {last?.role === "assistant" ? `${labels.liveRegion}: ${last.text}` : ""}
      </div>

      {messages.length === 0 ? (
        <p className="flex-1 px-6 py-10 text-center text-lg leading-relaxed text-muted">
          {labels.empty}
        </p>
      ) : (
        <ol
          ref={listRef}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
          data-testid="transcript-list"
        >
          {messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <li
                key={message.id}
                data-testid={`turn-${message.role}`}
                className={cn("flex items-start gap-4", isUser ? "flex-row-reverse" : "flex-row")}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-12 shrink-0 place-items-center rounded-full",
                    isUser ? "bg-ink text-white" : "bg-brand text-white",
                  )}
                >
                  {isUser ? <User className="size-7" strokeWidth={2.5} /> : <Bot className="size-7" strokeWidth={2.5} />}
                </span>
                <div className={cn("max-w-[85%]", isUser ? "text-right" : "text-left")}>
                  <p className="mb-1 text-base font-bold uppercase tracking-wide text-muted">
                    {isUser ? labels.you : labels.assistant}
                  </p>
                  <p
                    className={cn(
                      "inline-block rounded-2xl border-4 px-5 py-4 text-lg leading-relaxed",
                      isUser
                        ? "border-ink bg-surface text-ink"
                        : "border-brand bg-surface-brand text-ink",
                    )}
                  >
                    {message.text}
                  </p>
                </div>
              </li>
            );
          })}

          {interim ? (
            <li className="flex items-start gap-4" data-testid="turn-interim">
              <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-info text-white">
                <User className="size-7" strokeWidth={2.5} />
              </span>
              <p className="rounded-2xl border-4 border-dashed border-info bg-white px-5 py-4 text-lg italic leading-relaxed text-muted">
                {interim}
              </p>
            </li>
          ) : null}
        </ol>
      )}
    </section>
  );
}
