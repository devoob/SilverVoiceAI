import { describe, expect, it } from "vitest";
import { assessTransaction, detectCoercion, isScamWarning, LIMITS } from "./guardrails";
import { cents } from "./bank";

const baseFacts = {
  kind: "fps_transfer" as const,
  amountCents: cents(200),
  balanceCents: cents(12480.5),
  payeeTrusted: true,
  typicalAmountCents: cents(200),
};

describe("assessTransaction", () => {
  it("requires a PIN for every money movement, without exception", async () => {
    const transfer = await assessTransaction(baseFacts);
    expect(transfer.requiresPin).toBe(true);

    const bill = await assessTransaction({ ...baseFacts, kind: "bill_payment" });
    expect(bill.requiresPin).toBe(true);

    // Even a trivially small amount to a long-known payee.
    const tiny = await assessTransaction({ ...baseFacts, amountCents: 1 });
    expect(tiny.requiresPin).toBe(true);
  });

  it("lets a routine transfer to a known payee through with no warnings", async () => {
    const result = await assessTransaction(baseFacts);
    expect(result.blocked).toBe(false);
    expect(result.scamWarnings).toEqual([]);
  });

  it("warns on a first-time payee above the threshold", async () => {
    const result = await assessTransaction({
      ...baseFacts,
      payeeTrusted: false,
      typicalAmountCents: 0,
      amountCents: LIMITS.firstTimePayeeWarnCents,
    });
    expect(result.scamWarnings).toContain("scam_first_time_payee");
    expect(result.blocked).toBe(false);
  });

  it("does not warn on a small first-time payment", async () => {
    const result = await assessTransaction({
      ...baseFacts,
      payeeTrusted: false,
      typicalAmountCents: 0,
      amountCents: LIMITS.firstTimePayeeWarnCents - 1,
    });
    expect(result.scamWarnings).not.toContain("scam_first_time_payee");
  });

  it("warns when the amount is far above what this payee usually receives", async () => {
    const result = await assessTransaction({
      ...baseFacts,
      typicalAmountCents: cents(200),
      amountCents: cents(200) * LIMITS.unusualAmountRatio,
    });
    expect(result.scamWarnings).toContain("scam_unusual_amount");
  });

  it("warns on a high-value transfer regardless of payee history", async () => {
    const result = await assessTransaction({
      ...baseFacts,
      amountCents: LIMITS.highValueReviewCents,
      balanceCents: LIMITS.highValueReviewCents * 2,
    });
    expect(result.scamWarnings).toContain("high_value_review");
  });

  it("blocks a payment the balance cannot cover", async () => {
    const result = await assessTransaction({
      ...baseFacts,
      amountCents: cents(20000),
      balanceCents: cents(100),
    });
    expect(result.blocked).toBe(true);
    expect(result.findings.map((f) => f.code)).toContain("insufficient_funds");
  });

  it("never blocks solely because a warning fired", async () => {
    const result = await assessTransaction({
      ...baseFacts,
      payeeTrusted: false,
      typicalAmountCents: 0,
      amountCents: cents(9000),
    });
    expect(result.scamWarnings.length).toBeGreaterThan(0);
    expect(result.blocked).toBe(false);
  });
});

describe("isScamWarning", () => {
  it("identifies the caution codes", () => {
    expect(isScamWarning("scam_first_time_payee")).toBe(true);
    expect(isScamWarning("scam_unusual_amount")).toBe(true);
    expect(isScamWarning("high_value_review")).toBe(true);
    expect(isScamWarning("pin_required")).toBe(false);
    expect(isScamWarning("insufficient_funds")).toBe(false);
  });
});

describe("detectCoercion", () => {
  it("flags authority impersonation", () => {
    expect(detectCoercion("公安話要轉錢去安全賬戶").map((f) => f.reason)).toContain("third_party");
    expect(detectCoercion("the police say to transfer now").map((f) => f.reason)).toContain(
      "third_party",
    );
  });

  it("flags manufactured urgency", () => {
    expect(detectCoercion("要立即轉錢").map((f) => f.reason)).toContain("urgency");
    expect(detectCoercion("it is urgent, send now").map((f) => f.reason)).toContain("urgency");
  });

  it("flags demands for secrecy", () => {
    expect(detectCoercion("唔好同屋企人講").map((f) => f.reason)).toContain("secrecy");
    expect(detectCoercion("keep it secret from your family").map((f) => f.reason)).toContain(
      "secrecy",
    );
  });

  it("does not flag ordinary banking requests", () => {
    expect(detectCoercion("我想繳交電力公司電費")).toEqual([]);
    expect(detectCoercion("幫我轉 $200 畀陳太太")).toEqual([]);
    expect(detectCoercion("check my balance please")).toEqual([]);
  });
});
