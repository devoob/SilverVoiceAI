"use client";

/**
 * React bindings over the speech adapters.
 *
 * Recognition is now a **continuous session with a debounced turn boundary**,
 * rather than one session per utterance. That is what gives a considered
 * speaker time to think:
 *
 *   - the session survives mid-sentence pauses (continuous = true);
 *   - final chunks are buffered and only committed after END_OF_SPEECH_MS of
 *     quiet, so "我想…… 繳交…… 電費" is one turn, not three;
 *   - the session stays open while the assistant speaks, which is what makes
 *     barge-in possible;
 *   - silence never ends the call, and an unexpectedly closed session is
 *     re-armed.
 *
 * Callbacks are mirrored into refs by an effect (never during render, which the
 * React Compiler forbids) so a re-render cannot detach an in-flight session.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  resolveRecognitionAdapter,
  resolveSynthesisAdapter,
  voicesForTag,
  hasCantoneseVoice,
  isCantoneseTag,
  type RecognitionAdapter,
  type RecognitionErrorCode,
  type SynthesisAdapter,
  type SynthesisMode,
  type SynthesisVoiceOption,
} from "@/lib/speech";

export type ListeningStatus = "idle" | "listening" | "denied" | "unsupported" | "error";

/**
 * How long the user may go quiet before their turn is considered finished.
 *
 * Production voice agents endpoint at 200-600ms (Pipecat's
 * SpeechTimeoutUserTurnStopStrategy defaults to 0.6s; Silero VAD stop_secs
 * 0.2s; Azure semantic VAD 500ms). Those figures are tuned for fast exchanges.
 * Elderly users pause mid-thought, so this is deliberately several times
 * longer. Lower it if the assistant feels sluggish; raise it if it interrupts.
 */
export const END_OF_SPEECH_MS = 1400;

/** Delay before re-arming a session the browser closed underneath us. */
const REARM_MS = 150;

export function useSpeechRecognition(options: {
  lang: string;
  enabled: boolean;
  endOfSpeechMs?: number;
  onUtterance: (text: string) => void;
  /** Fires on every interim result — used to detect barge-in. */
  onSpeechDetected?: (interim: string) => void;
  onError?: (code: RecognitionErrorCode, message: string) => void;
}) {
  const { lang, enabled, endOfSpeechMs = END_OF_SPEECH_MS, onUtterance, onSpeechDetected, onError } =
    options;

  const [adapter] = useState<RecognitionAdapter | null>(() =>
    typeof window === "undefined" ? null : resolveRecognitionAdapter(),
  );

  const [internalStatus, setInternalStatus] = useState<ListeningStatus>("idle");
  const [interim, setInterim] = useState("");

  const onUtteranceRef = useRef(onUtterance);
  const onSpeechDetectedRef = useRef(onSpeechDetected);
  const onErrorRef = useRef(onError);
  const langRef = useRef(lang);
  const enabledRef = useRef(enabled);
  const endOfSpeechRef = useRef(endOfSpeechMs);

  const bufferRef = useRef("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rearmRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(false);
  const suspendedRef = useRef(false);

  // Latest-value mirrors, refreshed after every render.
  useEffect(() => {
    onUtteranceRef.current = onUtterance;
    onSpeechDetectedRef.current = onSpeechDetected;
    onErrorRef.current = onError;
    langRef.current = lang;
    enabledRef.current = enabled;
    endOfSpeechRef.current = endOfSpeechMs;
  });

  const clearTimers = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    if (rearmRef.current) clearTimeout(rearmRef.current);
    rearmRef.current = null;
  }, []);

  const commit = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const text = bufferRef.current.trim();
    bufferRef.current = "";
    setInterim("");
    if (text) onUtteranceRef.current(text);
  }, []);

  // Self-reference for the re-arm path: a callback cannot call itself without
  // tripping the React Compiler's immutability check.
  const startRef = useRef<() => void>(() => {});

  const start = useCallback(() => {
    if (!adapter) return;
    if (!adapter.supported) {
      // Tell the user why the microphone is inert rather than leaving a dead
      // button on screen. Deferred, so this never writes state synchronously
      // from the effect that drives the session.
      setTimeout(
        () =>
          onErrorRef.current?.(
            "unsupported",
            "Speech recognition is not available in this browser.",
          ),
        0,
      );
      return;
    }
    if (!enabledRef.current || suspendedRef.current) return;

    // Never run two sessions at once: the browser throws, and a half-open
    // session is worse than none.
    if (openRef.current) {
      adapter.abort();
      openRef.current = false;
    }

    bufferRef.current = "";
    setInterim("");
    openRef.current = true;

    adapter.start(langRef.current, {
      onStart: () => setInternalStatus("listening"),

      onInterim: (text) => {
        setInterim(text);
        onSpeechDetectedRef.current?.(text);
      },

      onFinal: (text) => {
        // Buffer rather than commit: a continuous session emits one final per
        // phrase, and we want the whole thought as a single turn.
        bufferRef.current = `${bufferRef.current} ${text}`.trim();
        setInterim("");
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(commit, endOfSpeechRef.current);
      },

      onError: (code, message) => {
        if (code === "not-allowed" || code === "service-not-allowed") {
          setInternalStatus("denied");
        } else if (code === "unsupported") {
          setInternalStatus("unsupported");
        } else if (code !== "no-speech" && code !== "aborted") {
          setInternalStatus("error");
        }
        // Silence is not an error condition here — the call simply waits.
        onErrorRef.current?.(code, message);
      },

      onEnd: () => {
        openRef.current = false;
        setInterim("");
        setInternalStatus((prev) => (prev === "listening" ? "idle" : prev));

        // The browser can close a continuous session on its own (idle timeout,
        // network blip). The call must not die with it.
        clearTimers();
        if (enabledRef.current && !suspendedRef.current) {
          rearmRef.current = setTimeout(() => {
            if (enabledRef.current && !suspendedRef.current) startRef.current();
          }, REARM_MS);
        }
      },
    });
  }, [adapter, clearTimers, commit]);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const stop = useCallback(() => {
    clearTimers();
    bufferRef.current = "";
    setInterim("");
    openRef.current = false;
    adapter?.stop();
    setInternalStatus((prev) => (prev === "denied" || prev === "unsupported" ? prev : "idle"));
  }, [adapter, clearTimers]);

  const abort = useCallback(() => {
    clearTimers();
    bufferRef.current = "";
    setInterim("");
    openRef.current = false;
    adapter?.abort();
    setInternalStatus("idle");
  }, [adapter, clearTimers]);

  /** Stop listening without changing `enabled` (used while nudging). */
  const suspend = useCallback(() => {
    suspendedRef.current = true;
    stop();
  }, [stop]);

  const resume = useCallback(() => {
    suspendedRef.current = false;
    if (enabledRef.current) start();
  }, [start]);

  // Drive the session from `enabled` / language. Runs after the mirror effect
  // above, so it always sees current values.
  useEffect(() => {
    if (!adapter) return;
    if (enabled && !suspendedRef.current) start();
    else stop();
  }, [adapter, enabled, lang, start, stop]);

  // A stray session must never outlive the component.
  useEffect(() => {
    return () => {
      clearTimers();
      adapter?.abort();
    };
  }, [adapter, clearTimers]);

  const unsupported = adapter !== null && !adapter.supported;
  const status: ListeningStatus = unsupported ? "unsupported" : internalStatus;

  /**
   * Whether the call is listening, from the user's point of view.
   *
   * The underlying session legitimately cycles — the browser can close a
   * continuous session and the hook re-arms it ~150ms later — and reflecting
   * that raw churn in the UI makes the microphone appear to switch itself off,
   * which is precisely when a hesitant user decides not to speak. So the
   * indicator follows intent (we are in a call, and listening is not revoked)
   * rather than the socket.
   */
  const listening = (adapter?.supported ?? false) && enabled && status !== "denied";

  return {
    status,
    listening,
    interim,
    start,
    stop,
    abort,
    suspend,
    resume,
    supported: adapter?.supported ?? false,
  };
}

