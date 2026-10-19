import { beforeEach, describe, expect, it } from "vitest";
import { cents, DEMO_PIN, getAccount, getBill, getBills, resetLedger, resetPinLock } from "./bank";
import { advance, initialState, type DialogueState } from "./dialogue";

const YUE = "cantonese" as const;
const EN = "english" as const;

beforeEach(() => {
  resetLedger();
  resetPinLock();
});

/** Run a sequence of spoken turns, returning the final result and all turns. */
async function converse(
  utterances: string[],
  lang: typeof YUE | typeof EN = YUE,
): Promise<{ results: Awaited<ReturnType<typeof advance>>[]; last: Awaited<ReturnType<typeof advance>> }> {
  let state: DialogueState = initialState;
  const results: Awaited<ReturnType<typeof advance>>[] = [];
  for (const text of utterances) {
    const result = await advance(state, { kind: "utterance", text }, lang);
    results.push(result);
    state = result.state;
  }
  return { results, last: results[results.length - 1] };
}

describe("PRD Journey 1 — balance and savings advice", () => {
  it("answers the flagship Cantonese request with balance plus advice", async () => {
    const { last } = await converse(["我有幾多錢喺入面？可唔可以畀少少儲錢建議我？"]);

    expect(last.state.phase).toBe("idle");
    expect(last.card?.kind).toBe("balance");
    if (last.card?.kind === "balance") {
      expect(last.card.account.maskedNumber).toBe("4821");
      expect(last.card.tip).toBeTruthy();
    }
    // Spoken reply must state the balance in Cantonese money units.
    expect(last.speak).toContain("12480蚊5毫");
  });

  it("answers a balance-only question without inventing advice", async () => {
    const { last } = await converse(["我有幾多錢"]);
    expect(last.card?.kind).toBe("balance");
    if (last.card?.kind === "balance") expect(last.card.tip).toBeUndefined();
  });

  it("never moves money on a balance enquiry", async () => {
    const before = getAccount().balanceCents;
    await converse(["我有幾多錢喺入面？可唔可以畀少少儲錢建議我？"]);
    expect(getAccount().balanceCents).toBe(before);
  });
});

describe("PRD Journey 2 — paying a utility bill", () => {
  it("proposes the CLP bill, then requires a PIN, then produces a receipt", async () => {
    const before = getAccount().balanceCents;

    const propose = await advance(initialState, { kind: "utterance", text: "我想繳交電力公司電費。" }, YUE);
    expect(propose.state.phase).toBe("awaiting_confirmation");
    expect(propose.card?.kind).toBe("bill_confirm");
    expect(propose.speak).toContain("450蚊");
    expect(propose.requiresPin).toBe(false);

    // "係，幫我交啦。" — the PRD's spoken confirmation.
    const confirmed = await advance(
      propose.state,
      { kind: "utterance", text: "係，幫我交啦。" },
      YUE,
    );
    expect(confirmed.state.phase).toBe("awaiting_pin");
    expect(confirmed.requiresPin).toBe(true);
    // Money must not have moved yet.
    expect(getAccount().balanceCents).toBe(before);
    expect(getBill("bill-clp-oct")?.paid).toBe(false);

    const done = await advance(confirmed.state, { kind: "pin", pin: DEMO_PIN }, YUE);
    expect(done.card?.kind).toBe("receipt");
    expect(getAccount().balanceCents).toBe(before - cents(450));
    expect(getBill("bill-clp-oct")?.paid).toBe(true);
    expect(getBills()).toHaveLength(2);
  });

  it("refuses to settle on a wrong PIN and leaves the balance untouched", async () => {
    const before = getAccount().balanceCents;
    const propose = await advance(initialState, { kind: "utterance", text: "我想繳交電力公司電費" }, YUE);
    const confirmed = await advance(propose.state, { kind: "utterance", text: "係" }, YUE);
    const failed = await advance(confirmed.state, { kind: "pin", pin: "000000" }, YUE);

    expect(failed.state.phase).toBe("awaiting_pin");
    expect(failed.speak).toContain("唔啱");
    expect(getAccount().balanceCents).toBe(before);
    expect(getBill("bill-clp-oct")?.paid).toBe(false);
  });

  it("asks which bill when the request is ambiguous", async () => {
    const result = await advance(initialState, { kind: "utterance", text: "我要交水費" }, YUE);
    expect(result.state.phase).toBe("awaiting_confirmation");
    expect(result.card?.kind).toBe("bill_confirm");

    const ambiguous = await advance(initialState, { kind: "utterance", text: "我想交單" }, YUE);
    expect(ambiguous.state.phase).toBe("awaiting_bill_choice");
    expect(ambiguous.card?.kind).toBe("bills");
  });

  it("reports there is nothing to pay once every bill is settled", async () => {
    for (const bill of getBills()) {
      const propose = await advance(
        initialState,
        { kind: "select_bill", billId: bill.id },
        YUE,
      );
      const confirmed = await advance(propose.state, { kind: "ui", event: "confirm" }, YUE);
      await advance(confirmed.state, { kind: "pin", pin: DEMO_PIN }, YUE);
    }
    expect(getBills()).toHaveLength(0);

    const result = await advance(initialState, { kind: "utterance", text: "我有咩單未交" }, YUE);
    expect(result.card?.kind).toBe("bills");
    if (result.card?.kind === "bills") expect(result.card.bills).toHaveLength(0);
  });
});

