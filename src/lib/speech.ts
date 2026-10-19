/**
 * Speech I/O abstraction.
 *
 * The Web Speech API is used directly for recognition, but it is hidden behind
 * an adapter interface because:
 *
 *   1. It is absent from headless Chromium, so the E2E suite injects a scripted
 *      adapter to drive a complete end-to-end "call".
 *   2. It is the swap point for the offline sherpa-onnx WASM engine and the
 *      speech-to-speech models documented in remaining.md.
 *
 * Synthesis has a third reason. **Browsers ship no reliable Cantonese voice.**
 * When no `zh-HK` voice is installed, a naive implementation falls back to a
 * Mandarin (`zh-CN`) voice, which reads Cantonese text aloud as Putonghua.
 * Two defences are implemented here:
 *
 *   - `pickBestVoice` is *strict* for Cantonese: it will return nothing rather
 *     than hand Cantonese text to a Mandarin voice.
 *   - `SidecarSynthesisAdapter` can call a local open-source Cantonese engine
 *     (CosyVoice 3, Apache-2.0) through `/api/tts`, with the browser voice as a
 *     fallback. See scripts/tts-sidecar.sh.
 */

// --- Minimal Web Speech API typings (not in lib.dom) -------------------------

type RecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string; confidence: number };
    length: number;
  }>;
};

type RecognitionErrorEventLike = { error: string; message?: string };

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
    /** Injected by the E2E suite and by the in-app speech simulator. */
    __SILVERVOICE_SPEECH__?: RecognitionAdapter;
    __SILVERVOICE_SYNTHESIS__?: SynthesisAdapter;
  }
}

export type RecognitionCallbacks = {
  onStart?: () => void;
  onInterim?: (text: string) => void;
  /** Fires for EVERY final chunk. A continuous session can emit several. */
  onFinal?: (text: string, confidence: number) => void;
  onError?: (code: RecognitionErrorCode, message: string) => void;
  onEnd?: () => void;
};

export type RecognitionErrorCode =
  | "unsupported"
  | "not-allowed"
  | "service-not-allowed"
  | "no-speech"
  | "audio-capture"
  | "network"
  | "aborted"
  | "language-not-supported"
  | "unknown";

export interface RecognitionAdapter {
  readonly id: string;
  readonly supported: boolean;
  /** BCP-47 tag, e.g. "zh-HK". */
  start(lang: string, callbacks: RecognitionCallbacks): void;
  stop(): void;
  abort(): void;
}

// --- Web Speech API adapter -------------------------------------------------

function normaliseError(error: string): RecognitionErrorCode {
  switch (error) {
    case "not-allowed":
      return "not-allowed";
    case "service-not-allowed":
      return "service-not-allowed";
    case "no-speech":
      return "no-speech";
    case "audio-capture":
      return "audio-capture";
    case "network":
      return "network";
    case "aborted":
      return "aborted";
    case "language-not-supported":
      return "language-not-supported";
    default:
      return "unknown";
  }
}

export class WebSpeechRecognitionAdapter implements RecognitionAdapter {
  readonly id = "web-speech";
  readonly supported: boolean;

  private recognition: SpeechRecognitionLike | null = null;
  private callbacks: RecognitionCallbacks = {};
  private manuallyStopped = false;

  constructor() {
    this.supported =
      typeof window !== "undefined" &&
      Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
  }

  start(lang: string, callbacks: RecognitionCallbacks): void {
    if (!this.supported) {
      callbacks.onError?.("unsupported", "SpeechRecognition is not available in this browser.");
      return;
    }
    const Ctor = (window.SpeechRecognition ?? window.webkitSpeechRecognition)!;

    this.callbacks = callbacks;
    this.manuallyStopped = false;

    const recognition = new Ctor();
    recognition.lang = lang;
    /**
     * Continuous is essential for "give me time to think". With
     * continuous = false the browser closes the session at the user's first
     * pause, so a considered speaker loses the second half of their sentence.
     * With continuous = true the session survives those pauses, and the hook
     * decides when a turn has actually ended (see END_OF_SPEECH_MS).
     */
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => callbacks.onStart?.();

    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";
      let confidence = 0;

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const alternative = result[0];
        if (result.isFinal) {
          finalText += alternative.transcript;
          confidence = Math.max(confidence, alternative.confidence);
        } else {
          interim += alternative.transcript;
        }
      }