export type TextScale = "normal" | "large" | "extraLarge";

export const TEXT_SCALE_MULTIPLIER: Record<TextScale, number> = {
  normal: 1,
  large: 1.15,
  extraLarge: 1.3,
};

export function useSpeechSynthesis(lang: string) {
  const [adapter] = useState<SynthesisAdapter | null>(() =>
    typeof window === "undefined" ? null : resolveSynthesisAdapter(),
  );

  const [voices, setVoices] = useState<SynthesisVoiceOption[]>([]);
  const [voiceURI, setVoiceURI] = useState<string | null>(null);
  /** PRD 4: a slower baseline rate for elderly listeners. */
  const [rate, setRate] = useState(0.85);
  const [pitch, setPitch] = useState(0.95);
  const [speaking, setSpeaking] = useState(false);
  /** Which engine last produced speech — surfaced in the UI. */
  const [mode, setMode] = useState<SynthesisMode>("browser");

  const settingsRef = useRef({ lang, voiceURI, rate, pitch });

  useEffect(() => {
    settingsRef.current = { lang, voiceURI, rate, pitch };
  });

  useEffect(() => {
    if (!adapter) return;
    const refresh = () => setVoices(adapter.getVoices());

    // getVoices() is empty until voiceschanged fires on most browsers, and
    // Safari needs a nudge. Both refreshes are async, which keeps this effect
    // free of synchronous state writes.
    const unsubscribe = adapter.onVoicesChanged(refresh);
    const immediate = setTimeout(refresh, 0);
    const nudge = setTimeout(refresh, 400);

    return () => {
      unsubscribe();
      clearTimeout(immediate);
      clearTimeout(nudge);
      adapter.cancel();
    };
  }, [adapter]);

  const speak = useCallback(
    async (text: string): Promise<void> => {
      if (!adapter || !text.trim()) return;
      const { lang: currentLang, voiceURI: uri, rate: r, pitch: p } = settingsRef.current;
      setSpeaking(true);
      try {
        await adapter.speak(text, { lang: currentLang, voiceURI: uri, rate: r, pitch: p });
      } finally {
        setSpeaking(false);
        setMode(adapter.mode);
      }
    },
    [adapter],
  );

  const cancel = useCallback(() => {
    adapter?.cancel();
    setSpeaking(false);
  }, [adapter]);

  return {
    supported: adapter?.supported ?? false,
    mode,
    voices: voicesForTag(voices, lang),
    allVoices: voices,
    /** True when the selected language needs a voice this device does not have. */
    missingCantoneseVoice: isCantoneseTag(lang) && !hasCantoneseVoice(voices),
    voiceURI,
    setVoiceURI,
    rate,
    setRate,
    pitch,
    setPitch,
    speaking,
    speak,
    cancel,
  };
}