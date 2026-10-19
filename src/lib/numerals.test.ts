import { describe, expect, it } from "vitest";
import {
  extractAmount,
  parseChineseNumber,
  parseEnglishNumberWords,
  speakableAmount,
} from "./numerals";

describe("parseChineseNumber", () => {
  it("parses plain digits and simple units", () => {
    expect(parseChineseNumber("三")).toBe(3);
    expect(parseChineseNumber("十五")).toBe(15);
    expect(parseChineseNumber("二十")).toBe(20);
    expect(parseChineseNumber("一百")).toBe(100);
  });

  it("parses the amounts used in the PRD journeys", () => {
    // Journey 2: "你有張 450 蚊嘅電費單"
    expect(parseChineseNumber("四百五十")).toBe(450);
    // Journey 3: "幫我轉 $200 畀陳太太"
    expect(parseChineseNumber("兩百")).toBe(200);
    expect(parseChineseNumber("二百")).toBe(200);
  });

  it("handles the colloquial trailing-digit shorthand", () => {
    // 四百五 means 450, not 405 — the single most common spoken form.
    expect(parseChineseNumber("四百五")).toBe(450);
    expect(parseChineseNumber("二千三")).toBe(2300);
    expect(parseChineseNumber("一千五")).toBe(1500);
  });

  it("handles compact Cantonese tens", () => {
    expect(parseChineseNumber("廿五")).toBe(25);
    expect(parseChineseNumber("卅")).toBe(30);
  });

  it("handles high-order separators", () => {
    expect(parseChineseNumber("一萬二千")).toBe(12000);
    expect(parseChineseNumber("一萬二千三百四十五")).toBe(12345);
    expect(parseChineseNumber("一千五百")).toBe(1500);
  });

  it("accepts traditional and simplified variants", () => {
    expect(parseChineseNumber("兩百")).toBe(200);
    expect(parseChineseNumber("两百")).toBe(200);
    expect(parseChineseNumber("壹仟")).toBe(1000);
  });

  it("rejects non-numerals", () => {
    expect(parseChineseNumber("陳太太")).toBeNull();
    expect(parseChineseNumber("")).toBeNull();
    expect(parseChineseNumber("四百X")).toBeNull();
  });
});

describe("parseEnglishNumberWords", () => {
  it("parses cardinals and compounds", () => {
    expect(parseEnglishNumberWords("two hundred")).toBe(200);
    expect(parseEnglishNumberWords("two hundred and fifty")).toBe(250);
    expect(parseEnglishNumberWords("four fifty")).toBe(450);
    expect(parseEnglishNumberWords("one thousand two hundred")).toBe(1200);
  });

  it("rejects non-numbers", () => {
    expect(parseEnglishNumberWords("hello")).toBeNull();
  });
});

describe("extractAmount", () => {
  it("reads the PRD's Journey 3 Cantonese code-switched request", () => {
    expect(extractAmount("幫我轉 $200 畀陳太太。")).toBe(20000);
  });

  it("reads Chinese numerals with a Cantonese currency word", () => {
    expect(extractAmount("轉兩百蚊畀陳太太")).toBe(20000);
    expect(extractAmount("四百五十蚊")).toBe(45000);
    expect(extractAmount("一千五百元")).toBe(150000);
  });

  it("reads decimals and thousands separators", () => {
    expect(extractAmount("$1,200.50")).toBe(120050);
    expect(extractAmount("312.40")).toBe(31240);
  });

  it("reads English number words", () => {
    expect(extractAmount("transfer two hundred dollars to Mrs Chan")).toBe(20000);
  });

  it("returns null for the PRD's Journey 1 balance-and-advice request", () => {
    // This utterance contains 幾多錢 and the preposition 畀, but no amount.
    expect(extractAmount("我有幾多錢喺入面？可唔可以畀少少儲錢建議我？")).toBeNull();
  });

  it("does not fire on idioms containing a bare numeral", () => {
    expect(extractAmount("等我諗一諗")).toBeNull();
    expect(extractAmount("停一停")).toBeNull();
    expect(extractAmount("我一個人")).toBeNull();
  });

  it("returns null when there is no amount at all", () => {
    expect(extractAmount("我想繳交電力公司電費")).toBeNull();
    expect(extractAmount("check my balance")).toBeNull();
  });
});

describe("speakableAmount", () => {
  it("uses Cantonese minor units rather than a decimal point", () => {
    expect(speakableAmount(45000, "cantonese")).toBe("450蚊");
    expect(speakableAmount(1248050, "cantonese")).toBe("12480蚊5毫");
    expect(speakableAmount(1025, "cantonese")).toBe("10蚊2毫5仙");
    expect(speakableAmount(1005, "cantonese")).toBe("10蚊5仙");
  });

  it("uses Putonghua minor units", () => {
    expect(speakableAmount(45000, "putonghua")).toBe("450元");
    expect(speakableAmount(1248050, "putonghua")).toBe("12480元5角");
  });

  it("omits thousands separators so TTS reads the number as one figure", () => {
    expect(speakableAmount(1248050, "english")).toBe("12480 dollars and 50 cents");
    expect(speakableAmount(45000, "english")).toBe("450 dollars");
  });
});
