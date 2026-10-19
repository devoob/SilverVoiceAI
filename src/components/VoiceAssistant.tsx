"use client";

/**
 * SilverVoice AI — main screen.
 *
 * Layout is a single column with exactly one primary action (the microphone),
 * a permanently visible human-handover escape hatch, and everything else
 * subordinate. No navigation, no menu tree: the PRD's core claim is that an
 * elderly user never has to work out where anything is.
 */

import { useEffect, useMemo, useState } from "react";
import { Headset, RotateCcw, Send, Sparkles } from "lucide-react";
import { useAssistant } from "@/hooks/useAssistant";
import { TEXT_SCALE_MULTIPLIER, type TextScale } from "@/hooks/useSpeech";
import { isLanguage, LANGUAGE_META } from "@/lib/i18n";
import { setSidecarAvailability } from "@/lib/speech";
import { applyTextScale } from "@/lib/utils";
import { BankCard } from "./BankCards";
import { MicButton, Waveform, type MicState } from "./MicButton";
import { PinPad } from "./PinPad";
import { SettingsPanel } from "./SettingsPanel";
import { Transcript } from "./Transcript";
import { Button } from "./ui";

/** Where the user's language choice is remembered between visits. */
const LANGUAGE_STORAGE_KEY = "silvervoice.language";

