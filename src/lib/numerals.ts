/**
 * Trilingual amount parsing.
 *
 * Handles three forms an elderly Hong Kong user may produce, including the
 * mixed code-switching called out in the PRD ("transfer $200 to 陳太太"):
 *
 *   1. Arabic digits          "200", "$200", "1,200.50", "200蚊"
 *   2. Chinese numerals       "兩百", "四百五十", "四百五", "廿五", "一萬二千"
 *   3. English number words   "two hundred dollars", "four fifty"
 *
 * All results are integer cents.
 */

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0,
  一: 1, 壹: 1, 幺: 1,
  二: 2, 兩: 2, 两: 2, 貳: 2, 贰: 2,
  三: 3, 叁: 3, 參: 3, 参: 3,
  四: 4, 肆: 4,
  五: 5, 伍: 5,
  六: 6, 陸: 6, 陆: 6,
  七: 7, 柒: 7,
  八: 8, 捌: 8,
  九: 9, 玖: 9,
};

const CN_UNITS: Record<string, number> = {
  十: 10, 拾: 10,
  百: 100, 佰: 100,
  千: 1000, 仟: 1000,
};

/** Compact Cantonese/Chinese tens: 廿=20, 卅=30, 卌=40 */
const CN_TENS: Record<string, number> = { 廿: 20, 卅: 30, 卌: 40 };

const CN_HIGH: Record<string, number> = { 萬: 10_000, 万: 10_000, 億: 100_000_000, 亿: 100_000_000 };

const CN_NUMERAL_CHARS = new Set([
  ...Object.keys(CN_DIGITS),
  ...Object.keys(CN_UNITS),
  ...Object.keys(CN_TENS),
  ...Object.keys(CN_HIGH),
]);

/** Currency markers in Cantonese, Putonghua and English. */
const CURRENCY_WORDS = [
  "港幣", "港币", "港紙", "港纸", "蚊", "元", "塊", "块", "圓", "圆", "钱", "錢",
  "hkd", "dollars", "dollar", "bucks", "buck",
];

const EN_ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const EN_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** Normalise full-width digits and unify traditional/simplified variants. */
function normaliseDigits(input: string): string {
  return input.replace(/[\uFF10-\uFF19]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
  );
}

/**
 * Parse a section below 萬/億, e.g. "四千五百二十".
 *
 * Implements the colloquial trailing-digit rule that Cantonese and Mandarin
 * speakers use constantly: 四百五 means 450, not 405, and 二千三 means 2300.
 */
function parseSection(chars: string[]): number | null {
  let total = 0;
  let current = 0;
  let lastUnit = 0;
  let sawSomething = false;

  for (const ch of chars) {
    if (ch in CN_DIGITS) {
      current = CN_DIGITS[ch];
      sawSomething = true;
      continue;
    }
    if (ch in CN_UNITS) {
      const unit = CN_UNITS[ch];
      // "十五" has no leading digit; treat it as 1*10.
      if (current === 0) current = 1;
      total += current * unit;
      current = 0;
      lastUnit = unit;
      sawSomething = true;
      continue;
    }
    if (ch in CN_TENS) {
      total += CN_TENS[ch];
      current = 0;
      lastUnit = 10;
      sawSomething = true;
      continue;
    }
    return null;
  }

  if (current !== 0) {
    // Trailing bare digit after 百/千 scales down one order of magnitude.
    total += lastUnit >= 100 ? current * (lastUnit / 10) : current;
  }

  return sawSomething ? total : null;
}

/** Parse a full Chinese numeral string such as "一萬二千三百四十五". */
export function parseChineseNumber(input: string): number | null {
  const chars = [...normaliseDigits(input).replace(/[,，\s]/g, "")];
  if (chars.length === 0) return null;
  for (const ch of chars) {
    if (!CN_NUMERAL_CHARS.has(ch)) return null;
  }

  // Split from the highest-order separator downwards.
  let remainder = chars;
  let result = 0;

  for (const high of [100_000_000, 10_000]) {
    const idx = remainder.findIndex((ch) => CN_HIGH[ch] === high);
    if (idx === -1) continue;
    const left = remainder.slice(0, idx);
    const sectionValue = left.length === 0 ? 1 : parseSection(left);
    if (sectionValue === null) return null;
    result += sectionValue * high;
    remainder = remainder.slice(idx + 1);
  }

  if (remainder.length > 0) {
    const tail = parseSection(remainder);
    if (tail === null) return null;
    result += tail;
  }

  return Number.isFinite(result) && result > 0 ? result : null;
}

