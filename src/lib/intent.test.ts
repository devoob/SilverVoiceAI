import { beforeEach, describe, expect, it } from "vitest";
import { resetLedger } from "./bank";
import { detectConfirmation, findBiller, findPayee, normalise, parseIntent } from "./intent";

beforeEach(() => {
  resetLedger();
});

describe("normalise", () => {
  it("folds full-width characters and strips punctuation", () => {
    expect(normalise("轉＄２００畀陳太太。")).toBe("轉 200畀陳太太");
    expect(normalise("Hello, World!")).toBe("hello world");
  });
});

describe("parseIntent — PRD Journey 1 (balance + savings advice)", () => {
  const utterance = "我有幾多錢喺入面？可唔可以畀少少儲錢建議我？";

  it("classifies the flagship Cantonese request as advice, not a transfer", () => {
    // Regression guard: 畀 is an ordinary Cantonese preposition. When it was
    // listed as transfer evidence this utterance was misread as an FPS
    // transfer, which would have been the worst possible failure on stage.
    const parsed = parseIntent(utterance);
    expect(parsed.intent).toBe("advice");
    expect(parsed.amountCents).toBeNull();
    expect(parsed.payeeId).toBeNull();
  });

  it("classifies a balance-only request as balance", () => {
    expect(parseIntent("我有幾多錢喺入面").intent).toBe("balance");
    expect(parseIntent("check my balance").intent).toBe("balance");
    expect(parseIntent("查結餘").intent).toBe("balance");
  });
});

describe("parseIntent — PRD Journey 2 (utility bill)", () => {
  it("resolves the electricity bill request to CLP", () => {
    const parsed = parseIntent("我想繳交電力公司電費。");
    expect(parsed.intent).toBe("pay_bill");
    expect(parsed.billerId).toBe("clp");
  });

  it("resolves water and gas requests", () => {
    expect(parseIntent("我要交水費").billerId).toBe("water");
    expect(parseIntent("交煤氣").billerId).toBe("towngas");
    expect(parseIntent("pay my water bill").billerId).toBe("water");
  });

  it("flags a bare payment verb as pay_bill even without a named biller", () => {
    expect(parseIntent("我想交單").intent).toBe("pay_bill");
  });

  it("lists bills when asked what is outstanding", () => {
    expect(parseIntent("我有咩單未交").intent).toBe("list_bills");
    expect(parseIntent("what bills do I have").intent).toBe("list_bills");
  });
});

describe("parseIntent — PRD Journey 3 (FPS transfer)", () => {
  it("extracts payee and amount from the code-switched request", () => {
    const parsed = parseIntent("幫我轉 $200 畀陳太太。");
    expect(parsed.intent).toBe("transfer");
    expect(parsed.payeeId).toBe("payee-chan");
    expect(parsed.amountCents).toBe(20000);
  });

  it("handles a fully Cantonese transfer with a spoken amount", () => {
    const parsed = parseIntent("轉兩百蚊畀陳太太");
    expect(parsed.intent).toBe("transfer");
    expect(parsed.payeeId).toBe("payee-chan");
    expect(parsed.amountCents).toBe(20000);
  });

  it("handles a fully English transfer", () => {
    const parsed = parseIntent("transfer two hundred dollars to Mrs Chan");
    expect(parsed.intent).toBe("transfer");
    expect(parsed.payeeId).toBe("payee-chan");
    expect(parsed.amountCents).toBe(20000);
  });

  it("handles FPS by name in Putonghua", () => {
    const parsed = parseIntent("用转数快转三百元给李师傅");
    expect(parsed.intent).toBe("transfer");
    expect(parsed.payeeId).toBe("payee-lee");
    expect(parsed.amountCents).toBe(30000);
  });

  it("asks for a payee when only the verb is given", () => {
    const parsed = parseIntent("我想轉數快");
    expect(parsed.intent).toBe("transfer");
    expect(parsed.payeeId).toBeNull();
  });

  it("asks for an amount when only the payee is given", () => {
    const parsed = parseIntent("轉錢畀陳太太");
    expect(parsed.intent).toBe("transfer");
    expect(parsed.payeeId).toBe("payee-chan");
    expect(parsed.amountCents).toBeNull();
  });
});

describe("parseIntent — safety-critical intents", () => {
  it("prioritises a human handover over anything else", () => {
    expect(parseIntent("我想搵真人幫手").intent).toBe("handover");
    expect(parseIntent("talk to a person please").intent).toBe("handover");
    expect(parseIntent("我聽唔明").intent).toBe("handover");
    // Even when a transaction is also mentioned, handover wins.
    expect(parseIntent("幫我交電費，我要搵真人").intent).toBe("handover");
  });

  it("recognises refusals", () => {
    expect(parseIntent("唔好").intent).toBe("deny");
    expect(parseIntent("取消").intent).toBe("deny");
    expect(parseIntent("no thanks").intent).toBe("deny");
  });

  it("recognises a repeat request", () => {
    expect(parseIntent("再講一次").intent).toBe("repeat");
    expect(parseIntent("sorry, say that again").intent).toBe("repeat");
  });

  it("falls back to unknown rather than guessing", () => {
    expect(parseIntent("今日天氣幾好").intent).toBe("unknown");
    expect(parseIntent("").intent).toBe("unknown");
  });
});

describe("entity resolution", () => {
  it("prefers the longest matching alias", () => {
    // "電力公司" must win over the shorter "電費" so CLP resolves correctly.
    expect(findBiller("電力公司")).toBe("clp");
    expect(findBiller("港燈電費")).toBe("hkelectric");
  });

  it("matches payees across all three languages", () => {
    expect(findPayee("陳太太")).toBe("payee-chan");
    expect(findPayee("陈太太")).toBe("payee-chan");
    expect(findPayee("Mrs Chan")).toBe("payee-chan");
    expect(findPayee("send to MRS CHAN now")).toBe("payee-chan");
  });

  it("does not match a payee inside an unrelated word", () => {
    expect(findPayee("check my balance")).toBeNull();
  });
});

describe("detectConfirmation", () => {
  it("reads the PRD's spoken confirmation", () => {
    expect(detectConfirmation("係，幫我交啦。")).toBe("confirm");
    expect(detectConfirmation("好啊")).toBe("confirm");
    expect(detectConfirmation("yes please")).toBe("confirm");
  });

  it("reads refusals, and prefers refusal on a tie", () => {
    expect(detectConfirmation("唔好")).toBe("deny");
    expect(detectConfirmation("唔好，取消")).toBe("deny");
    expect(detectConfirmation("no")).toBe("deny");
    // "唔好" contains 好, so denial must win the tie rather than proceed.
    expect(detectConfirmation("唔好呀")).toBe("deny");
  });

  it("reports unclear when neither is present", () => {
    expect(detectConfirmation("今日天氣幾好")).toBe("unclear");
  });
});
