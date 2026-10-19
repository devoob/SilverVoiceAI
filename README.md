# SilverVoice AI 銀齡語音

An inclusive, trilingual **AI voice banking assistant** for elderly Hong Kong
residents, built for the **HKU × HSBC "Bank on U" Social Innovation Challenge**
(themes: age-friendly banking, AI-powered inclusion).

The whole product is one screen and one button. An elderly user presses the
microphone and speaks Cantonese, Putonghua or English; the assistant answers
aloud *and* in large high-contrast text, and can check balances, give savings
advice, pay utility bills and send FPS transfers. **Money never moves without a
tapped 6-digit PIN** — the assistant cannot spend on the strength of a voice
command, and it will never accept a spoken PIN.

The conversation is built to feel like a person, not a form:

- **It never hangs up on silence.** Silence is treated as thinking. After a long
  quiet spell the assistant says one reassuring line and keeps listening.
- **You can talk over it.** Start speaking while it is talking and it stops
  immediately. The opening greeting is protected so it is always heard in full.
- **It waits while you think.** A turn only ends after ~1.4s of quiet
  (production agents endpoint at 0.2–0.6s), so a considered sentence stays one
  turn instead of being chopped into fragments.
- **English by default**, switchable at any time; the choice is remembered.

### Speaking real Cantonese (廣東話)

Browsers ship no dependable Cantonese voice, and a naive fallback hands
Cantonese text to a Mandarin voice — the assistant then sounds like Putonghua.
Two things prevent that here:

1. Voice selection is **strict**: for Cantonese it will use no voice at all
   rather than a `zh-CN` one, and the app tells you when no Cantonese voice is
   installed.
2. An optional **local open-source Cantonese engine** (CosyVoice 3, Apache-2.0 —
   Guangdong dialect, with instruct control over warmth and speed) can be run on
   this machine and is picked up automatically:

   ```bash
   npm run tts:sidecar      # first run installs and downloads the model
   ```

   No configuration is needed; without it the app falls back to the browser
   voice or to text only.

See [`remaining.md`](./remaining.md) for the upgrade roadmap (GPU speech models,
hybrid TTS, licence posture for production) and the open-source survey behind
every choice.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

For the demo build:

```bash
npm run build
npm run start
```

Speech recognition needs **Chrome, Edge or Safari** (the Web Speech API) and a
microphone. If either is unavailable the app degrades to a large text box that
drives the identical pipeline — that box is also the accessibility fallback.

## Test it

```bash
npm test             # 96 unit tests: numerals, intent, guardrails, ledger, dialogue journeys
npm run test:e2e     # 33 Playwright tests: full voice calls, guardrails, trilingual, display controls
npm run test:a11y    # WCAG 2.1 AA axe audits of every screen state + age-friendly structural checks
npm run lint
npm run typecheck
```

The E2E suite drives **real end-to-end calls**: a scripted speech adapter
(`e2e/speech-stub.js`) is injected in place of the Web Speech API — headless
Chromium has none — and each journey runs listen → recognise → intent →
guardrail → ledger → card → speech. The same adapter interface
(`src/lib/speech.ts`) is the swap point for the offline/GPU engines described
in `remaining.md`.

## The three showcase journeys

| Journey | Say | What happens |
|---|---|---|
| Balance + advice | *我有幾多錢喺入面？可唔可以畀少少儲錢建議我？* | Balance card + spoken savings tip |
| Utility bill | *我想繳交電力公司電費。* → *係，幫我交啦。* → PIN | CLP bill proposed, confirmed, PIN-gated, receipt |
| FPS transfer | *幫我轉 $200 畀陳太太。* → PIN | Payee + amount resolved, confirmed, PIN-gated, receipt |

Code-switching works: *幫我 transfer 兩百蚊 to 陳太太* resolves correctly.

## Safety model (PRD 6)

- **PIN before every mutation.** `payBill`/`transfer` in `src/lib/bank.ts`
  refuse to execute without a verified PIN; the dialogue engine cannot bypass
  them.
- **No spoken PIN.** The microphone is closed while the PIN pad is open.
- **Scam caution before the PIN pad.** First-time payees above $100, amounts
  far above a payee's norm, and high-value transfers each raise a spoken
  caution naming the Anti-Deception Hotline **18222**.
- **Coercion screen.** Authority impersonation, manufactured urgency and
  secrecy demands are intercepted before any intent is acted on.
- **Human handover** is one permanent tap away, in the header.
- Transaction policy is declarative rule data (`src/lib/guardrails.ts`,
  json-rules-engine), so thresholds are reviewable without a code change.

## Accessibility (PRD 5, WCAG 2.1 AA)

- Base text 20px, headings ≥28px, user-adjustable up to ~26px via the
  in-app text-size control.
- Every interactive control ≥64×64px; PIN keys ≥88px.
- All text/background pairs measured at ≥7:1 (AAA); borders ≥3:1.
- Visible 4px focus ring, `prefers-reduced-motion` honoured, pinch-zoom enabled.
- Dual feedback: every spoken reply persists as large text and is mirrored to
  an `aria-live` region.
- Verified by axe-core audits in `e2e/accessibility.spec.ts`.

## API surface

| Route | Purpose |
|---|---|
| `POST /api/assistant` | Server-side intent parsing and coercion screening. Refuses any `pin` field by design. |
| `GET /api/tts` | Health probe for the local Cantonese engine. |
| `POST /api/tts` | Proxies synthesis to the local Cantonese engine. |

## Demo PIN

`123456` (mock credential; override with `NEXT_PUBLIC_DEMO_PIN`). A real
deployment would use WebAuthn/passkeys — see `remaining.md` §5.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 ·
Web Speech API · zod · json-rules-engine · lucide-react · Vitest · Playwright ·
axe-core.
