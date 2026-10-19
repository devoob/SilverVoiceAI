"use client";

/**
 * Conversation orchestrator.
 *
 * Owns the call loop and the pacing rules that make it feel like a person
 * rather than a form:
 *
 *   - **The call never ends on silence.** Silence is treated as thinking, not
 *     as failure. After a long quiet spell the assistant says one reassuring
 *     line and keeps listening. Only End Call or a handover ends the call.
 *   - **Barge-in.** The microphone stays open while the assistant speaks; if
 *     the user starts talking, speech synthesis is cancelled immediately and
 *     the new turn takes over. The greeting is protected (Pipecat's
 *     FirstSpeechUserMuteStrategy pattern) so the opening line is always heard.
 *   - **Echo guard.** Barge-in is only triggered by speech that does not look
 *     like the assistant hearing itself, and self-heard finals are dropped.
 *   - **PIN safety.** The microphone is closed entirely while the PIN pad is
 *     showing, so a PIN can only ever be entered by touch.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  advance,
  initialState,
  type CardPayload,
  type DialogueState,
  type Input,
} from "@/lib/dialogue";
import { resetLedger, resetPinLock } from "@/lib/bank";
import { detectConfirmation } from "@/lib/intent";
import { resetPhrasing } from "@/lib/phrasing";
import { DEFAULT_LANGUAGE, LANGUAGE_META, strings, type Language } from "@/lib/i18n";
import type { RecognitionErrorCode } from "@/lib/speech";
import { useSpeechRecognition, useSpeechSynthesis, type ListeningStatus } from "./useSpeech";

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
};

export type AssistantPhase = "idle" | "listening" | "thinking" | "speaking";

let messageCounter = 0;
function nextId(): string {
  messageCounter += 1;
  return `m${messageCounter}`;
}

/** Pause allowed inside a user's turn before it is considered finished. */
export const END_OF_SPEECH_MS = 1400;

/** First "are you still there?" prompt. Long, because thinking takes time. */
const NUDGE_AFTER_MS = 25_000;
/** Subsequent prompts, further apart. These never end the call. */
const NUDGE_REPEAT_MS = 45_000;
/** Ignore microphone input for this long after the assistant starts talking. */
const BARGE_IN_GUARD_MS = 300;
/** Shorter than this is not a plausible interruption. */
const BARGE_IN_MIN_CHARS = 2;
/**
 * How long after the assistant stops speaking its own voice may still arrive at
 * the recogniser — acoustically, and in the browser's echo-cancellation tail.
 */
const ECHO_TAIL_MS = 8000;
/**
 * A candidate is self-hearing when it is a verbatim substring of the last
 * spoken line AND covers at least this share of it.
 *
 * Measuring the proportion is what makes this safe. The echo of a full sentence
 * covers most of it, while a genuine reply — "yes", "pay it now", "water bill" —
 * is a fragment too small a fraction of a whole sentence to be the assistant
 * hearing itself. A plain substring test would swallow those.
 */
const ECHO_OVERLAP_THRESHOLD = 0.25;
/** Any verbatim run this long is self-hearing whatever the proportion. */
const ECHO_VERBATIM_CHARS = 14;