export function VoiceAssistant() {
  const assistant = useAssistant();
  const {
    language,
    setLanguage,
    strings: t,
    messages,
    card,
    phase,
    inCall,
    paused,
    notice,
    requiresPin,
    recognition,
    synthesis,
    listening,
    interim,
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
    resetDemo,
  } = assistant;

  const [textScale, setTextScale] = useState<TextScale>("normal");
  const [draft, setDraft] = useState("");
  /**
   * Whether the local open-source Cantonese engine answered a health probe.
   * Checked before showing the "no Cantonese voice" warning, so a user who has
   * the sidecar running is never nagged.
   */
  const [sidecarReady, setSidecarReady] = useState(false);

  useEffect(() => {
    applyTextScale(TEXT_SCALE_MULTIPLIER[textScale]);
  }, [textScale]);

  // Keep <html lang> in step with the spoken language so screen readers pick
  // the right pronunciation rules for Cantonese vs Putonghua vs English.
  useEffect(() => {
    document.documentElement.lang = LANGUAGE_META[language].htmlLang;
  }, [language]);

  // Restore the language the user chose. Deliberately deferred to a timeout so
  // the first client render still matches the server (no hydration mismatch),
  // and so the effect body never writes state synchronously.
  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (!isLanguage(saved)) return;
    const id = setTimeout(() => setLanguage(saved), 0);
    return () => clearTimeout(id);
    // Runs once on mount; setLanguage is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember the choice so it survives a reload — English is the default only
  // until somebody changes it.
  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  /**
   * Probe the local Cantonese engine, and re-probe whenever the language
   * changes — the usual sequence is "notice the voice is wrong, start the
   * sidecar, switch language", and the switch is the natural moment to retry.
   * The result is shared with the synthesis adapter so a machine without the
   * engine never attempts a request at all.
   */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/tts", { method: "GET" })
      .then((res) => (res.ok ? res.json() : { available: false }))
      .then((data: { available?: boolean }) => {
        if (cancelled) return;
        const available = Boolean(data.available);
        setSidecarReady(available);
        setSidecarAvailability(available);
      })
      .catch(() => {
        if (cancelled) return;
        setSidecarReady(false);
        setSidecarAvailability(false);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  /**
   * Only warn about a missing Cantonese voice when there is genuinely no
   * Cantonese source: the local engine is not running, and the device has no
   * zh-HK voice. Otherwise the user would be nagged while it is working fine.
   */
  const voiceWarning =
    language === "cantonese" && synthesis.missingCantoneseVoice && !sidecarReady
      ? t.settings.noCantoneseVoice
      : null;

  const engineLabel =
    synthesis.mode === "local"
      ? t.settings.engineLocal
      : synthesis.mode === "silent"
        ? t.settings.engineSilent
        : t.settings.engineBrowser;

  /**
   * Surface a failed PIN attempt visually as well as by voice. The initial
   * prompt is the only assistant line that contains the secure note, so any
   * other line while the pad is open is an error worth displaying.
   */
  const pinError = useMemo(() => {
    if (!requiresPin) return null;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.text;
    if (!lastAssistant) return null;
    if (lastAssistant.includes(t.pin.secureNote)) return null;
    return lastAssistant;
  }, [messages, requiresPin, t.pin.secureNote]);

  const micState: MicState = useMemo(() => {
    if (recognition.status === "denied" || recognition.status === "unsupported") return "disabled";
    if (paused) return "idle";
    if (phase === "thinking") return "thinking";
    if (phase === "speaking" || synthesis.speaking) return "speaking";
    if (listening) return "listening";
    return "idle";
  }, [phase, paused, recognition.status, synthesis.speaking, listening]);

  const locale = language === "english" ? "en" : "zh";

  const bankLabels = useMemo(
    () => ({
      confirmYes: t.cards.confirmYes,
      confirmNo: t.cards.confirmNo,
      payNow: t.cards.payNow,
      billDue: t.cards.billDue,
      pendingBills: t.cards.pendingBills,
      noPendingBills: t.cards.noPendingBills,
      balanceTitle: t.cards.balanceTitle,
      availableBalance: t.cards.availableBalance,
      accountEnding: t.cards.accountEnding,
      savingsTip: t.cards.savingsTip,
      transferTitle: t.cards.transferTitle,
      amount: t.cards.amount,
      recipient: t.cards.recipient,
      reference: t.cards.reference,
      receiptTitle: t.cards.receiptTitle,
      billPaid: t.cards.billPaid,
      transferComplete: t.cards.transferComplete,
      status: t.cards.status,
      transactionId: t.cards.transactionId,
      completedAt: t.cards.completedAt,
      newBalance: t.cards.newBalance,
      handoverTitle: t.cards.handoverTitle,
      handoverBody: t.cards.handoverBody,
      callHotline: t.cards.callHotline,
      callFamily: t.cards.callFamily,
      backToAssistant: t.cards.backToAssistant,
      scamProceed: t.scam.proceed,
      scamStop: t.scam.stop,
      scamFirstTime: t.scam.firstTime,
      scamHighAmount: t.scam.highAmount,
      scamAdvice: t.scam.advice,
      scamTitle: t.scam.title,
      scamBody: t.scam.body,
      statusSuccess: language === "english" ? "Completed" : language === "cantonese" ? "已完成" : "已完成",
      capabilitiesTitle: language === "english" ? "What I can help with" : "我可以幫你做啲乜",
      capabilities:
        language === "english"
          ? [
              "Check your balance",
              "Give you savings advice",
              "Pay your electricity, water or gas bill",
              "Send money by FPS",
              "Connect you to a real person",
            ]
          : language === "cantonese"
            ? [
                "查帳戶結餘",
                "畀儲錢建議你",
                "交電費、水費、煤氣費",
                "轉數快畀人",
                "幫你接駁真人客服",
              ]
            : ["查账户结余", "给你储蓄建议", "缴交电费、水费、煤气费", "转数快给人", "帮你接驳真人客服"],
      chooseBill: t.cards.chooseBill,
      statusStopped: t.pin.cancelled,
    }),
    [language, t],
  );

  const onSubmitText = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    setDraft("");
    await submitText(value);
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-2xl focus:bg-info focus:px-6 focus:py-4 focus:text-lg focus:font-bold focus:text-white"
      >
        {t.nav.skipToContent}
      </a>

      <header className="border-b-4 border-line bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-5 px-6 py-6">
          <div className="flex items-center gap-4">
            <span
              aria-hidden="true"
              className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand text-white"
            >
              <Sparkles className="size-8" strokeWidth={2.5} />
            </span>
            <div>
              <h1 className="text-xl font-extrabold leading-tight text-ink">{t.app.name}</h1>
              <p className="text-base font-semibold text-muted">{t.app.tagline}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="info"
              onClick={uiHandover}
              data-testid="header-handover"
              className="px-6"
            >
              <Headset aria-hidden="true" className="size-7" strokeWidth={2.5} />
              {t.nav.handover}
            </Button>
            <Button
              variant="quiet"
              onClick={resetDemo}
              aria-label={t.nav.reset}
              title={t.nav.reset}
              data-testid="reset-demo"
              className="px-5"
            >
              <RotateCcw aria-hidden="true" className="size-7" strokeWidth={2.5} />
            </Button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-7 px-6 py-8">
        {notice ? (
          <p
            role="alert"
            className="rounded-2xl border-4 border-warn bg-surface-warn p-5 text-lg font-bold leading-relaxed text-ink"
            data-testid="notice"
          >
            {notice}
          </p>
        ) : null}

        {voiceWarning ? (
          <p
            role="status"
            className="rounded-2xl border-4 border-warn bg-surface-warn p-5 text-base font-semibold leading-relaxed text-ink"
            data-testid="voice-warning"
          >
            {voiceWarning}
          </p>
        ) : null}

        <SettingsPanel
          language={language}
          onLanguageChange={setLanguage}
          textScale={textScale}
          onTextScaleChange={setTextScale}
          rate={synthesis.rate}
          onRateChange={synthesis.setRate}
          pitch={synthesis.pitch}
          onPitchChange={synthesis.setPitch}
          voices={synthesis.voices}
          voiceURI={synthesis.voiceURI}
          onVoiceChange={synthesis.setVoiceURI}
          onPreview={() => void synthesis.speak(t.settings.previewText)}
          labels={{
            heading: t.settings.heading,
            language: t.settings.language,
            textSize: t.settings.textSize,
            speechRate: t.settings.speechRate,
            speechPitch: t.settings.speechPitch,
            voice: t.settings.voice,
            voiceAuto: t.settings.voiceAuto,
            noVoices: t.settings.noVoices,
            preview: t.settings.preview,
            previewText: t.settings.previewText,
            textSizes: t.settings.textSizes,
            engine: t.settings.engine,
            engineLabel,
            open: t.settings.heading,
            close: t.settings.close,
          }}
        />

        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex min-h-[420px] flex-col">
            <Transcript
              messages={messages}
              interim={interim}
              listening={listening}
              labels={{
                heading: t.transcript.heading,
                you: t.transcript.you,
                assistant: t.transcript.assistant,
                empty: t.transcript.empty,
                liveRegion: t.transcript.liveRegion,
                listening: t.mic.listening,
              }}
            />
          </div>

          <div className="flex flex-col gap-7">
            {requiresPin && assistant.dialogue.pending ? (
              <PinPad
                title={t.pin.title}
                body={t.pin.body}
                secureNote={t.pin.secureNote}
                enteredLabel={t.pin.entered}
                digitHint={t.pin.digitHint}
                clearLabel={t.pin.clear}
                backspaceLabel={t.pin.backspace}
                error={pinError}
                onSubmit={async (pin) => {
                  await submitPin(pin);
                }}
                onCancel={uiDeny}
                cancelLabel={t.cards.confirmNo}
              />
            ) : card ? (
              <BankCard
                card={card}
                lang={language}
                locale={locale}
                labels={bankLabels}
                onConfirm={uiConfirm}
                onDeny={uiDeny}
                onSelectBill={selectBill}
                onHandover={uiHandover}
                onResume={uiResume}
              />
            ) : (
              <div className="grid flex-1 place-items-center rounded-3xl border-4 border-dashed border-line-soft bg-white p-8 text-center">
                <div>
                  <p className="text-lg font-bold leading-relaxed text-muted">
                    {t.transcript.empty}
                  </p>
                </div>
              </div>
            )}

            <div className="rounded-3xl border-4 border-line bg-white p-7">
              <Waveform active={listening || micState === "speaking"} />
              <div className="mt-5">
                <MicButton
                  state={micState}
                  inCall={inCall}
                  onToggle={() => {
                    if (!inCall) void startCall();
                    else toggleListen();
                  }}
                  onEndCall={endCall}
                  labels={{
                    idle: t.mic.idle,
                    listening: t.mic.listening,
                    thinking: t.mic.thinking,
                    speaking: t.mic.speaking,
                    startCall: t.mic.startCall,
                    endCall: t.mic.endCall,
                    inCall: t.mic.inCall,
                  }}
                />
              </div>
            </div>

            <form onSubmit={onSubmitText} className="rounded-3xl border-4 border-line bg-white p-6">
              <label
                htmlFor="fallback-text"
                className="mb-3 block text-base font-extrabold uppercase tracking-wide text-muted"
              >
                {t.fallback.label}
              </label>
              <div className="flex flex-col gap-4 sm:flex-row">
                <input
                  id="fallback-text"
                  type="text"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t.fallback.placeholder}
                  autoComplete="off"
                  data-testid="fallback-input"
                  className="sv-tap min-w-0 flex-1 rounded-2xl border-4 border-line bg-white px-5 text-lg font-semibold text-ink placeholder:font-normal placeholder:text-muted"
                />
                <Button type="submit" size="large" data-testid="fallback-send" className="shrink-0">
                  <Send aria-hidden="true" className="size-7" strokeWidth={2.5} />
                  {t.fallback.send}
                </Button>
              </div>
              <p className="mt-4 text-base leading-relaxed text-muted">{t.fallback.hint}</p>
            </form>
          </div>
        </div>

        <p className="pb-4 text-center text-base leading-relaxed text-muted" data-testid="locale-badge">
          {LANGUAGE_META[language].label} · {LANGUAGE_META[language].englishLabel} ·{" "}
          {LANGUAGE_META[language].sttTag}
        </p>
      </main>
    </div>
  );
}