      if (interim) callbacks.onInterim?.(interim);
      if (finalText.trim()) callbacks.onFinal?.(finalText.trim(), confidence);
    };

    recognition.onerror = (event) => {
      callbacks.onError?.(normaliseError(event.error), event.message ?? event.error);
    };

    recognition.onend = () => {
      this.recognition = null;
      callbacks.onEnd?.();
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      // start() throws if a session is already running; recover by resetting.
      this.recognition = null;
      callbacks.onError?.("unknown", "Recognition could not start.");
    }
  }

  stop(): void {
    this.manuallyStopped = true;
    this.recognition?.stop();
  }

  abort(): void {
    this.manuallyStopped = true;
    this.recognition?.abort();
  }
}

// --- Scripted adapter for tests and the on-screen demo simulator -------------

/**
 * A deterministic adapter that replays a queue of utterances. Used by the
 * Playwright suite (headless Chromium has no Web Speech API) and available in
 * the browser for rehearsal when no microphone is present.
 */
export class ScriptedRecognitionAdapter implements RecognitionAdapter {
  readonly id = "scripted";
  readonly supported = true;

  private queue: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private callbacks: RecognitionCallbacks = {};
  private stopped = false;

  /** Queue a line to be "heard" on the next start(). */
  say(text: string): this {
    this.queue.push(text);
    return this;
  }

  clear(): void {
    this.queue = [];
  }

  start(_lang: string, callbacks: RecognitionCallbacks): void {
    this.callbacks = callbacks;
    this.stopped = false;
    callbacks.onStart?.();

    /**
     * Continuous, like a real session: emit a final per queued line and keep
     * the session open for the next one. Ending the session after each line
     * would not model `continuous = true`, and the turn boundary is the hook's
     * job (END_OF_SPEECH_MS), not the adapter's.
     */
    const poll = () => {
      if (this.stopped) return;
      const next = this.queue.shift();
      if (next === undefined) {
        this.timer = setTimeout(poll, 20);
        return;
      }
      callbacks.onInterim?.(next);
      this.timer = setTimeout(() => {
        if (this.stopped) return;
        callbacks.onFinal?.(next, 0.95);
        poll();
      }, 20);
    };

    this.timer = setTimeout(poll, 10);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.callbacks.onEnd?.();
  }

  abort(): void {
    this.stop();
  }
}

export function resolveRecognitionAdapter(): RecognitionAdapter {
  if (typeof window !== "undefined" && window.__SILVERVOICE_SPEECH__) {
    return window.__SILVERVOICE_SPEECH__;
  }
  return new WebSpeechRecognitionAdapter();
}

// --- Voice selection --------------------------------------------------------

export type SynthesisVoiceOption = {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
};

type AnyVoice = SpeechSynthesisVoice | SynthesisVoiceOption;

const CANTONESE_LANG = /^(zh[-_]hk|zh[-_]mo|yue)/i;
/** macOS/iOS/Windows Cantonese voice names, used as a secondary signal. */
const CANTONESE_NAME = /(sinji|sin-?jing|hiugaai|hiumaan|wanlung|cantonese|粵|粤)/i;
const MANDARIN_LANG = /^zh([-_](cn|sg|hans))?$/i;

export function isCantoneseTag(lang: string): boolean {
  return CANTONESE_LANG.test(lang) || lang.toLowerCase().startsWith("yue");
}

/** True when a voice is genuinely Cantonese (not Mandarin wearing a zh tag). */
export function isCantoneseVoice(voice: AnyVoice): boolean {
  if (CANTONESE_LANG.test(voice.lang)) return true;
  // A voice whose tag is plainly Mandarin is never Cantonese, whatever it is called.
  if (MANDARIN_LANG.test(voice.lang)) return false;
  return CANTONESE_NAME.test(voice.name);
}

