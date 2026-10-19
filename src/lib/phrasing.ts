/**
 * Phrasing variation.
 *
 * The assistant used to answer with one fixed sentence per intent, so the same
 * question always produced byte-identical speech and the second savings tip was
 * unreachable dead code. This layer rotates between realisations instead.
 *
 * Rotation, not randomisation, on purpose:
 *
 *   - it guarantees the same wording is never used twice in a row, which is the
 *     part a listener actually notices;
 *   - it is deterministic, so a live demo replays identically and tests do not
 *     become flaky;
 *   - there is no sampling to go wrong in a banking app.
 *
 * Every variant of a phrase must carry the same essential facts. Tests assert
 * on those facts (`toContain("12480蚊5毫")`), never on the wording, so variation
 * cannot make the suite brittle.
 */

const cursors = new Map<string, number>();

/** Return the next realisation for `key`, cycling so it never repeats twice. */
export function rotate<T>(key: string, options: readonly T[]): T {
  if (options.length === 0) {
    throw new Error(`rotate() needs at least one option for "${key}"`);
  }
  const index = cursors.get(key) ?? 0;
  cursors.set(key, (index + 1) % options.length);
  return options[index % options.length];
}

/** Reset every rotation. Used between showcase runs and by tests. */
export function resetPhrasing(): void {
  cursors.clear();
}

/**
 * A short acknowledgement to open a reply with, so the user can tell the
 * assistant heard *them* rather than just the command. Empty for languages or
 * moments where an opener would only add noise.
 */
export function acknowledge(lang: "cantonese" | "putonghua" | "english"): string {
  return rotate(`ack:${lang}`, ACKNOWLEDGEMENTS[lang]);
}

const ACKNOWLEDGEMENTS = {
  cantonese: ["好，", "冇問題，", "收到，", "好呀，", "得，"],
  putonghua: ["好，", "好的，", "收到，", "没问题，", "行，"],
  english: ["Right, ", "OK, ", "Got it, ", "Sure, ", "Alright, "],
} as const;

/**
 * Warm, brief replies for social turns. Thanking the assistant used to fall
 * through to "sorry, I didn't catch that", which is the clearest example of the
 * assistant not responding to what was actually said.
 */
export function socialReply(
  kind: "thanks" | "greeting",
  lang: "cantonese" | "putonghua" | "english",
): string {
  const table = kind === "thanks" ? THANKS : GREETINGS;
  return rotate(`${kind}:${lang}`, table[lang]);
}

/**
 * Extra greetings beyond the canonical one held in i18n, which is used as the
 * first variant so the localised string table stays the source of truth.
 */
export function greetingVariants(
  lang: "cantonese" | "putonghua" | "english",
): readonly string[] {
  return GREETINGS[lang].slice(1);
}

const THANKS = {
  cantonese: [
    "唔使客氣。仲有咩想我做？",
    "唔使客氣，好高興幫到你。仲想做啲乜？",
    "舉手之勞啫。仲有嘢想問嗎？",
  ],
  putonghua: [
    "不客气。还有什么想让我做？",
    "不客气，很高兴帮到你。还想做什么？",
    "举手之劳。还有想问的吗？",
  ],
  english: [
    "You're very welcome. What else can I do for you?",
    "Any time — glad that helped. Anything else?",
    "My pleasure. Anything else you'd like?",
  ],
} as const;

const GREETINGS = {
  cantonese: [
    "你好！我可以幫你做啲乜嘢？",
    "你好呀！想查結餘、交單，定係轉數快？",
    "你好！有咩幫到你？",
  ],
  putonghua: [
    "你好！我可以帮你做什么？",
    "你好！想查结余、交账单，还是转账？",
    "你好！有什么可以帮你？",
  ],
  english: [
    "Hi, how can I help you today?",
    "Hello! Would you like to check your balance, pay a bill, or send money?",
    "Hi there — what can I do for you?",
  ],
} as const;
/**
 * Extra realisations of "I didn't catch that".
 *
 * Every variant deliberately still names a concrete example: telling an elderly
 * user what they *can* say is the single most useful thing this reply does, so
 * variation must not cost them that. The canonical line from i18n is used as
 * the first variant; these follow it.
 */
export function fallbackVariants(
  lang: "cantonese" | "putonghua" | "english",
): readonly string[] {
  return FALLBACK_EXTRA[lang];
}

const FALLBACK_EXTRA = {
  cantonese: [
    "唔係好清楚你想做啲乜。試下講「查結餘」，我就幫你睇。",
    "我聽得唔太清楚。你可以講「查結餘」、「交單」，或者「轉數快」。",
  ],
  putonghua: [
    "不太清楚你想做什么。你试试说「查结余」，我帮你看。",
    "我听不太清楚。你可以说「查结余」、「交账单」，或者「转账」。",
  ],
  english: [
    "I'm not quite sure what you'd like. Try saying \"check my balance\" and I'll take a look.",
    "I didn't quite catch that. You can say \"check my balance\", \"pay a bill\", or \"send money\".",
  ],
} as const;
