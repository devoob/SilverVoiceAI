# Remaining work — beyond the browser-only hackathon build

The shipped MVP is deliberately **browser-only**: Web Speech API for recognition
and synthesis, a deterministic intent parser, and a client-side mock ledger.
That choice buys zero infrastructure, zero API keys, zero latency, and survival
if the venue wifi drops. Everything below is what you would add once the
competition is over, ordered by value-per-effort.

All repository metadata (stars, licences, last-push dates) was verified against
the GitHub and Hugging Face APIs on 2026-10-19. Re-verify before depending on
it — speech models move fast.

---

## 1. The two gaps no open source closes

These are the honest limits of the current build. Plan around them rather
than discovering them in front of a judge.

### 1.1 There is no open-source HSBC or FPS banking API

No public HSBC core-banking API, no FPS sandbox, and no Hong Kong open-banking
sandbox exists as open source. `src/lib/bank.ts` is therefore the integration
seam: it is a pure, typed module with integer-cent money and a PIN precondition
on every mutation. Swapping in a real backend means replacing this one file and
the `/api/assistant` route handler; nothing above them changes.

For the pitch, say this plainly: the ledger is a mock, and the guardrails
(PIN-before-mutation, no spoken PIN, coercion screen) are the part that would
be real.

### 1.2 Cantonese TTS — addressed, with a caveat

The defect this section used to describe was real and audible: with no `zh-HK`
voice installed, voice selection fell back to a `zh-CN` voice, so the assistant
read Cantonese aloud as **Putonghua** instead of 廣東話.

Both halves are now fixed in the app:

- **Strict voice selection.** `pickBestVoice` / `voicesForTag` in
  `src/lib/speech.ts` accept only `zh-HK` / `yue` voices for Cantonese. They
  return nothing rather than attaching a Mandarin voice, and the UI shows a
  clear warning plus how to fix it.
- **A local open-source Cantonese engine.**
  `SidecarSynthesisAdapter` → `POST /api/tts` → `scripts/cosyvoice_server.py`,
  which serves **CosyVoice 3** (`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`,
  Apache-2.0) with its Guangdong dialect and instruct control over warmth and
  speed. Start it with `npm run tts:sidecar`; the app probes it automatically
  and falls back to the browser voice if it is not running.

Remaining caveat: CosyVoice's *speaker ids vary by model build*, so the shim
resolves a Cantonese speaker at runtime and reports what it found at
`/health`. For the warmest and most reliably Cantonese output, supply ten
seconds of reference audio:

```bash
COSYVOICE_PROMPT_WAV=ref.wav COSYVOICE_PROMPT_TEXT="..." npm run tts:sidecar
```

If you would rather not run Python at all, the browser path still works: on a
Mac install the premium Cantonese voice (System Settings → Accessibility →
Spoken Content → Voices), or demo on an **iPad**, whose `zh-HK` voices are far
better than desktop Sinji.

---

## 2. Self-hosted GPU path (best quality, needs a GPU box)

This is the architecture the PRD diagram actually describes. Nothing in the
current code prevents it: `src/lib/speech.ts` hides recognition and synthesis
behind two adapter interfaces, and `/api/assistant` is the orchestration seam.

### Speech-to-text

| Project | Stars | Licence | Why |
|---|---|---|---|
| `QwenAudio/SenseVoice` | 9.5k | **MIT** | Native `yue` (Cantonese) support; also language ID and **speech emotion recognition**, which could drive confusion-triggered human handover. Beats Whisper on Chinese/Cantonese by their benchmark. |
| `FunAudioLLM/Fun-ASR` | 1.6k | Apache-2.0 | Cantonese dialect + Guangdong accent; has a **`hotwords`** parameter — exactly right for *FPS / 轉數快 / 提款* terminology. |
| `modelscope/FunASR` | 20.7k | MIT | Serving and runtime layer for the above. |
| `QwenAudio/SenseVoiceSmall` (HF) | 21k downloads | MIT | The checkpoint. |

### Text-to-speech

| Project | Stars | Licence | Why |
|---|---|---|---|
| `QwenAudio/CosyVoice` → `Fun-CosyVoice3-0.5B-2512` (HF) | 24k / 232k downloads | **Apache-2.0** | Covers **Guangdong (Cantonese)** among 18+ Chinese dialects, and supports **instruct control over emotion, speed and volume** — a direct implementation of PRD 4's "warm, adjustable, slower" requirement. Needs a GPU. |
| `jmtl/hk-cantonese-cc0-qwen3-tts-GGUF` (HF) | — | **Apache-2.0** | Cantonese LoRA over Qwen3-TTS-1.7B-Base trained on a **CC0** Hong Kong corpus; GGUF so it runs on CPU. Drop-in alternative behind `/api/tts` — pair it with `predict-woo/qwen3-tts.cpp` (MIT, Metal) instead of CosyVoice if Python or RAM is a problem. |
| `QwenLM/Qwen3-TTS` | 13.8k | Apache-2.0 | 10 languages + dialectal voice profiles, natural-language control of tone/rate/emotion. ⚠️ Cantonese is not in the published language table — verify with `get_supported_languages()` before committing. |