export function hasCantoneseVoice(voices: SynthesisVoiceOption[]): boolean {
  return voices.some(isCantoneseVoice);
}

/**
 * Choose the best available voice for a tag.
 *
 * Strict for Cantonese: returning `undefined` is strictly better than handing
 * Cantonese text to a Mandarin voice, because that is precisely the bug where
 * the assistant "speaks Putonghua instead of 廣東話".
 */
export function pickBestVoice<T extends AnyVoice>(voices: T[], lang: string): T | undefined {
  if (voices.length === 0) return undefined;

  if (isCantoneseTag(lang)) {
    const cantonese = voices.filter(isCantoneseVoice);
    if (cantonese.length === 0) return undefined;
    return cantonese.find((v) => "localService" in v && v.localService) ?? cantonese[0];
  }

  const tag = lang.toLowerCase();
  const exact = voices.filter((v) => v.lang.toLowerCase() === tag);
  const prefix = voices.filter((v) => v.lang.toLowerCase().startsWith(tag.split("-")[0]));
  const candidates = exact.length > 0 ? exact : prefix;
  if (candidates.length === 0) return voices[0];
  return candidates.find((v) => "localService" in v && v.localService) ?? candidates[0];
}

export function voicesForTag(voices: SynthesisVoiceOption[], lang: string): SynthesisVoiceOption[] {
  if (isCantoneseTag(lang)) {
    // Only real Cantonese voices. Showing Mandarin here is what let the user
    // pick one and hear Putonghua.
    return voices.filter(isCantoneseVoice);
  }
  const tag = lang.toLowerCase();
  const primary = tag.split("-")[0];
  const matches = voices.filter((v) => {
    const vl = v.lang.toLowerCase();
    return vl === tag || vl.startsWith(`${primary}-`) || vl === primary;
  });
  return matches.length > 0 ? matches : voices;
}

// --- Speech synthesis -------------------------------------------------------

export type SynthesisMode = "local" | "browser" | "silent";

export interface SynthesisAdapter {
  readonly id: string;
  readonly supported: boolean;
  /** Which engine actually produced the last utterance. Drives the UI label. */
  readonly mode: SynthesisMode;
  getVoices(): SynthesisVoiceOption[];
  onVoicesChanged(handler: () => void): () => void;
  speak(text: string, options: SynthesisOptions): Promise<void>;
  cancel(): void;
  readonly speaking: boolean;
}

export type SynthesisOptions = {
  lang: string;
  voiceURI?: string | null;
  rate: number;
  pitch: number;
  volume?: number;
};

/**
 * Chrome pauses long utterances after ~15s and never resumes, and some
 * environments accept speak() but never fire onend at all. Two guards:
 *
 *  - A keep-alive ping for genuinely long speech.
 *  - A liveness check: if the engine never reports `speaking`, there is no
 *    audio to wait for, so the turn is released rather than stalling the call.
 */
