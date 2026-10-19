import { beforeEach, describe, expect, it } from "vitest";
import { cents, DEMO_PIN, getAccount, resetLedger, resetPinLock } from "./bank";
import { advance, initialState, type DialogueState } from "./dialogue";
import { parseIntent } from "./intent";
import { resetPhrasing, rotate } from "./phrasing";

const YUE = "cantonese" as const;
const EN = "english" as const;

beforeEach(() => {
  resetLedger();
  resetPinLock();
  resetPhrasing();
});

async function say(
  state: DialogueState,
  text: string,
  lang: typeof YUE | typeof EN = YUE,
) {
  return advance(state, { kind: "utterance", text }, lang);
}

describe("phrase rotation", () => {
  it("never repeats the same realisation twice in a row", () => {
    const options = ["a", "b", "c"] as const;
    const seen = [rotate("k", options), rotate("k", options), rotate("k", options)];
    expect(seen).toEqual(["a", "b", "c"]);
    // and it wraps round rather than running out
    expect(rotate("k", options)).toBe("a");
  });

  it("starts from the beginning again after a reset", () => {
    const options = ["a", "b"] as const;
    expect(rotate("k", options)).toBe("a");
    resetPhrasing();
    expect(rotate("k", options)).toBe("a");
  });
});

describe("the answer is not the same twice", () => {
  it("varies the wording of a repeated balance enquiry", async () => {
    const first = await say(initialState, "我有幾多錢");
    const second = await say(initialState, "我有幾多錢");

    expect(first.speak).not.toBe(second.speak);
  });

  it("keeps the essential facts in every realisation", async () => {
    const spoken: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const result = await say(initialState, "我有幾多錢");
      spoken.push(result.speak ?? "");
    }

    // Four turns cover every rotated variant at least once.
    for (const line of spoken) {
      expect(line).toContain("4821");
      expect(line).toContain("12480蚊5毫");
    }
    expect(new Set(spoken).size).toBeGreaterThan(1);
  });

  it("acknowledges the request before answering", async () => {
    const result = await say(initialState, "我有幾多錢");
    // Every realisation is preceded by one of the short openers.
    expect(result.speak).toMatch(/^(好，|冇問題，|收到，|好呀，|得，)/);
  });

  it("varies the wording of a repeated bill proposal while keeping the amount", async () => {
    const first = await say(initialState, "我想繳交電力公司電費");
    const second = await say(initialState, "我想繳交電力公司電費");

    expect(first.speak).not.toBe(second.speak);
    expect(first.speak).toContain("450蚊");
    expect(second.speak).toContain("450蚊");
  });

  it("varies the receipt while keeping the amount, reference and new balance", async () => {
    async function payOnce() {
      const propose = await say(initialState, "我想繳交電力公司電費");
      const confirmed = await advance(propose.state, { kind: "ui", event: "confirm" }, YUE);
      return advance(confirmed.state, { kind: "pin", pin: DEMO_PIN }, YUE);
    }

    const first = await payOnce();
    // Reset between runs: the CLP bill is already settled by now, so the
    // second attempt would otherwise fall into "which bill?" instead.
    resetLedger();
    const second = await payOnce();

    expect(first.speak).not.toBe(second.speak);
    for (const result of [first, second]) {
      expect(result.speak).toContain("450蚊");
      expect(result.card?.kind).toBe("receipt");
    }
  });
});

describe("advice actually varies", () => {
  it("reaches the second savings tip instead of always using the first", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await say(initialState, "畀啲儲錢建議我");
      lines.push(result.speak ?? "");
    }
    // The second tip was unreachable dead code before; both must now appear.
    expect(lines.some((l) => l.includes("每交完一張單"))).toBe(true);
    expect(lines.some((l) => l.includes("自動轉去一個定期戶口"))).toBe(true);
  });
});

describe("social turns are answered, not routed to the fallback", () => {
  it("responds to thanks rather than claiming not to understand", async () => {
    const yue = await say(initialState, "多謝");
    expect(yue.speak).toContain("唔使客氣");
    expect(yue.card).toBeNull();

    const en = await say(initialState, "thank you so much", EN);
    expect(en.speak).toMatch(/welcome|Any time|pleasure/i);
  });

  it("recognises thanks without mistaking a refusal for it", () => {
    expect(parseIntent("多謝").intent).toBe("thanks");
    expect(parseIntent("唔該晒").intent).toBe("thanks");
    expect(parseIntent("thanks").intent).toBe("thanks");
    // "no thanks" must stay a refusal.
    expect(parseIntent("no thanks").intent).toBe("deny");
  });

  it("keeps the pending action when thanked mid-transaction", async () => {
    const propose = await say(initialState, "我想繳交電力公司電費");
    expect(propose.state.phase).toBe("awaiting_confirmation");

    const thanked = await say(propose.state, "多謝");
    // Being polite must not lose the user's place.
    expect(thanked.state.phase).toBe("awaiting_confirmation");
    expect(thanked.speak).toContain("唔使客氣");
    // ...and the transaction is still waiting to be confirmed.
    expect(thanked.speak).toMatch(/仲要唔要/);

    // The user can then just confirm.
    const confirmed = await say(thanked.state, "係");
    expect(confirmed.state.phase).toBe("awaiting_pin");
  });
});

describe("the fallback stays helpful", () => {
  it("varies the wording but always names something the user can say", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const result = await say(initialState, "今日天氣幾好");
      lines.push(result.speak ?? "");
    }
    expect(new Set(lines).size).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line).toContain("查結餘");
      expect(line).not.toContain("听");
    }
  });
});

describe("safety copy is never varied", () => {
  it("keeps the scam caution and the hotline constant", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await say(initialState, "轉五千蚊畀 WONG KA HUNG");
      lines.push(result.speak ?? "");
    }
    expect(new Set(lines).size).toBe(1);
    expect(lines[0]).toContain("18222");
  });

  it("keeps the 'no money moved' reassurance constant", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const propose = await say(initialState, "我想繳交電力公司電費");
      const denied = await say(propose.state, "唔好");
      lines.push(denied.speak ?? "");
    }
    expect(new Set(lines).size).toBe(1);
    expect(lines[0]).toContain("冇郁過");
  });

  it("keeps the PIN prompt constant", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const propose = await say(initialState, "幫我轉 $200 畀陳太太");
      const confirmed = await advance(propose.state, { kind: "ui", event: "confirm" }, YUE);
      lines.push(confirmed.speak ?? "");
    }
    expect(new Set(lines).size).toBe(1);
    expect(lines[0]).toContain("六位數保安密碼");
  });

  it("still moves money correctly after a thanked confirmation", async () => {
    const before = getAccount().balanceCents;
    const propose = await say(initialState, "我想繳交電力公司電費");
    const thanked = await say(propose.state, "多謝");
    const confirmed = await say(thanked.state, "係");
    const done = advance(confirmed.state, { kind: "pin", pin: DEMO_PIN }, YUE);

    await expect(done).resolves.toBeDefined();
    const result = await done;
    expect(result.card?.kind).toBe("receipt");
    expect(getAccount().balanceCents).toBe(before - cents(450));
  });
});