/** Parse English number words: "two hundred and fifty" -> 250. */
export function parseEnglishNumberWords(input: string): number | null {
  const words = normaliseDigits(input)
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 0 && w !== "and");

  if (words.length === 0) return null;

  let total = 0;
  let section = 0;
  let matched = false;

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const next = words[i + 1];

    if (word in EN_ONES) {
      const value = EN_ONES[word];
      // "four fifty" means 450, not 54. Reading a bare digit followed by a
      // tens word additively would silently produce a wrong amount, which in
      // a banking app is the worst possible failure mode.
      if (value >= 1 && value <= 9 && next !== undefined && next in EN_TENS) {
        section += value * 100;
      } else {
        section += value;
      }
      matched = true;
    } else if (word in EN_TENS) {
      section += EN_TENS[word];
      matched = true;
    } else if (word === "hundred") {
      section = (section === 0 ? 1 : section) * 100;
      matched = true;
    } else if (word === "thousand" || word === "million") {
      const multiplier = word === "thousand" ? 1000 : 1_000_000;
      total += (section === 0 ? 1 : section) * multiplier;
      section = 0;
      matched = true;
    } else {
      return null;
    }
  }

  const result = total + section;
  return matched && result > 0 ? result : null;
}

function toCents(units: number, fraction: number): number {
  return Math.round(units * 100 + fraction);
}

/** True when a Chinese numeral run is strong enough to be a money amount. */
function looksLikeAmount(run: string, followedByCurrency: boolean): boolean {
  if (followedByCurrency) return true;
  // Without a currency word we still need a unit character, otherwise we
  // would mis-fire on idioms like 諗一諗 / 停一停 / 一齊.
  return [...run].some((ch) => ch in CN_UNITS || ch in CN_TENS || ch in CN_HIGH);
}

/**
 * Extract a monetary amount from a free-form utterance.
 * Returns integer cents, or null when no amount is present.
 */
export function extractAmount(utterance: string): number | null {
  const text = normaliseDigits(utterance);
  const lowered = text.toLowerCase();

  // 1) Arabic digits — the strongest signal and what STT usually returns.
  const arabic = text.match(/(?:[$￥¥]|hkd\s*)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/i);
  if (arabic) {
    const units = Number(arabic[1].replace(/,/g, ""));
    if (Number.isFinite(units)) {
      const fraction = arabic[2] ? Math.round(Number(`0.${arabic[2]}`) * 100) : 0;
      return toCents(units, fraction);
    }
  }

  // 2) Chinese numeral runs.
  const numeralCharClass = [...CN_NUMERAL_CHARS].join("");
  const runPattern = new RegExp(`([${numeralCharClass}]{1,10})`, "g");
  const currencyPattern = CURRENCY_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  let match: RegExpExecArray | null;

  while ((match = runPattern.exec(text)) !== null) {
    const run = match[1];
    const after = text.slice(match.index + run.length).trimStart();
    const followedByCurrency = new RegExp(`^(?:${currencyPattern})`, "i").test(after);
    if (!looksLikeAmount(run, followedByCurrency)) continue;

    const value = parseChineseNumber(run);
    if (value !== null) return toCents(value, 0);
  }

  // 3) English number words, e.g. "two hundred dollars" / "four fifty".
  const englishPattern =
    /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)(?:[\s-]+(?:and[\s-]+)?(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million))*\b/gi;

  let enMatch: RegExpExecArray | null;
  while ((enMatch = englishPattern.exec(lowered)) !== null) {
    const phrase = enMatch[0];
    const after = lowered.slice(enMatch.index + phrase.length).trimStart();
    const followedByCurrency = new RegExp(`^(?:${currencyPattern})`, "i").test(after);
    const value = parseEnglishNumberWords(phrase);
    if (value === null) continue;
    // A bare number word with no currency marker is too weak ("one moment").
    if (!followedByCurrency && !/\b(hundred|thousand|million)\b/.test(phrase)) continue;
    return toCents(value, 0);
  }

  return null;
}

/**
 * Render an amount the way a person would say it aloud.
 *
 * Thousands separators are deliberately omitted for the Chinese forms: a TTS
 * engine reads "12480" as 一萬二千四百八十, but may stumble over the comma.
 * Minor units use the real spoken forms — 毫/仙 in Cantonese, 角/分 in
 * Putonghua — rather than a decimal point.
 */
export function speakableAmount(
  amountCents: number,
  lang: "cantonese" | "putonghua" | "english",
): string {
  const major = Math.floor(Math.abs(amountCents) / 100);
  const minor = Math.abs(amountCents) % 100;

  if (lang === "english") {
    if (minor === 0) return `${major} dollars`;
    return `${major} dollars and ${minor} cents`;
  }

  if (lang === "cantonese") {
    if (minor === 0) return `${major}蚊`;
    const ho = Math.floor(minor / 10);
    const sin = minor % 10;
    if (sin === 0) return `${major}蚊${ho}毫`;
    if (ho === 0) return `${major}蚊${sin}仙`;
    return `${major}蚊${ho}毫${sin}仙`;
  }

  if (minor === 0) return `${major}元`;
  const jiao = Math.floor(minor / 10);
  const fen = minor % 10;
  if (fen === 0) return `${major}元${jiao}角`;
  if (jiao === 0) return `${major}元${fen}分`;
  return `${major}元${jiao}角${fen}分`;
}
