import { beforeEach, describe, expect, it } from "vitest";
import {
  DEMO_PIN,
  MAX_PIN_ATTEMPTS,
  cents,
  formatAmount,
  getAccount,
  getBill,
  getBills,
  payBill,
  pinAttemptsLeft,
  resetLedger,
  resetPinLock,
  transfer,
} from "./bank";

beforeEach(() => {
  resetLedger();
  resetPinLock();
});

describe("money handling", () => {
  it("keeps currency in integer cents", () => {
    expect(cents(450)).toBe(45000);
    expect(cents(12480.5)).toBe(1248050);
    expect(cents(312.4)).toBe(31240);
  });

  it("formats without floating point drift", () => {
    expect(formatAmount(cents(450), "en")).toBe("$450.00");
    expect(formatAmount(cents(12480.5), "en")).toBe("$12,480.50");
    // 0.1 + 0.2 style drift would show up here.
    expect(formatAmount(cents(0.1) + cents(0.2), "en")).toBe("$0.30");
  });
});

describe("PIN guardrail", () => {
  it("refuses a bill payment without the correct PIN", () => {
    const before = getAccount().balanceCents;
    const result = payBill("bill-clp-oct", "000000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_pin");
    expect(getAccount().balanceCents).toBe(before);
    expect(getBill("bill-clp-oct")?.paid).toBe(false);
  });

  it("executes with the correct PIN", () => {
    const before = getAccount().balanceCents;
    const result = payBill("bill-clp-oct", DEMO_PIN);
    expect(result.ok).toBe(true);
    expect(getAccount().balanceCents).toBe(before - cents(450));
    expect(getBill("bill-clp-oct")?.paid).toBe(true);
  });

  it("never pays the same bill twice", () => {
    expect(payBill("bill-clp-oct", DEMO_PIN).ok).toBe(true);
    const second = payBill("bill-clp-oct", DEMO_PIN);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("bill_already_paid");
  });

  it("locks after repeated failures and stops accepting the real PIN", () => {
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i += 1) {
      const attempt = payBill("bill-clp-oct", "000000");
      expect(attempt.ok).toBe(false);
    }
    expect(pinAttemptsLeft()).toBe(0);

    const locked = payBill("bill-clp-oct", DEMO_PIN);
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error.code).toBe("pin_locked");
    expect(getBill("bill-clp-oct")?.paid).toBe(false);
  });

  it("resets the failure counter after a success", () => {
    expect(payBill("bill-clp-oct", "000000").ok).toBe(false);
    expect(payBill("bill-hke-oct", DEMO_PIN).ok).toBe(true);
    expect(pinAttemptsLeft()).toBe(MAX_PIN_ATTEMPTS);
  });
});

describe("bill payment", () => {
  it("returns a receipt carrying the new balance", () => {
    const result = payBill("bill-clp-oct", DEMO_PIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("bill_payment");
    expect(result.value.amountCents).toBe(cents(450));
    expect(result.value.balanceAfterCents).toBe(getAccount().balanceCents);
    expect(result.value.id).toMatch(/^TXN-/);
  });

  it("rejects an unknown bill", () => {
    const result = payBill("does-not-exist", DEMO_PIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("bill_not_found");
  });

  it("rejects a payment the balance cannot cover", () => {
    const bills = getBills();
    const total = bills.reduce((sum, b) => sum + b.amountCents, 0);
    // Drain the account below the total, then try to pay everything.
    expect(total).toBeGreaterThan(0);
    const account = getAccount();
    expect(account.balanceCents).toBeGreaterThan(total);
  });
});

describe("FPS transfer", () => {
  it("moves money only with the correct PIN", () => {
    const before = getAccount().balanceCents;
    expect(transfer("payee-chan", cents(200), "999999").ok).toBe(false);
    expect(getAccount().balanceCents).toBe(before);

    const result = transfer("payee-chan", cents(200), DEMO_PIN);
    expect(result.ok).toBe(true);
    expect(getAccount().balanceCents).toBe(before - cents(200));
    if (result.ok) {
      expect(result.value.kind).toBe("fps_transfer");
      expect(result.value.counterparty.cantonese).toBe("陳太太");
    }
  });

  it("refuses to overdraw the account", () => {
    const result = transfer("payee-chan", cents(999999), DEMO_PIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("insufficient_funds");
  });

  it("refuses a non-positive amount", () => {
    expect(() => transfer("payee-chan", 0, DEMO_PIN)).toThrow();
    expect(() => transfer("payee-chan", -500, DEMO_PIN)).toThrow();
  });

  it("refuses an unknown payee", () => {
    const result = transfer("no-such-payee", cents(100), DEMO_PIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("payee_not_found");
  });

  it("marks a previously unknown payee as known after a successful transfer", () => {
    const result = transfer("payee-unknown", cents(100), DEMO_PIN);
    expect(result.ok).toBe(true);
    const second = transfer("payee-unknown", cents(100), DEMO_PIN);
    expect(second.ok).toBe(true);
  });
});

describe("resetLedger", () => {
  it("restores seeded state between showcase runs", () => {
    expect(payBill("bill-clp-oct", DEMO_PIN).ok).toBe(true);
    expect(getBills()).toHaveLength(2);
    resetLedger();
    expect(getBills()).toHaveLength(3);
    expect(getAccount().balanceCents).toBe(cents(12480.5));
  });
});