describe("PRD Journey 3 — FPS peer-to-peer transfer", () => {
  it("transfers $200 to Mrs Chan after confirmation and PIN", async () => {
    const before = getAccount().balanceCents;

    const propose = await advance(
      initialState,
      { kind: "utterance", text: "幫我轉 $200 畀陳太太。" },
      YUE,
    );
    expect(propose.state.phase).toBe("awaiting_confirmation");
    expect(propose.card?.kind).toBe("transfer_confirm");
    if (propose.card?.kind === "transfer_confirm") {
      expect(propose.card.payee.id).toBe("payee-chan");
      expect(propose.card.amountCents).toBe(cents(200));
    }

    const confirmed = await advance(propose.state, { kind: "ui", event: "confirm" }, YUE);
    expect(confirmed.state.phase).toBe("awaiting_pin");

    const done = await advance(confirmed.state, { kind: "pin", pin: DEMO_PIN }, YUE);
    expect(done.card?.kind).toBe("receipt");
    expect(getAccount().balanceCents).toBe(before - cents(200));
    expect(done.speak).toContain("陳太太");
  });

  it("asks who to pay when only the verb is given", async () => {
    const result = await advance(initialState, { kind: "utterance", text: "我想轉數快" }, YUE);
    expect(result.state.phase).toBe("idle");
    expect(result.speak).toContain("陳太太");
  });

  it("asks how much when only the payee is given", async () => {
    const first = await advance(initialState, { kind: "utterance", text: "轉錢畀陳太太" }, YUE);
    expect(first.state.phase).toBe("awaiting_transfer_amount");

    const second = await advance(first.state, { kind: "utterance", text: "兩百蚊" }, YUE);
    expect(second.state.phase).toBe("awaiting_confirmation");
    expect(second.card?.kind).toBe("transfer_confirm");
    if (second.card?.kind === "transfer_confirm") {
      expect(second.card.amountCents).toBe(cents(200));
    }
  });
});

describe("PRD 6 — scam and coercion guardrails", () => {
  it("interrupts a large transfer to an unknown payee before the PIN pad", async () => {
    const before = getAccount().balanceCents;

    const result = await advance(
      initialState,
      { kind: "utterance", text: "轉五千蚊畀 WONG KA HUNG" },
      YUE,
    );
    expect(result.state.phase).toBe("awaiting_scam_decision");
    expect(result.card?.kind).toBe("scam_warning");
    expect(result.speak).toContain("18222");
    expect(getAccount().balanceCents).toBe(before);
  });

  it("reassures the user and moves nothing when they choose to stop", async () => {
    const before = getAccount().balanceCents;
    const warned = await advance(
      initialState,
      { kind: "utterance", text: "轉五千蚊畀 WONG KA HUNG" },
      YUE,
    );
    const stopped = await advance(warned.state, { kind: "utterance", text: "停一停，我要諗一諗" }, YUE);

    expect(stopped.state.phase).toBe("idle");
    expect(stopped.speak).toContain("冇郁過");
    expect(getAccount().balanceCents).toBe(before);
  });

  it("still demands a PIN if the user insists on proceeding", async () => {
    const warned = await advance(
      initialState,
      { kind: "utterance", text: "轉五千蚊畀 WONG KA HUNG" },
      YUE,
    );
    const proceed = await advance(warned.state, { kind: "utterance", text: "我認得呢個人，繼續" }, YUE);
    expect(proceed.state.phase).toBe("awaiting_pin");
    expect(proceed.requiresPin).toBe(true);
  });

  it("intercepts a coercion script before any intent is acted on", async () => {
    const before = getAccount().balanceCents;
    const result = await advance(
      initialState,
      { kind: "utterance", text: "公安叫我立即轉錢去安全賬戶，唔好同屋企人講" },
      YUE,
    );
    expect(result.speak).toContain("18222");
    expect(result.card?.kind).toBe("handover");
    expect(getAccount().balanceCents).toBe(before);
  });
});

