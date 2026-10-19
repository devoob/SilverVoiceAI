"use client";

/**
 * Six-digit security PIN pad (PRD 6).
 *
 * This is the control that keeps the AI honest: money only moves after a
 * physical tap sequence here, never from a voice command. Two properties are
 * enforced in this file:
 *
 *   - The entered value is never rendered, logged, or spoken. Only a count is
 *     announced, so a bystander or a screen reader gets nothing usable.
 *   - There is no text field, so it cannot be autofilled or driven from
 *     speech input. Only discrete tap targets and physical key events work.
 *
 * Submission fires from the tap handler rather than from an effect watching
 * the digit count: an elderly user should not have to hunt for a submit button
 * after the sixth digit, and it keeps state transitions in the event that
 * caused them.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Delete, Eraser, ShieldCheck } from "lucide-react";
import { Button } from "./ui";
import { cn } from "@/lib/utils";
import { PIN_LENGTH } from "@/lib/bank";

type PinPadProps = {
  title: string;
  body: string;
  secureNote: string;
  enteredLabel: string;
  digitHint: string;
  clearLabel: string;
  backspaceLabel: string;
  error?: string | null;
  attemptsLeft?: number | null;
  onSubmit: (pin: string) => void | Promise<void>;
  onCancel?: () => void;
  cancelLabel?: string;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function PinPad({
  title,
  body,
  secureNote,
  enteredLabel,
  digitHint,
  clearLabel,
  backspaceLabel,
  error,
  attemptsLeft,
  onSubmit,
  onCancel,
  cancelLabel,
}: PinPadProps) {
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Mirrors `pin` for synchronous reads inside handlers, and holds the latest
  // onSubmit so a re-render can't capture a stale closure.
  const pinRef = useRef("");
  const submitRef = useRef(onSubmit);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    submitRef.current = onSubmit;
  });

  const commit = useCallback((next: string) => {
    pinRef.current = next;
    setPin(next);
  }, []);

  const append = useCallback(
    (digit: string) => {
      if (submitting || pinRef.current.length >= PIN_LENGTH) return;

      const next = pinRef.current + digit;
      commit(next);

      if (next.length === PIN_LENGTH) {
        setSubmitting(true);
        void Promise.resolve(submitRef.current(next))
          .then(() => commit(""))
          .finally(() => setSubmitting(false));
      }
    },
    [commit, submitting],
  );

  const backspace = useCallback(() => {
    if (submitting) return;
    commit(pinRef.current.slice(0, -1));
  }, [commit, submitting]);

  const clear = useCallback(() => {
    if (submitting) return;
    commit("");
  }, [commit, submitting]);

  // Physical keyboards work too — for users who prefer one, or who drive the
  // interface through a switch device or on-screen keyboard.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key >= "0" && event.key <= "9") append(event.key);
      else if (event.key === "Backspace") backspace();
      else if (event.key === "Escape") clear();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [append, backspace, clear]);

  // Land keyboard focus somewhere sensible when the pad appears.
  useEffect(() => {
    gridRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  return (
    <section
      aria-labelledby="pin-title"
      className="rounded-3xl border-4 border-brand bg-surface-brand p-7"
      data-testid="pin-pad"
    >
      <header className="mb-5 flex items-start gap-4">
        <ShieldCheck aria-hidden="true" className="mt-1 size-10 shrink-0 text-brand" strokeWidth={2.5} />
        <div>
          <h2 id="pin-title" className="text-xl font-extrabold leading-tight text-ink">
            {title}
          </h2>
          <p className="mt-2 text-base leading-relaxed text-muted">{body}</p>
        </div>
      </header>

      {/* Dot indicators — a count, never the digits. */}
      <div
        role="status"
        aria-live="polite"
        aria-label={`${enteredLabel}: ${pin.length} / ${PIN_LENGTH}`}
        className="mb-6 flex items-center justify-center gap-4"
        data-testid="pin-progress"
      >
        {Array.from({ length: PIN_LENGTH }).map((_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={cn(
              "size-7 rounded-full border-4 transition-colors",
              index < pin.length ? "border-brand bg-brand" : "border-line bg-white",
            )}
          />
        ))}
        <span className="sr-only">{`${pin.length} / ${PIN_LENGTH} ${digitHint}`}</span>
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-5 rounded-2xl border-4 border-danger bg-white p-5 text-center text-lg font-bold text-danger"
          data-testid="pin-error"
        >
          {error}
          {attemptsLeft !== null && attemptsLeft !== undefined ? ` (${attemptsLeft})` : ""}
        </p>
      ) : null}

      <div ref={gridRef} className="grid grid-cols-3 gap-4">
        {KEYS.map((digit) => (
          <Button
            key={digit}
            variant="secondary"
            onClick={() => append(digit)}
            aria-label={digit}
            className="min-h-[88px] text-3xl tabular-nums"
            data-testid={`pin-key-${digit}`}
          >
            {digit}
          </Button>
        ))}

        <Button
          variant="quiet"
          onClick={clear}
          aria-label={clearLabel}
          className="min-h-[88px] text-base"
          data-testid="pin-clear"
        >
          <Eraser aria-hidden="true" className="size-7" strokeWidth={2.5} />
          {clearLabel}
        </Button>

        <Button
          variant="secondary"
          onClick={() => append("0")}
          aria-label="0"
          className="min-h-[88px] text-3xl tabular-nums"
          data-testid="pin-key-0"
        >
          0
        </Button>

        <Button
          variant="quiet"
          onClick={backspace}
          aria-label={backspaceLabel}
          className="min-h-[88px]"
          data-testid="pin-backspace"
        >
          <Delete aria-hidden="true" className="size-8" strokeWidth={2.5} />
        </Button>
      </div>

      <p className="mt-6 flex items-start gap-3 rounded-2xl bg-white p-5 text-base leading-relaxed text-muted">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-success" strokeWidth={2.5} />
        {secureNote}
      </p>

      {onCancel && cancelLabel ? (
        <Button
          variant="quiet"
          size="block"
          onClick={onCancel}
          className="mt-5"
          data-testid="pin-cancel"
        >
          {cancelLabel}
        </Button>
      ) : null}
    </section>
  );
}