export class WebSpeechSynthesisAdapter implements SynthesisAdapter {
  readonly id = "web-synthesis";
  readonly mode = "browser" as const;
  readonly supported: boolean;
  private current: SpeechSynthesisUtterance | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.supported = typeof window !== "undefined" && "speechSynthesis" in window;
  }

  get speaking(): boolean {
    return this.supported && window.speechSynthesis.speaking;
  }

  getVoices(): SynthesisVoiceOption[] {
    if (!this.supported) return [];
    return window.speechSynthesis.getVoices().map((v) => ({
      name: v.name,
      lang: v.lang,
      voiceURI: v.voiceURI,
      localService: v.localService,
    }));
  }

  onVoicesChanged(handler: () => void): () => void {
    if (!this.supported) return () => {};
    window.speechSynthesis.addEventListener("voiceschanged", handler);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", handler);
  }

  speak(text: string, options: SynthesisOptions): Promise<void> {
    if (!this.supported || !text.trim()) return Promise.resolve();

    this.cancel();

    return new Promise<void>((resolve) => {
      const voices = window.speechSynthesis.getVoices();
      const voicesNow = voices.length;
      const estimatedMs =
        voicesNow === 0
          ? 600
          : Math.min(20_000, Math.max(4000, (text.length / Math.max(0.4, options.rate)) * 220));

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = options.lang;
      utterance.rate = options.rate;
      utterance.pitch = options.pitch;
      utterance.volume = options.volume ?? 1;

      const chosen =
        (options.voiceURI ? voices.find((v) => v.voiceURI === options.voiceURI) : undefined) ??
        pickBestVoice(voices, options.lang);
      // Undefined for Cantonese with no Cantonese voice installed. Leaving the
      // voice unset lets the engine match on `lang`, which is better than
      // explicitly attaching a Mandarin voice.
      if (chosen) utterance.voice = chosen;

      let settled = false;
      let watchdog: ReturnType<typeof setTimeout> | null = null;
      let liveness: ReturnType<typeof setInterval> | null = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (watchdog) clearTimeout(watchdog);
        if (liveness) clearInterval(liveness);
        if (this.keepAlive) {
          clearInterval(this.keepAlive);
          this.keepAlive = null;
        }
        this.current = null;
        resolve();
      };

      utterance.onend = finish;
      utterance.onerror = finish;

      this.current = utterance;
      this.keepAlive = setInterval(() => {
        if (!window.speechSynthesis.speaking) return;
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }, 10_000);

      const startedAt = Date.now();
      liveness = setInterval(() => {
        const synth = window.speechSynthesis;
        if (synth.speaking || synth.pending) return;
        if (Date.now() - startedAt > 750) finish();
      }, 250);

      watchdog = setTimeout(finish, estimatedMs);
      window.speechSynthesis.speak(utterance);
    });
  }

  cancel(): void {
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
    if (!this.supported) return;
    this.current = null;
    window.speechSynthesis.cancel();
  }
}

/** How long to wait for the local engine before treating it as unavailable. */
const SIDECAR_TIMEOUT_MS = 15_000;
/** After a failure, stop trying the sidecar for this long. */
const SIDECAR_COOLDOWN_MS = 60_000;

/**
 * Whether the local engine answered the last health probe. `null` means it has
 * not been probed yet.
 *
 * When it is known to be down the app does not even attempt a request: a
 * machine without the sidecar then pays no round-trip per sentence and logs no
 * failed fetch for what is a perfectly normal configuration.
 */
let sidecarAvailable: boolean | null = null;

export function setSidecarAvailability(available: boolean): void {
  sidecarAvailable = available;
}

export function getSidecarAvailability(): boolean | null {
  return sidecarAvailable;
}

/**
 * Local open-source Cantonese engine (CosyVoice 3 by default).
 *
 * The browser has no reliable Cantonese voice, so this posts to `/api/tts`,
 * which proxies to a locally running engine, and plays the returned audio.
 * Failure is thrown rather than swallowed, so the fallback adapter can take
 * over on the very same utterance.
 */
export class SidecarSynthesisAdapter implements SynthesisAdapter {
  readonly id = "local-sidecar";
  readonly mode = "local" as const;
  readonly supported: boolean;

  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private speakingFlag = false;
  private release: (() => void) | null = null;

  constructor() {
    this.supported =
      typeof window !== "undefined" &&
      typeof fetch === "function" &&
      typeof Audio !== "undefined" &&
      typeof URL?.createObjectURL === "function";
  }

  get speaking(): boolean {
    return this.speakingFlag;
  }

  getVoices(): SynthesisVoiceOption[] {
    // Timbre selection lives on the sidecar; the browser list drives the picker.
    return [];
  }

  onVoicesChanged(): () => void {
    return () => {};
  }