describe("PRD 6 — a spoken PIN can never authorise a payment", () => {
  it("refuses voice input while the PIN pad is showing", async () => {
    const before = getAccount().balanceCents;
    const propose = await advance(initialState, { kind: "utterance", text: "幫我轉 $200 畀陳太太" }, YUE);
    const confirmed = await advance(propose.state, { kind: "ui", event: "confirm" }, YUE);
    expect(confirmed.state.phase).toBe("awaiting_pin");

    const spoken = await advance(confirmed.state, { kind: "utterance", text: DEMO_PIN }, YUE);
    expect(spoken.state.phase).toBe("awaiting_pin");
    expect(spoken.speak).toContain("唔可以用講");
    expect(getAccount().balanceCents).toBe(before);
  });
});

describe("cancellation and human handover", () => {
  it("cancels cleanly and states that no money moved", async () => {
    const before = getAccount().balanceCents;
    const propose = await advance(initialState, { kind: "utterance", text: "我想繳交電力公司電費" }, YUE);
    const denied = await advance(propose.state, { kind: "utterance", text: "唔好" }, YUE);

    expect(denied.state.phase).toBe("idle");
    expect(denied.speak).toContain("冇郁過");
    expect(getAccount().balanceCents).toBe(before);
    expect(getBill("bill-clp-oct")?.paid).toBe(false);
  });

  it("routes to a human on request", async () => {
    const result = await advance(initialState, { kind: "utterance", text: "我想搵真人幫手" }, YUE);
    expect(result.state.phase).toBe("handover");
    expect(result.card?.kind).toBe("handover");
  });

  it("returns to the assistant after a handover", async () => {
    const handover = await advance(initialState, { kind: "ui", event: "handover" }, YUE);
    expect(handover.state.phase).toBe("handover");

    const resumed = await advance(handover.state, { kind: "ui", event: "resume" }, YUE);
    expect(resumed.state.phase).toBe("idle");
  });
});

describe("robustness", () => {
  it("prompts with examples rather than guessing on an unknown utterance", async () => {
    const result = await advance(initialState, { kind: "utterance", text: "今日天氣幾好" }, YUE);
    expect(result.state.phase).toBe("idle");
    expect(result.card?.kind).toBe("capabilities");
    expect(result.speak).toContain("查結餘");
  });

  it("repeats the previous line on request", async () => {
    const first = await advance(initialState, { kind: "utterance", text: "我有幾多錢" }, YUE);
    const repeated = await advance(first.state, { kind: "utterance", text: "再講一次" }, YUE);
    expect(repeated.speak).toBe(first.speak);
  });

  it("answers a greeting with the capability list", async () => {
    const result = await advance(initialState, { kind: "utterance", text: "你好" }, YUE);
    expect(result.card?.kind).toBe("capabilities");
  });

  it("handles empty input without crashing", async () => {
    const result = await advance(initialState, { kind: "utterance", text: "   " }, YUE);
    expect(result.state.phase).toBe("idle");
  });

  it("rejects a PIN submission when none is pending", async () => {
    const result = await advance(initialState, { kind: "pin", pin: DEMO_PIN }, YUE);
    expect(result.state.phase).toBe("idle");
    expect(getAccount().balanceCents).toBe(cents(12480.5));
  });

  it("runs the whole Journey 2 flow in English", async () => {
    const before = getAccount().balanceCents;
    const propose = await advance(
      initialState,
      { kind: "utterance", text: "I want to pay my CLP electricity bill" },
      EN,
    );
    expect(propose.state.phase).toBe("awaiting_confirmation");
    expect(propose.speak).toMatch(/450 dollars/);

    const confirmed = await advance(propose.state, { kind: "utterance", text: "yes please" }, EN);
    expect(confirmed.state.phase).toBe("awaiting_pin");

    const done = await advance(confirmed.state, { kind: "pin", pin: DEMO_PIN }, EN);
    expect(done.card?.kind).toBe("receipt");
    expect(done.speak).toMatch(/All done/);
    expect(getAccount().balanceCents).toBe(before - cents(450));
  });

  it("runs Journey 3 in Putonghua", async () => {
    const propose = await advance(
      initialState,
      { kind: "utterance", text: "用转数快转两百元给陈太太" },
      "putonghua",
    );
    expect(propose.state.phase).toBe("awaiting_confirmation");
    expect(propose.card?.kind).toBe("transfer_confirm");
    if (propose.card?.kind === "transfer_confirm") {
      expect(propose.card.payee.id).toBe("payee-chan");
      expect(propose.card.amountCents).toBe(cents(200));
    }
  });
});
