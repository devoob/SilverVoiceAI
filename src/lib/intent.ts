/**
 * Deterministic trilingual intent parser.
 *
 * The PRD's three showcase journeys are a closed set of intents, so this is a
 * rule-based classifier rather than an LLM call. That is a deliberate choice
 * for a live pitch: no API key, no network round-trip, no latency, and no
 * chance of the model hallucinating a transaction on stage. An LLM fallback
 * for out-of-script utterances is documented in remaining.md.
 *
 * Matching is deliberately language-agnostic and tolerates code-switching
 * (PRD 2): "幫我 transfer 兩百蚊 to 陳太太" resolves correctly.
 */

import { BILLERS, getPayees, type BillerId } from "./bank";
import { extractAmount } from "./numerals";

export const INTENTS = [
  "balance",
  "advice",
  "list_bills",
  "pay_bill",
  "transfer",
  "handover",
  "help",
  "greeting",
  "confirm",
  "deny",
  "repeat",
  "unknown",
] as const;

export type IntentName = (typeof INTENTS)[number];

export type ParsedIntent = {
  intent: IntentName;
  /** 0..1 — used to decide whether to ask the user to repeat. */
  confidence: number;
  amountCents: number | null;
  billerId: BillerId | null;
  payeeId: string | null;
  raw: string;
};