### Orchestration

`pipecat-ai/pipecat` (16.6k, BSD-2-Clause) or `livekit/agents` (14.8k,
Apache-2.0) provide the realtime voice-agent pipeline if you want streaming
turn-taking rather than the current single-utterance turns.

---

## 3. Hybrid path (recommended first upgrade)

Browser STT + GPU-sidecar TTS, with `speechSynthesis` as an automatic fallback
if the sidecar is unreachable. This gets you the warm Cantonese voice without
giving up the instant, offline-capable recognition path.

Implementation shape:

1. Keep `WebSpeechRecognitionAdapter` as-is.
2. Add a `CosyVoiceSynthesisAdapter implements SynthesisAdapter` that POSTs
   text to a sidecar endpoint and plays the returned audio via `<audio>`.
3. In `resolveSynthesisAdapter()`, probe the sidecar and fall back to
   `WebSpeechSynthesisAdapter` on failure.

No component above `lib/speech.ts` needs to change.

---

## 4. Offline / on-device STT (answers the "audio goes to Google" objection)

The Web Speech API streams audio to Google/Apple. On a *banking* panel that is
a question worth pre-empting.

`k2-fsa/sherpa-onnx` (15.4k, **Apache-2.0**) ships an official **browser-WASM
demo for Chinese + English + Cantonese** (Paraformer-large), and can also run
SenseVoice. Fully client-side, no audio leaves the device.

Why it is not the MVP: there is **no npm package** for the browser WASM build —
you must wire prebuilt assets from the GitHub releases manually, and the models
are a ~100–200 MB first-load download. That is real engineering for a
competition weekend. It is the right second move.

Note also `snakers4/silero-vad` (10.5k, MIT) and `ricky0123/vad` /
`@ricky0123/vad-web` (2.1k, ISC) for proper endpointing if you move to
streaming recognition.

---

## 5. Licence posture — hackathon vs production

**Hackathon (current):** unrestricted. Anything that works is acceptable.

**Production / anything HSBC touches:** permissive-only — MIT, Apache-2.0,
BSD, ISC. The current dependency set already satisfies this:

| Dependency | Licence |
|---|---|
| next, react, react-dom | MIT |
| tailwindcss, clsx, tailwind-merge | MIT |
| class-variance-authority | Apache-2.0 |
| lucide-react | ISC |
| zod | MIT |
| json-rules-engine | ISC |
| eslint-plugin-jsx-a11y | MIT |
| @playwright/test | Apache-2.0 |
| @axe-core/playwright | MPL-2.0 (test-only) |
| vitest | MIT |

**Excluded from any production build**, with reasons:

| Project | Why excluded |
|---|---|
| `rany2/edge-tts` (12.3k) | **LGPL-3.0**, and an unofficial Microsoft endpoint that can break mid-demo. Acceptable only as a hackathon TTS fallback. |
| `hgneng/ekho` (1.2k) | **GPL-2.0**; formant-based, robotic Cantonese. Emergency offline fallback only. |
| `gwinterstein/CantoMap` | **GPL-3.0** corpus. |
| `2noise/ChatTTS` (39.9k) | **AGPL-3.0**. |
| `fishaudio/fish-speech` (33.3k) | "Fish Audio Community License" — **not OSI open source**. |
| `MoonshotAI/Kimi-Audio` | **No licence file** → all rights reserved. |
| `jackuh02/CosyVoice2-Yue-mlx` | **No licence** → all rights reserved, despite being a Cantonese CosyVoice fine-tune. |
| `kapi2800/qwen3-tts-apple-silicon` | **No licence**. |
| `rhasspy/piper` (11.3k) | **Archived** (2025-08) and has **zero zh_HK voices**. Its fork `OHF-Voice/piper1-gpl` is GPL-3.0 and also has no Cantonese. |
| `protectai/llm-guard` | **Archived**. Use `NVIDIA-NeMo/Guardrails` (Apache-2.0) or `guardrails-ai/guardrails` (Apache-2.0) instead. |
| `pa11y/pa11y` | LGPL-3.0 — fine as a dev-only tool, not shippable. |

