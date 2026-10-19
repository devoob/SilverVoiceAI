"use client";

/**
 * Voice and display settings.
 *
 * Deliberately an inline expanding panel rather than a modal dialog: a modal
 * that dims and traps focus is disorienting for users with low vision or
 * cognitive load concerns, and an inline panel keeps the conversation visible
 * while settings are adjusted.
 *
 * Rate and pitch are discrete steps, not sliders. A slider demands fine motor
 * control — exactly what PRD 5 says we must not assume — and gives no reliable
 * way to return to a known-good value.
 */

import { useId, useState } from "react";
import { ChevronDown, Globe, SlidersHorizontal, Volume2, Type } from "lucide-react";
import { Button } from "./ui";
import { cn } from "@/lib/utils";
import { LANGUAGE_META, LANGUAGES, type Language } from "@/lib/i18n";
import type { SynthesisVoiceOption } from "@/lib/speech";
import type { TextScale } from "@/hooks/useSpeech";

type Option<T> = { value: T; label: string };

function ChoiceGroup<T extends string | number>({
  legend,
  options,
  value,
  onChange,
  columns = 3,
  name,
}: {
  legend: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  columns?: number;
  name: string;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 text-base font-extrabold uppercase tracking-wide text-muted">
        {legend}
      </legend>
      <div
        role="radiogroup"
        aria-label={legend}
        className={cn(
          "grid gap-3",
          columns === 2 ? "grid-cols-2" : columns === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3",
        )}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              name={name}
              onClick={() => onChange(option.value)}
              data-testid={`choice-${name}-${option.value}`}
              className={cn(
                "sv-tap rounded-2xl border-4 px-4 text-base font-bold leading-tight transition-colors",
                selected
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-white text-ink hover:border-brand hover:bg-surface-brand",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export type SettingsPanelProps = {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  textScale: TextScale;
  onTextScaleChange: (scale: TextScale) => void;
  rate: number;
  onRateChange: (rate: number) => void;
  pitch: number;
  onPitchChange: (pitch: number) => void;
  voices: SynthesisVoiceOption[];
  voiceURI: string | null;
  onVoiceChange: (voiceURI: string | null) => void;
  onPreview: () => void;
  labels: {
    heading: string;
    language: string;
    textSize: string;
    speechRate: string;
    speechPitch: string;
    voice: string;
    voiceAuto: string;
    noVoices: string;
    preview: string;
    previewText: string;
    textSizes: Record<TextScale, string>;
    engine: string;
    engineLabel: string;
    open: string;
    close: string;
  };
};

const RATE_OPTIONS: Option<number>[] = [
  { value: 0.7, label: "0.7×" },
  { value: 0.85, label: "0.85×" },
  { value: 1, label: "1×" },
  { value: 1.15, label: "1.15×" },
];

const PITCH_OPTIONS: Option<number>[] = [
  { value: 0.85, label: "Low" },
  { value: 1, label: "Normal" },
  { value: 1.15, label: "High" },
];

const TEXT_SCALE_OPTIONS: Option<TextScale>[] = [
  { value: "normal", label: "normal" },
  { value: "large", label: "large" },
  { value: "extraLarge", label: "extraLarge" },
];

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    language,
    onLanguageChange,
    textScale,
    onTextScaleChange,
    rate,
    onRateChange,
    pitch,
    onPitchChange,
    voices,
    voiceURI,
    onVoiceChange,
    onPreview,
    labels,
  } = props;

  const [open, setOpen] = useState(false);
  const panelId = useId();

  const languageOptions: Option<Language>[] = LANGUAGES.map((lang) => ({
    value: lang,
    label: `${LANGUAGE_META[lang].label} · ${LANGUAGE_META[lang].englishLabel}`,
  }));

  const textScaleOptions: Option<TextScale>[] = TEXT_SCALE_OPTIONS.map((option) => ({
    value: option.value,
    label: labels.textSizes[option.value],
  }));

  return (
    <div className="rounded-3xl border-4 border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="settings-toggle"
        className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
      >
        <span className="flex items-center gap-4 text-lg font-extrabold text-ink">
          <SlidersHorizontal aria-hidden="true" className="size-8 shrink-0 text-brand" strokeWidth={2.5} />
          {labels.heading}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn("size-8 shrink-0 text-ink transition-transform", open && "rotate-180")}
          strokeWidth={3}
        />
      </button>

      {open ? (
        <div id={panelId} className="flex flex-col gap-8 border-t-4 border-line px-6 py-7" data-testid="settings-panel">
          <ChoiceGroup
            name="language"
            legend={labels.language}
            options={languageOptions}
            value={language}
            onChange={onLanguageChange}
            columns={2}
          />

          <div className="flex items-start gap-4">
            <Type aria-hidden="true" className="mt-9 size-8 shrink-0 text-brand" strokeWidth={2.5} />
            <ChoiceGroup
              name="textSize"
              legend={labels.textSize}
              options={textScaleOptions}
              value={textScale}
              onChange={onTextScaleChange}
            />
          </div>

          <div className="flex items-start gap-4">
            <Volume2 aria-hidden="true" className="mt-9 size-8 shrink-0 text-brand" strokeWidth={2.5} />
            <ChoiceGroup
              name="speechRate"
              legend={labels.speechRate}
              options={RATE_OPTIONS}
              value={rate}
              onChange={onRateChange}
              columns={4}
            />
          </div>

          <ChoiceGroup
            name="speechPitch"
            legend={labels.speechPitch}
            options={PITCH_OPTIONS}
            value={pitch}
            onChange={onPitchChange}
          />

          <fieldset>
            <legend className="mb-3 flex items-center gap-3 text-base font-extrabold uppercase tracking-wide text-muted">
              <Globe aria-hidden="true" className="size-6 text-brand" strokeWidth={2.5} />
              {labels.voice}
            </legend>
            {voices.length === 0 ? (
              <p className="rounded-2xl border-4 border-warn bg-surface-warn p-4 text-base font-bold text-ink">
                {labels.noVoices}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-2">
                  <span className="sr-only">{labels.voice}</span>
                  <select
                    value={voiceURI ?? ""}
                    onChange={(event) => onVoiceChange(event.target.value || null)}
                    data-testid="voice-select"
                    className="sv-tap w-full rounded-2xl border-4 border-line bg-white px-5 text-base font-bold text-ink"
                  >
                    <option value="">{labels.voiceAuto}</option>
                    {voices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </select>
                </label>
                <Button variant="secondary" size="block" onClick={onPreview} data-testid="voice-preview">
                  {labels.preview}
                </Button>
                <p
                  className="rounded-2xl border-2 border-line bg-surface p-4 text-base font-semibold text-muted"
                  data-testid="engine-label"
                >
                  {labels.engine}: <span className="font-bold text-ink">{labels.engineLabel}</span>
                </p>
              </div>
            )}
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
