"use client";

/**
 * The voice-first floating action button (PRD 5).
 *
 * Deliberately enormous and the only thing a new user needs to find: no menu
 * tree, no navigation. State is communicated by colour, motion, label and an
 * aria-live announcement, never by colour alone (WCAG 1.4.1).
 */

import { Mic, MicOff, PhoneOff } from "lucide-react";
import { cn } from "@/lib/utils";

export type MicState = "idle" | "listening" | "thinking" | "speaking" | "disabled";

/**
 * Simplified waveform indicator. The Web Speech API exposes no audio levels,
 * so the bars animate on recognition state; see the note in lib/speech.ts.
 */
export function Waveform({ active, bars = 7 }: { active: boolean; bars?: number }) {
  return (
    <div
      className="flex h-12 items-center justify-center gap-2"
      role="img"
      aria-label={active ? "Audio activity" : "Idle"}
      data-testid="waveform"
    >
      {Array.from({ length: bars }).map((_, index) => {
        const height = 14 + ((index * 7) % 5) * 8;
        return (
          <span
            key={index}
            aria-hidden="true"
            className={cn(
              "w-3 rounded-full bg-brand transition-opacity",
              active ? "sv-bar opacity-100" : "opacity-30",
            )}
            style={{
              height: `${height}px`,
              animationDelay: active ? `${index * 90}ms` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

type MicButtonProps = {
  state: MicState;
  inCall: boolean;
  labels: {
    idle: string;
    listening: string;
    thinking: string;
    speaking: string;
    startCall: string;
    endCall: string;
    inCall: string;
  };
  onToggle: () => void;
  onEndCall: () => void;
};

const STATE_STYLE: Record<MicState, string> = {
  idle: "bg-brand text-white hover:bg-brand-strong sv-pulse",
  listening: "bg-info text-white sv-listening",
  thinking: "bg-warn text-white",
  speaking: "bg-success text-white",
  disabled: "bg-line-soft text-white cursor-not-allowed",
};

function stateLabel(state: MicState, labels: MicButtonProps["labels"]): string {
  switch (state) {
    case "listening":
      return labels.listening;
    case "thinking":
      return labels.thinking;
    case "speaking":
      return labels.speaking;
    case "disabled":
      return labels.idle;
    default:
      return labels.idle;
  }
}

export function MicButton({ state, inCall, labels, onToggle, onEndCall }: MicButtonProps) {
  const label = stateLabel(state, labels);
  const Icon = state === "listening" ? Mic : state === "disabled" ? MicOff : Mic;

  return (
    <div className="flex flex-col items-center gap-5">
      <button
        type="button"
        onClick={onToggle}
        disabled={state === "disabled"}
        aria-label={inCall ? `${labels.inCall}: ${label}` : labels.startCall}
        aria-pressed={inCall}
        data-testid="mic-button"
        data-state={state}
        className={cn(
          "grid size-32 place-items-center rounded-full shadow-[0_6px_0_0_rgba(0,0,0,0.25)]",
          "transition-transform duration-150 active:translate-y-1 active:shadow-[0_2px_0_0_rgba(0,0,0,0.25)]",
          STATE_STYLE[state],
        )}
      >
        <Icon aria-hidden="true" className="size-16" strokeWidth={2.5} />
      </button>

      <p
        className="max-w-md text-center text-lg font-bold leading-snug text-ink"
        data-testid="mic-label"
      >
        {label}
      </p>

      {inCall ? (
        <button
          type="button"
          onClick={onEndCall}
          data-testid="end-call"
          className={cn(
            "inline-flex min-h-[var(--tap)] items-center gap-3 rounded-2xl border-4 border-ink bg-white px-7",
            "text-lg font-bold text-ink transition-colors hover:bg-surface",
          )}
        >
          <PhoneOff aria-hidden="true" className="size-7" strokeWidth={2.5} />
          {labels.endCall}
        </button>
      ) : null}
    </div>
  );
}