**Safe to adopt later:** `NVIDIA-NeMo/Guardrails` (Apache-2.0),
`guardrails-ai/guardrails` (Apache-2.0), `presidio` (MIT, PII/account-number
masking), `MasterKale/SimpleWebAuthn` (MIT, passkeys/biometrics),
`wenet-e2e/wespeaker` and `modelscope/3D-Speaker` (both Apache-2.0, speaker
verification for the PRD's voice-spoofing claim).

---

## 6. Local LLM (and why it is not in the demo)

The intent layer is rule-based on purpose: three scripted journeys, no API key,
no network round-trip, and no chance of a model hallucinating a transaction on
stage. `parseIntent` and the `/api/assistant` route are the swap point for an
LLM fallback that handles *out-of-script* utterances only.

On this machine (Apple M2, **8 GB RAM**), a 7B-class model via `ollama/ollama`
(MIT) or `ggml-org/llama.cpp` (MIT) is technically possible but will contend
with the browser for memory during a demo. Not recommended for the pitch.

For Cantonese-quality text generation when you do add one, prefer
Qwen-family weights (Apache-2.0) — they are the strongest open models for
Chinese varieties. `vllm-project/vllm` (Apache-2.0) for serving.

---

## 7. Fine-tuning corpora for elderly Hong Kong speech

If you want recognition that survives real elderly Cantonese — pauses,
tremor-affected articulation, code-switching — these are the datasets:

| Dataset | Licence | Note |
|---|---|---|
| `ASLP-lab/WenetSpeech-Yue` | Apache-2.0 | Large-scale Cantonese speech corpus. |
| `AlienKevin/mixed_cantonese_and_english_speech` (HF) | see card | **Code-switching** — directly serves PRD 2. |
| `JackyHoCL/cleaned_mixed_cantonese_and_english_speech` (HF) | see card | Cleaned variant of the above. |
| `alvanlii/cantonese-youtube`, `cantonese-radio` (HF) | see card | Spontaneous speech. |
| `fcbond/hkcancor` | see card | HK Cantonese spontaneous speech; check licence before training. |
| `stvlynn/Cantonese-Dialogue` (HF) | see card | Dialogue structure. |
| `common-voice/common-voice` (zh-HK) | MPL-2.0 (code); data CC0 | Mozilla Cantonese recordings. |
| `sepidmnorozy/Cantonese_sentiment` (HF) | see card | Useful for frustration detection. |

Supporting NLP: `jacksonllee/pycantonese` (MIT), `pengzhendong/g2p-mix`
(Apache-2.0, mixed Cantonese/Mandarin + English G2P for a code-switching TTS
front-end), `currentslab/fastlangid` (Apache-2.0, Cantonese-aware language ID),
`CanCLID/awesome-cantonese-nlp` (index).

---

## 8. Product gaps worth closing next

1. **Emotion-aware handover.** SenseVoice's speech emotion recognition could
   trigger the human-handover offer when it detects frustration or distress,
   instead of waiting for the user to ask. This is the single most
   competition-aligned upgrade available.
2. **Speaker verification as a second factor.** `wespeaker` / `3D-Speaker`
   (Apache-2.0) would back the PRD's voice-spoofing claim with something
   measurable rather than a policy statement.
3. **Speech-to-speech.** `QwenLM/Qwen2.5-Omni` and `stepfun-ai/Step-Audio2`
   (both Apache-2.0; Step-Audio is benchmarked on Common Voice `yue`) could
   collapse STT + LLM + TTS into one model, removing two integration seams.
4. **Age-friendly design review.** `FeiFeiSeal/age-friendly-ui` (MIT, updated
   2026-10) is an agent skill for reviewing interfaces against WCAG 2.2 and
   older-adult usability heuristics. Worth running over the UI before the
   final pitch.
5. **Self-hosted CJK font.** The app uses the system CJK stack (PingFang HK /
   Microsoft JhengHei) for zero download cost. For guaranteed rendering on any
   device, self-host **Noto Sans HK** (`notofonts/noto-cjk`, SIL OFL 1.1) via
   `next/font`.
6. **Real waveform.** The indicator is state-driven because the Web Speech API
   exposes no audio levels. A parallel `getUserMedia` + AnalyserNode would give
   true levels, at the cost of risking microphone contention with recognition.

---

## 9. Known non-blocking issues

- `npm audit` reports a high-severity advisory in `braces`, reachable only
  through `eslint-config-next` (dev-only lint toolchain, never shipped). The
  suggested `audit fix --force` would downgrade `eslint-config-next` to v14 —
  a breaking change. Left as-is deliberately.
- Next.js warns about a stray `package-lock.json` in the parent `Downloads/`
  directory. It is outside this repository and harmless; delete it if the
  warning bothers you.