  async speak(text: string, options: SynthesisOptions): Promise<void> {
    if (!this.supported) throw new Error("sidecar unsupported");
    if (!text.trim()) return;

    this.cancel();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SIDECAR_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          lang: options.lang,
          rate: options.rate,
          pitch: options.pitch,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error(`local tts unavailable (${response.status})`);

    const blob = await response.blob();
    if (blob.size < 128) throw new Error("local tts returned no audio");

    const url = URL.createObjectURL(blob);
    this.objectUrl = url;

    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(url);
      this.audio = audio;
      this.speakingFlag = true;

      const done = () => {
        this.speakingFlag = false;
        this.release = null;
        resolve();
      };
      this.release = done;

      audio.onended = done;
      audio.onerror = () => {
        this.speakingFlag = false;
        this.release = null;
        reject(new Error("local tts playback failed"));
      };

      audio.play().catch((error) => {
        this.speakingFlag = false;
        this.release = null;
        reject(error instanceof Error ? error : new Error("playback blocked"));
      });
    });
  }

  cancel(): void {
    // A cancelled utterance resolves rather than rejects: barge-in is a normal
    // event, not an error, and the call must keep flowing.
    if (this.release) {
      const release = this.release;
      this.release = null;
      release();
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.speakingFlag = false;
  }
}

/**
 * Tries the local Cantonese engine first, then the browser voice. A sidecar
 * failure is remembered for a cooldown so a server that is simply not running
 * does not cost a failed round-trip on every sentence.
 */
export class FallbackSynthesisAdapter implements SynthesisAdapter {
  readonly id = "fallback";
  private cooldownUntil = 0;
  private activeMode: SynthesisMode;

  constructor(
    private readonly primary: SynthesisAdapter,
    private readonly fallback: SynthesisAdapter,
  ) {
    this.activeMode = fallback.mode;
  }

  get mode(): SynthesisMode {
    return this.activeMode;
  }

  get supported(): boolean {
    return this.primary.supported || this.fallback.supported;
  }

  get speaking(): boolean {
    return this.primary.speaking || this.fallback.speaking;
  }

  getVoices(): SynthesisVoiceOption[] {
    return this.fallback.getVoices();
  }

  onVoicesChanged(handler: () => void): () => void {
    return this.fallback.onVoicesChanged(handler);
  }

  async speak(text: string, options: SynthesisOptions): Promise<void> {
    const now = Date.now();
    const probeSaysDown = sidecarAvailable === false;

    if (this.primary.supported && !probeSaysDown && now >= this.cooldownUntil) {
      try {
        await this.primary.speak(text, options);
        this.activeMode = this.primary.mode;
        return;
      } catch {
        sidecarAvailable = false;
        this.cooldownUntil = now + SIDECAR_COOLDOWN_MS;
      }
    }
    await this.fallback.speak(text, options);
    this.activeMode = this.fallback.mode;
  }

  cancel(): void {
    this.primary.cancel();
    this.fallback.cancel();
  }
}

/** No-op synthesis for headless environments; records what would be spoken. */
export class SilentSynthesisAdapter implements SynthesisAdapter {
  readonly id = "silent";
  readonly mode = "silent" as const;
  readonly supported = true;
  readonly spoken: string[] = [];
  private isSpeaking = false;

  get speaking(): boolean {
    return this.isSpeaking;
  }

  getVoices(): SynthesisVoiceOption[] {
    return [];
  }

  onVoicesChanged(): () => void {
    return () => {};
  }

  speak(text: string): Promise<void> {
    if (!text.trim()) return Promise.resolve();
    this.spoken.push(text);
    this.isSpeaking = true;
    return new Promise((resolve) => {
      setTimeout(() => {
        this.isSpeaking = false;
        resolve();
      }, 10);
    });
  }

  cancel(): void {
    this.isSpeaking = false;
  }
}

export function resolveSynthesisAdapter(): SynthesisAdapter {
  if (typeof window !== "undefined" && window.__SILVERVOICE_SYNTHESIS__) {
    return window.__SILVERVOICE_SYNTHESIS__;
  }

  const browser = new WebSpeechSynthesisAdapter();
  const sidecar = new SidecarSynthesisAdapter();

  if (!browser.supported) {
    return sidecar.supported ? sidecar : new SilentSynthesisAdapter();
  }
  return sidecar.supported ? new FallbackSynthesisAdapter(sidecar, browser) : browser;
}