function comparable(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

/**
 * True when a recognised fragment is probably the assistant hearing its own
 * voice rather than the user interrupting. The spoken line is known, so a
 * partial pickup shows up as a substring of it.
 */
function looksLikeEcho(candidate: string, spoken: string): boolean {
  const c = comparable(candidate);
  const s = comparable(spoken);
  if (c.length < BARGE_IN_MIN_CHARS) return true;
  if (!s) return false;
  return s.includes(c) || c.includes(s);
}

/**
 * Proportion-aware self-hearing test, used in the window around the assistant's
 * own speech. Returns true only when the candidate is a verbatim part of what
 * was just said *and* large enough to be that speech rather than a reply to it.
 */
function looksLikeEchoTail(candidate: string, spoken: string): boolean {
  const c = comparable(candidate);
  const s = comparable(spoken);
  if (!c || !s) return false;
  if (!s.includes(c)) return false;
  return c.length / s.length >= ECHO_OVERLAP_THRESHOLD || c.length >= ECHO_VERBATIM_CHARS;
}

export function useAssistant() {
  const [language, setLanguage] = useState<Language>(DEFAULT_LANGUAGE);
  const [messages, setMessages] = useState<Message[]>([]);
  const [dialogue, setDialogue] = useState<DialogueState>(initialState);
  const [card, setCard] = useState<CardPayload | null>(null);
  const [phase, setPhase] = useState<AssistantPhase>("idle");
  const [inCall, setInCall] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** True when the user has paused listening without ending the call. */
  const [paused, setPaused] = useState(false);

  const t = strings(language);
  const langRef = useRef(language);
  const dialogueRef = useRef(dialogue);
  const inCallRef = useRef(inCall);
  const pausedRef = useRef(paused);

  // Speech-state mirrors used by the barge-in logic.
  const speakingRef = useRef(false);
  const spokenTextRef = useRef("");
  const spokenEndedAtRef = useRef(0);
  const protectSpeechRef = useRef(false);
  const bargeInGuardUntilRef = useRef(0);

  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudgeCountRef = useRef(0);

  // Latest-value mirrors, refreshed after render. Written here rather than in
  // the render body because the React Compiler forbids ref writes during
  // render, and because the call loop reads them from timers and callbacks.
  useEffect(() => {
    langRef.current = language;
    dialogueRef.current = dialogue;
    inCallRef.current = inCall;
    pausedRef.current = paused;
  });

  const synthesis = useSpeechSynthesis(LANGUAGE_META[language].ttsTag);
  const { speak, cancel: cancelSpeech } = synthesis;

  /**
   * The microphone is closed during the PIN pad (a PIN must never be spoken)
   * and during a human handover. Otherwise it stays open for the whole call —
   * including while the assistant is talking, which is what enables barge-in.
   */
  const listeningEnabled =
    inCall && !paused && dialogue.phase !== "awaiting_pin" && dialogue.phase !== "handover";

  const recognition = useSpeechRecognition({
    lang: LANGUAGE_META[language].sttTag,
    enabled: listeningEnabled,
    endOfSpeechMs: END_OF_SPEECH_MS,
    onUtterance: (text) => void handleUtterance(text),
    onSpeechDetected: (interim) => handleSpeechDetected(interim),
    onError: (code) => handleRecognitionError(code),
  });

  const speakRef = useRef(speak);
  const recognitionRef = useRef(recognition);

  useEffect(() => {
    speakRef.current = speak;
    recognitionRef.current = recognition;
  });

  const pushMessage = useCallback((role: Message["role"], text: string) => {
    setMessages((prev) => [...prev, { id: nextId(), role, text, at: Date.now() }]);
  }, []);

  // --- Nudges: reassurance, never a hangup ---------------------------------

  const clearNudge = useCallback(() => {
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = null;
  }, []);

  // Mutual references between arming and firing a nudge, routed through refs so
  // neither callback has to call the other before it is declared.
  const armNudgeRef = useRef<() => void>(() => {});
  const fireNudgeRef = useRef<() => Promise<void>>(async () => {});

  const armNudge = useCallback(() => {
    clearNudge();
    if (!inCallRef.current || pausedRef.current) return;
    if (dialogueRef.current.phase === "awaiting_pin") return;
    if (dialogueRef.current.phase === "handover") return;

    const delay = nudgeCountRef.current === 0 ? NUDGE_AFTER_MS : NUDGE_REPEAT_MS;
    nudgeTimerRef.current = setTimeout(() => {
      void fireNudgeRef.current();
    }, delay);
  }, [clearNudge]);

  const fireNudge = useCallback(async () => {
    if (!inCallRef.current || pausedRef.current) return;
    nudgeCountRef.current += 1;

    // Close the mic while the reassurance plays, then hand it straight back.
    recognitionRef.current.suspend();
    try {
      await speakRef.current(strings(langRef.current).mic.nudge);
    } finally {
      recognitionRef.current.resume();
    }
    armNudgeRef.current();
  }, []);

  useEffect(() => {
    armNudgeRef.current = armNudge;
    fireNudgeRef.current = fireNudge;
  }, [armNudge, fireNudge]);

  // --- Turn handling -------------------------------------------------------

  const chainRef = useRef<Promise<unknown>>(Promise.resolve());

  const applyResult = useCallback(
    async (result: Awaited<ReturnType<typeof advance>>) => {
      setDialogue(result.state);
      setCard(result.card);
      dialogueRef.current = result.state;

      if (!result.speak) {
        setPhase("idle");
        armNudge();
        return;
      }

      pushMessage("assistant", result.display);
      setPhase("speaking");
      spokenTextRef.current = result.speak;
      speakingRef.current = true;
      bargeInGuardUntilRef.current = Date.now() + BARGE_IN_GUARD_MS;

      try {
        await speak(result.speak);
      } finally {
        speakingRef.current = false;
        // The text is deliberately retained so the echo window below can
        // recognise the assistant's own voice still arriving at the mic.
        spokenEndedAtRef.current = Date.now();
      }

      setPhase("idle");
      armNudge();
    },
    [armNudge, pushMessage, speak],
  );

  const run = useCallback(
    (input: Input): Promise<void> => {
      const task = chainRef.current.then(async () => {
        setPhase("thinking");
        setNotice(null);
        try {
          const result = await advance(dialogueRef.current, input, langRef.current);
          await applyResult(result);
        } catch {
          setPhase("idle");
          setNotice(strings(langRef.current).errors.generic);
        }
      });
      // A throwing turn must not poison every turn after it.
      chainRef.current = task.catch(() => undefined);
      return task;
    },
    [applyResult],
  );

  async function handleUtterance(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Guard against the microphone transcribing the assistant's own voice —
    // both while it is talking and for a tail afterwards.
    const withinEchoTail =
      speakingRef.current || Date.now() - spokenEndedAtRef.current < ECHO_TAIL_MS;
    if (withinEchoTail && looksLikeEchoTail(trimmed, spokenTextRef.current)) {
      /**
       * Never suppress an answer to a question. A confirmation such as "yes",
       * "係" or "pay it now" may coincidentally appear in the assistant's last
       * line, and dropping it would strand the user mid-transaction — a far
       * worse failure than tolerating one echoed phrase.
       */
      const isAnswer = detectConfirmation(trimmed) !== "unclear";
      if (!isAnswer) return;
    }

    nudgeCountRef.current = 0;
    clearNudge();
    pushMessage("user", trimmed);
    await run({ kind: "utterance", text: trimmed });
  }

  /**
   * Barge-in. Called on every interim result, including while the assistant is
   * speaking; anything that is not self-hearing stops the speech immediately.
   */
  function handleSpeechDetected(interim: string) {
    if (!inCallRef.current) return;
    if (!speakingRef.current) return;
    // The opening line is protected so it is always heard in full.
    if (protectSpeechRef.current) return;
    if (Date.now() < bargeInGuardUntilRef.current) return;
    if (looksLikeEcho(interim, spokenTextRef.current)) return;

    speakingRef.current = false;
    cancelSpeech();
  }

  function handleRecognitionError(code: RecognitionErrorCode) {
    if (code === "not-allowed" || code === "service-not-allowed") {
      setInCall(false);
      setNotice(t.mic.permissionDenied);
      return;
    }
    if (code === "unsupported") {
      setInCall(false);
      setNotice(t.mic.unsupported);
      return;
    }
    // Silence, a network blip or an aborted session: the recognition hook
    // re-arms itself. Deliberately nothing here — silence must never end a call.
  }

  // --- Call lifecycle ------------------------------------------------------

  const startCall = useCallback(async () => {
    resetLedger();
    resetPinLock();
    // Start each call from the first realisation: a live demo then replays
    // identically from the top, while still varying as the call goes on.
    resetPhrasing();
    setMessages([]);
    setCard(null);
    setDialogue(initialState);
    dialogueRef.current = initialState;
    setPaused(false);
    pausedRef.current = false;
    setInCall(true);
    inCallRef.current = true;
    setNotice(null);
    nudgeCountRef.current = 0;
    cancelSpeech();
    clearNudge();

    // Natural opening, then listen. The greeting is barge-in protected.
    protectSpeechRef.current = true;
    try {
      const result = await advance(
        initialState,
        { kind: "utterance", text: language === "english" ? "hello" : "你好" },
        language,
      );
      await applyResult(result);
    } finally {
      protectSpeechRef.current = false;
    }
    armNudge();
  }, [applyResult, armNudge, cancelSpeech, clearNudge, language]);

  const endCall = useCallback(() => {
    clearNudge();
    setInCall(false);
    inCallRef.current = false;
    setPaused(false);
    pausedRef.current = false;
    speakingRef.current = false;
    recognition.abort();
    cancelSpeech();
    setPhase("idle");
  }, [cancelSpeech, clearNudge, recognition]);

  /** Pause or resume listening without ending the call. */
  const toggleListen = useCallback(() => {
    if (!inCall) {
      void startCall();
      return;
    }
    if (paused) {
      setPaused(false);
      pausedRef.current = false;
      recognition.resume();
      armNudge();
    } else {
      clearNudge();
      setPaused(true);
      pausedRef.current = true;
      recognition.suspend();
    }
  }, [armNudge, clearNudge, inCall, paused, recognition, startCall]);

  const submitText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      nudgeCountRef.current = 0;
      clearNudge();
      pushMessage("user", trimmed);
      await run({ kind: "utterance", text: trimmed });
    },
    [clearNudge, pushMessage, run],
  );

  const submitPin = useCallback(
    async (pin: string) => {
      await run({ kind: "pin", pin });
    },
    [run],
  );

  const selectBill = useCallback(
    async (billId: string) => {
      await run({ kind: "select_bill", billId });
    },
    [run],
  );

  const uiConfirm = useCallback(async () => {
    await run({ kind: "ui", event: "confirm" });
  }, [run]);

  const uiDeny = useCallback(async () => {
    await run({ kind: "ui", event: "deny" });
  }, [run]);

  const uiHandover = useCallback(async () => {
    await run({ kind: "ui", event: "handover" });
  }, [run]);

  const uiResume = useCallback(async () => {
    await run({ kind: "ui", event: "resume" });
  }, [run]);

  // Leaving the page mid-call should never leave audio playing.
  useEffect(() => {
    return () => cancelSpeech();
  }, [cancelSpeech]);

  return {
    language,
    setLanguage,
    strings: t,
    messages,
    card,
    dialogue,
    phase,
    inCall,
    paused,
    notice,
    requiresPin: dialogue.phase === "awaiting_pin",
    awaitingUser: dialogue.phase !== "idle",
    recognition,
    synthesis,
    listeningStatus: recognition.status as ListeningStatus,
    /** True whenever the call is listening, ignoring session churn. */
    listening: recognition.listening,
    interim: recognition.interim,
    startCall,
    endCall,
    toggleListen,
    submitText,
    submitPin,
    selectBill,
    uiConfirm,
    uiDeny,
    uiHandover,
    uiResume,
    resetDemo: () => {
      resetLedger();
      resetPinLock();
      resetPhrasing();
      clearNudge();
      nudgeCountRef.current = 0;
      setMessages([]);
      setCard(null);
      setDialogue(initialState);
      dialogueRef.current = initialState;
      setNotice(null);
      setPaused(false);
      pausedRef.current = false;
    },
  };
}

export type Assistant = ReturnType<typeof useAssistant>;