/** Full-width -> half-width, lowercase, punctuation stripped. */
export function normalise(input: string): string {
  return input
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[\s\u3000]+/g, " ")
    .replace(/[。，、！？：；「」『』（）\(\)\[\]{}<>'".,!?;:~`@#$%^&*_\-+=|\\/…—·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Space-free form, used for CJK substring matching. */
function compact(input: string): string {
  return normalise(input).replace(/\s/g, "");
}

const ASCII_KEYWORD = /^[\x00-\x7F]+$/;

function keywordHits(normalised: string, condensed: string, keywords: string[]): number {
  let hits = 0;
  for (const raw of keywords) {
    const kw = raw.toLowerCase();
    if (ASCII_KEYWORD.test(kw)) {
      const pattern = new RegExp(`(?:^|\\s)${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`);
      if (pattern.test(` ${normalised} `)) hits += 1;
    } else if (condensed.includes(kw.replace(/\s/g, ""))) {
      hits += 1;
    }
  }
  return hits;
}

const LEXICON: Record<string, string[]> = {
  handover: [
    "真人", "真人幫手", "人工", "客服", "客戶服務", "客户服务", "職員", "职员", "熱線", "热线",
    "搵人", "找人", "叫個人", "叫个人", "聽唔明", "听不明", "不明白", "唔識", "不识",
    "幫手", "帮手", "救我", "helpline", "human", "operator", "agent", "representative",
    "speak to someone", "talk to a person", "call my family", "家人", "call the bank", "assistance",
  ],
  balance: [
    "結餘", "结余", "餘額", "余额", "幾多錢", "几多钱", "多少錢", "多少钱", "有幾多",
    "有多少", "户口", "戶口", "帳戶", "账户", "balance", "存款", "我有多少钱",
    "入面有几多", "入面有幾多", "how much money", "whats my balance",
  ],
  advice: [
    "建議", "建议", "儲錢", "储钱", "儲蓄", "储蓄", "理財", "理财", "advice", "savings",
    "點樣儲", "怎样储", "如何儲", "如何储", "可以慳", "可以省", "tip", "tips", "suggest",
    "應該點做", "应该怎么", "幫我睇下", "帮我看看", "how should i", "plan", "budget",
  ],
  list_bills: [
    "有咩單", "有乜單", "有什么单", "有甚麼單", "賬單", "账单", "未交", "未繳", "未缴",
    "要交", "有几多单", "有幾多單", "what bills", "any bills", "bills do i have",
    "pending bills", "未付", "待繳", "待缴",
  ],
  pay_bill: [
    "交", "繳", "缴", "繳交", "缴交", "交單", "交单", "俾錢", "畀錢", "给钱", "給錢",
    "pay", "settle", "電費", "电费", "水費", "水费", "煤氣費", "煤气费", "電費單", "电费单",
    "電力公司", "电力公司", "中電", "中电", "港燈", "港灯", "水務署", "水务署",
    "pay my bill", "pay the bill", "payment",
  ],
  /**
   * Strong transfer evidence: unambiguous money-movement verbs.
   *
   * The weak prepositions 畀 / 俾 / 给 / "to" are deliberately kept OUT of
   * this list. They are ordinary function words in Cantonese — "畀少少儲錢
   * 建議我" (give me some savings advice) contains 畀 but is not a transfer.
   * Treating them as transfer evidence misclassifies the PRD's own Journey 1
   * utterance, so they only count as supporting pay-markers alongside a
   * matched payee or amount.
   */
  transfer: [
    "轉賬", "转账", "轉數快", "转数快", "過數", "过数", "匯款", "汇款", "轉錢", "转钱",
    "transfer", "fps", "send money", "send to", "wire", "转账给", "轉去", "转去",
    "打钱", "打錢",
  ],
  help: [
    "help", "點用", "点用", "點樣用", "怎样用", "可以做啲乜", "可以做什么", "有咩功能",
    "有什么功能", "what can you do", "how do i use", "識做啲乜", "能做什么", "指令",
  ],
  greeting: [
    "你好", "hello", "hi", "早晨", "哈囉", "哈啰", "hey", "good morning", "good afternoon",
    "早安", "午安", "晚安",
  ],
  confirm: [
    "係", "系", "是", "對", "对", "好", "好啊", "好呀", "冇問題", "没问题", "可以",
    "確認", "确认", "yes", "yeah", "yep", "ok", "okay", "sure", "confirm", "go ahead",
    "交啦", "繳啦", "畀啦", "俾啦", "轉啦", "做啦", "無問題", "correct", "right", "嗯",
  ],
  deny: [
    "唔好", "不好", "不要", "唔使", "不用", "唔得", "取消", "算了", "咪住", "等等",
    "停", "停一停", "no", "nope", "cancel", "stop", "dont", "do not", "wait", "never mind",
    "唔想", "不想",
  ],
  repeat: [
    "再講一次", "再讲一次", "再說一次", "再说一次", "repeat", "講多次", "讲多次",
    "聽唔清", "听不清", "咩話", "什么", "pardon", "again", "say that again", "大聲啲",
    "大声点", "louder",
  ],
};

/** Longest aliases first so "陳太太" wins over a shorter overlapping alias. */
function sortedAliases(): { id: string; alias: string; kind: "biller" | "payee" }[] {
  const entries: { id: string; alias: string; kind: "biller" | "payee" }[] = [];
  for (const biller of Object.values(BILLERS)) {
    for (const alias of biller.aliases) entries.push({ id: biller.id, alias, kind: "biller" });
  }
  for (const payee of getPayees()) {
    for (const alias of payee.aliases) entries.push({ id: payee.id, alias, kind: "payee" });
  }
  return entries.sort((a, b) => b.alias.length - a.alias.length);
}

const ENTITIES = sortedAliases();

export function findBiller(utterance: string): BillerId | null {
  const condensed = compact(utterance);
  const normalised = normalise(utterance);
  for (const entity of ENTITIES) {
    if (entity.kind !== "biller") continue;
    const kw = entity.alias.toLowerCase();
    const hit = ASCII_KEYWORD.test(kw)
      ? new RegExp(`(?:^|\\s)${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`).test(` ${normalised} `)
      : condensed.includes(kw.replace(/\s/g, ""));
    if (hit) return entity.id as BillerId;
  }
  return null;
}

export function findPayee(utterance: string): string | null {
  const condensed = compact(utterance);
  const normalised = normalise(utterance);
  for (const entity of ENTITIES) {
    if (entity.kind !== "payee") continue;
    const kw = entity.alias.toLowerCase();
    const hit = ASCII_KEYWORD.test(kw)
      ? new RegExp(`(?:^|\\s)${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`).test(` ${normalised} `)
      : condensed.includes(kw.replace(/\s/g, ""));
    if (hit) return entity.id;
  }
  return null;
}

const PAY_MARKER = ["畀", "俾", "给", "給", "to", "過", "过", "轉去", "转去"];

function hasPayMarker(normalised: string, condensed: string): boolean {
  return keywordHits(normalised, condensed, PAY_MARKER) > 0;
}

/**
 * Classify an utterance.
 *
 * Rule order matters: safety-critical intents (handover) are matched before
 * transactional ones, and entity evidence overrides bare verb keywords so that
 * "交電費" is a bill payment while "轉錢畀陳太太" is a transfer.
 */
export function parseIntent(utterance: string): ParsedIntent {
  const raw = utterance.trim();
  const normalised = normalise(raw);
  const condensed = compact(raw);

  const base: Omit<ParsedIntent, "intent" | "confidence"> = {
    amountCents: extractAmount(raw),
    billerId: findBiller(raw),
    payeeId: findPayee(raw),
    raw,
  };

  if (normalised.length === 0) {
    return { ...base, intent: "unknown", confidence: 0 };
  }

  const score = (key: keyof typeof LEXICON) => keywordHits(normalised, condensed, LEXICON[key]);

  const handover = score("handover");
  if (handover > 0) {
    return { ...base, intent: "handover", confidence: Math.min(1, 0.6 + handover * 0.2) };
  }

  const biller = base.billerId;
  const payee = base.payeeId;
  const payBillHits = score("pay_bill");
  const transferHits = score("transfer");
  const listBillsHits = score("list_bills");
  const balanceHits = score("balance");
  const adviceHits = score("advice");

  // A named payee plus a transfer verb (or an amount + pay marker) is a transfer.
  if (payee && (transferHits > 0 || base.amountCents !== null || hasPayMarker(normalised, condensed))) {
    const confidence = Math.min(1, 0.55 + transferHits * 0.12 + (base.amountCents !== null ? 0.2 : 0));
    return { ...base, intent: "transfer", confidence };
  }

  if (transferHits > 0 && payBillHits === 0 && !biller) {
    return { ...base, intent: "transfer", confidence: Math.min(1, 0.5 + transferHits * 0.12) };
  }

  // A named biller plus a payment verb is a bill payment.
  if (biller && (payBillHits > 0 || base.amountCents !== null)) {
    return { ...base, intent: "pay_bill", confidence: Math.min(1, 0.6 + payBillHits * 0.1) };
  }

  // Asking what is outstanding outranks a bare payment verb when no biller was
  // named: "我有咩單未交" contains 交 but is a question, not an instruction.
  if (listBillsHits > 0 && !biller) {
    return { ...base, intent: "list_bills", confidence: Math.min(1, 0.55 + listBillsHits * 0.12) };
  }

  if (payBillHits > 0) {
    return { ...base, intent: "pay_bill", confidence: Math.min(1, 0.45 + payBillHits * 0.12) };
  }

  if (listBillsHits > 0 && balanceHits === 0) {
    return { ...base, intent: "list_bills", confidence: Math.min(1, 0.55 + listBillsHits * 0.12) };
  }

  // Advice outranks balance when both appear, because the PRD's Journey 1
  // combines them ("我有幾多錢...畀少少儲錢建議我") and the richer answer
  // covers both.
  if (adviceHits > 0) {
    const confidence = Math.min(1, 0.6 + adviceHits * 0.12 + (balanceHits > 0 ? 0.15 : 0));
    return { ...base, intent: adviceHits > 0 && balanceHits > 0 ? "advice" : "advice", confidence };
  }

  if (balanceHits > 0) {
    return { ...base, intent: "balance", confidence: Math.min(1, 0.6 + balanceHits * 0.12) };
  }

  // Yes/no is resolved by the same strict gate the confirmation state uses, so
  // an incidental 好 inside an unrelated sentence can never be read as consent.
  const confirmation = detectConfirmation(raw);
  if (confirmation === "deny") {
    return { ...base, intent: "deny", confidence: 0.75 };
  }
  if (confirmation === "confirm") {
    return { ...base, intent: "confirm", confidence: 0.75 };
  }

  const repeatHits = score("repeat");
  if (repeatHits > 0) {
    return { ...base, intent: "repeat", confidence: Math.min(1, 0.6 + repeatHits * 0.15) };
  }

  const helpHits = score("help");
  if (helpHits > 0) {
    return { ...base, intent: "help", confidence: Math.min(1, 0.6 + helpHits * 0.15) };
  }

  const greetingHits = score("greeting");
  if (greetingHits > 0 && normalised.length <= 14) {
    return { ...base, intent: "greeting", confidence: 0.7 };
  }

  return { ...base, intent: "unknown", confidence: 0.1 };
}

/**
 * Lightweight confirmation detector used while the assistant is awaiting a
 * yes/no answer.
 *
 * This gate moves money, so it is deliberately stricter than parseIntent.
 * Short CJK affirmatives such as 好 / 係 are genuinely common confirmations,
 * but as substrings they are dangerously greedy — "今日天氣幾好" (the weather
 * is nice today) ends in 好 and must NOT authorise a transfer. Short forms are
 * therefore only accepted when they are the entire utterance, modulo trailing
 * particles.
 */
const CONFIRM_EXACT = new Set([
  "好", "係", "系", "是", "嗯", "行", "得", "對", "对", "可以", "確認", "确认",
  "yes", "yeah", "yep", "ok", "okay", "sure", "confirm", "right", "correct",
]);

const CONFIRM_STRONG = [
  "係呀", "係嘅", "係啊", "好啊", "好呀", "好嘅", "冇問題", "無問題", "没问题",
  "確認", "确认", "交啦", "繳啦", "缴啦", "畀啦", "俾啦", "轉啦", "转啦", "做啦",
  "去啦", "可以呀", "無問題", "繼續", "继续", "認得", "认得",
  "yes please", "go ahead", "please do", "that's right", "thats right", "continue",
];

const DENY_EXACT = new Set([
  "唔好", "不好", "不要", "唔使", "不用", "唔得", "停", "咪", "算了", "免",
  "no", "nope", "cancel", "stop", "wait", "never mind",
]);

const DENY_STRONG = [
  "取消", "咪住", "停一停", "停一下", "等等", "等一等", "唔想", "不想", "唔好呀",
  "唔好啊", "不要了", "算了吧", "唔該停", "唔使啦", "不用了", "cancel that",
  "stop", "don't", "do not", "hold on", "not now",
  "no thanks", "no thank you", "i dont think so", "definitely not", "not at all",
];

/** Strip trailing Cantonese/Putonghua particles so "好啊" matches "好". */
function stripParticles(text: string): string {
  return text.replace(/[呀啊啦嘅咯囉吧呢嘛喎㗎了]+$/g, "").trim();
}

export function detectConfirmation(utterance: string): "confirm" | "deny" | "unclear" {
  const normalised = normalise(utterance);
  const condensed = compact(utterance);
  const stripped = stripParticles(condensed);

  const denyStrong = keywordHits(normalised, condensed, DENY_STRONG);
  const confirmStrong = keywordHits(normalised, condensed, CONFIRM_STRONG);

  // Negation is checked first and wins ties: a false "confirm" spends money,
  // a false "deny" only costs a repeated question.
  if (denyStrong > 0 && denyStrong >= confirmStrong) return "deny";
  if (DENY_EXACT.has(stripped) || DENY_EXACT.has(condensed)) return "deny";
  if (confirmStrong > 0) return "confirm";
  if (CONFIRM_EXACT.has(stripped) || CONFIRM_EXACT.has(condensed)) return "confirm";
  if (denyStrong > 0) return "deny";

  return "unclear";
}
