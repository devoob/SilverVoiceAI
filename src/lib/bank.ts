/**
 * Mock banking ledger for the Bank on U showcase.
 *
 * There is no open-source HSBC or FPS API (see remaining.md), so this module
 * is the seam where a real core-banking integration would be swapped in.
 * It is deliberately client-side: it keeps the demo instant, works if the
 * venue wifi drops, and never puts fake credentials on a network.
 *
 * Money is handled in integer cents throughout. Floating point is never used
 * for currency — a rounding drift on a balance is exactly the kind of defect
 * that loses a judge's trust in a banking pitch.
 */

import { z } from "zod";

export const CURRENCY = "HKD";

/**
 * Demo PIN. Overridable at build time. This is a mock credential for a
 * competition showcase — a real deployment would use WebAuthn/passkeys
 * (see remaining.md §Security) and never store a PIN client-side.
 */
export const DEMO_PIN = process.env.NEXT_PUBLIC_DEMO_PIN ?? "123456";
export const PIN_LENGTH = 6;
export const MAX_PIN_ATTEMPTS = 3;

export const cents = (n: number): number => Math.round(n * 100);

export function formatCents(value: number, lang: string = "en"): string {
  const amount = value / 100;
  const nf = new Intl.NumberFormat(lang === "en" ? "en-HK" : "zh-HK", {
    style: "currency",
    currency: CURRENCY,
    minimumFractionDigits: 2,
  });
  return nf.format(amount);
}

/** Compact form for tight card layouts, e.g. "$450.00" */
export function formatAmount(value: number, lang: string = "en"): string {
  const nf = new Intl.NumberFormat(lang === "en" ? "en-HK" : "zh-HK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `$${nf.format(value / 100)}`;
}

export type BillerId = "clp" | "hkelectric" | "water" | "towngas";

export type LocalisedName = {
  cantonese: string;
  putonghua: string;
  english: string;
};

export type Biller = {
  id: BillerId;
  name: LocalisedName;
  /** Keywords a user might say when naming this biller, all three languages. */
  aliases: string[];
};

export const BILLERS: Record<BillerId, Biller> = {
  clp: {
    id: "clp",
    name: { cantonese: "中電（電力）", putonghua: "中华电力", english: "CLP Power" },
    aliases: [
      "中電控股", "中電", "中电", "中华电力", "中華電力", "clp",
      "電力公司", "电力公司", "九龍電力", "九龙电力",
    ],
  },
  hkelectric: {
    id: "hkelectric",
    name: { cantonese: "港燈", putonghua: "港灯", english: "HK Electric" },
    aliases: ["港燈", "港灯", "hk electric", "hkelectric", "香港電燈", "香港电灯", "港島電力"],
  },
  water: {
    id: "water",
    name: { cantonese: "水務署", putonghua: "水务署", english: "Water Supplies Department" },
    aliases: ["水務署", "水务署", "水費", "水费", "水務", "水务", "食水", "water"],
  },
  towngas: {
    id: "towngas",
    name: { cantonese: "煤氣公司", putonghua: "煤气公司", english: "Towngas" },
    aliases: ["煤氣公司", "煤气公司", "煤氣", "煤气", "towngas", "燃氣", "燃气", "gas"],
  },
};

export type Account = {
  id: string;
  maskedNumber: string;
  type: "savings" | "current";
  balanceCents: number;
};

export type Bill = {
  id: string;
  billerId: BillerId;
  amountCents: number;
  dueDate: string;
  accountRef: string;
  paid: boolean;
};

export type Payee = {
  id: string;
  name: LocalisedName;
  /** Aliases across languages, including the colloquial forms people say. */
  aliases: string[];
  fpsId: string;
  /** A payee the customer has sent money to before is treated as known. */
  trusted: boolean;
  typicalAmountCents: number;
};

export type Receipt = {
  id: string;
  kind: "bill_payment" | "fps_transfer";
  amountCents: number;
  counterparty: LocalisedName;
  reference: string;
  completedAt: string;
  balanceAfterCents: number;
};

type LedgerState = {
  account: Account;
  bills: Bill[];
  payees: Payee[];
  receipts: Receipt[];
};

function seed(): LedgerState {
  return {
    account: {
      id: "acc-001",
      maskedNumber: "4821",
      type: "savings",
      balanceCents: cents(12480.5),
    },
    bills: [
      {
        id: "bill-clp-oct",
        billerId: "clp",
        amountCents: cents(450),
        dueDate: "2026-11-05",
        accountRef: "812-4471-0093",
        paid: false,
      },
      {
        id: "bill-hke-oct",
        billerId: "hkelectric",
        amountCents: cents(312.4),
        dueDate: "2026-11-12",
        accountRef: "HKE-77120-338",
        paid: false,
      },
      {
        id: "bill-water-oct",
        billerId: "water",
        amountCents: cents(180),
        dueDate: "2026-11-20",
        accountRef: "5510-8827-41",
        paid: false,
      },
    ],
    payees: [
      {
        id: "payee-chan",
        name: { cantonese: "陳太太", putonghua: "陈太太", english: "Mrs Chan" },
        aliases: ["陳太太", "陈太太", "mrs chan", "chan tai tai", "陳太", "陈太", "chan"],
        fpsId: "852-9123-4477",
        trusted: true,
        typicalAmountCents: cents(200),
      },
      {
        id: "payee-lee",
        name: { cantonese: "李師傅", putonghua: "李师傅", english: "Mr Lee" },
        aliases: ["李師傅", "李师傅", "mr lee", "lee si fu", "李生", "lee"],
        fpsId: "852-6688-2010",
        trusted: true,
        typicalAmountCents: cents(350),
      },
      {
        id: "payee-grandson",
        name: { cantonese: "細明（孫仔）", putonghua: "细明（孙子）", english: "Siu Ming (grandson)" },
        aliases: ["細明", "细明", "siu ming", "孫仔", "孙子", "grandson"],
        fpsId: "852-5501-7788",
        trusted: true,
        typicalAmountCents: cents(500),
      },
      {
        id: "payee-unknown",
        name: {
          cantonese: "WONG KA HUNG",
          putonghua: "WONG KA HUNG",
          english: "WONG KA HUNG",
        },
        aliases: ["wong ka hung", "王家雄", "wong"],
        fpsId: "852-7004-9931",
        trusted: false,
        typicalAmountCents: 0,
      },
    ],
    receipts: [],
  };
}

let state: LedgerState = seed();

/** Restore the seeded demo state — used between showcase runs and in tests. */
export function resetLedger(): void {
  state = seed();
}

export function getAccount(): Account {
  return { ...state.account };
}

export function getBills(includePaid = false): Bill[] {
  return state.bills
    .filter((b) => includePaid || !b.paid)
    .map((b) => ({ ...b }));
}

export function getBill(id: string): Bill | undefined {
  const found = state.bills.find((b) => b.id === id);
  return found ? { ...found } : undefined;
}

export function getPayees(): Payee[] {
  return state.payees.map((p) => ({ ...p }));
}

export function getPayee(id: string): Payee | undefined {
  const found = state.payees.find((p) => p.id === id);
  return found ? { ...found } : undefined;
}

export function getReceipts(): Receipt[] {
  return state.receipts.map((r) => ({ ...r }));
}

export function billerOf(bill: Bill): Biller {
  return BILLERS[bill.billerId];
}

export const BillPaymentRequest = z.object({
  billId: z.string().min(1),
  pin: z.string().regex(new RegExp(`^\\d{${PIN_LENGTH}}$`), "PIN must be 6 digits"),
});

export const TransferRequest = z.object({
  payeeId: z.string().min(1),
  amountCents: z.number().int().positive(),
  pin: z.string().regex(new RegExp(`^\\d{${PIN_LENGTH}}$`), "PIN must be 6 digits"),
  reference: z.string().max(40).optional(),
});

export type BankError =
  | { code: "bill_not_found" }
  | { code: "bill_already_paid" }
  | { code: "payee_not_found" }
  | { code: "insufficient_funds" }
  | { code: "invalid_pin" }
  | { code: "pin_locked" };

export type BankResult<T> = { ok: true; value: T } | { ok: false; error: BankError };

const pinFailures = { count: 0, lockedUntil: 0 };

export function isPinLocked(): boolean {
  if (pinFailures.count < MAX_PIN_ATTEMPTS) return false;
  const now = Date.now();
  if (now < pinFailures.lockedUntil) return true;
  pinFailures.count = 0;
  return false;
}

export function resetPinLock(): void {
  pinFailures.count = 0;
  pinFailures.lockedUntil = 0;
}

export function pinAttemptsLeft(): number {
  return Math.max(0, MAX_PIN_ATTEMPTS - pinFailures.count);
}

/**
 * PIN verification. Constant-time-ish comparison so the timing of a wrong
 * digit doesn't leak information, and a lockout after repeated failures.
 */
function verifyPin(pin: string): BankResult<void> {
  if (isPinLocked()) return { ok: false, error: { code: "pin_locked" } };

  let mismatch = 0;
  for (let i = 0; i < PIN_LENGTH; i += 1) {
    mismatch |= pin.charCodeAt(i) ^ DEMO_PIN.charCodeAt(i);
  }
  if (mismatch !== 0) {
    pinFailures.count += 1;
    if (pinFailures.count >= MAX_PIN_ATTEMPTS) {
      pinFailures.lockedUntil = Date.now() + 60_000;
    }
    return { ok: false, error: { code: "invalid_pin" } };
  }
  pinFailures.count = 0;
  return { ok: true, value: undefined };
}

function makeReceipt(
  kind: Receipt["kind"],
  amountCents: number,
  counterparty: LocalisedName,
  reference: string,
): Receipt {
  const receipt: Receipt = {
    id: `TXN-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`,
    kind,
    amountCents,
    counterparty,
    reference,
    completedAt: new Date().toISOString(),
    balanceAfterCents: state.account.balanceCents,
  };
  state.receipts.unshift(receipt);
  return { ...receipt };
}

/**
 * Settle a bill. Only ever reachable after an explicit PIN check — the
 * assistant cannot call this on the strength of a voice command alone.
 */
export function payBill(billId: string, pin: string): BankResult<Receipt> {
  const parsed = BillPaymentRequest.safeParse({ billId, pin });
  if (!parsed.success) {
    // A malformed PIN is a user error, not a programming error: report it as
    // an ordinary failed attempt rather than throwing into the UI.
    if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) {
      return { ok: false, error: { code: "invalid_pin" } };
    }
    return { ok: false, error: { code: "bill_not_found" } };
  }

  const pinCheck = verifyPin(parsed.data.pin);
  if (!pinCheck.ok) return pinCheck;

  const bill = state.bills.find((b) => b.id === parsed.data.billId);
  if (!bill) return { ok: false, error: { code: "bill_not_found" } };
  if (bill.paid) return { ok: false, error: { code: "bill_already_paid" } };
  if (state.account.balanceCents < bill.amountCents) {
    return { ok: false, error: { code: "insufficient_funds" } };
  }

  state.account.balanceCents -= bill.amountCents;
  bill.paid = true;

  const biller = billerOf(bill);
  return {
    ok: true,
    value: makeReceipt("bill_payment", bill.amountCents, biller.name, bill.accountRef),
  };
}

/**
 * Execute an FPS transfer. Same PIN precondition as payBill.
 */
export function transfer(
  payeeId: string,
  amountCents: number,
  pin: string,
  reference?: string,
): BankResult<Receipt> {
  // Guards against a zero or negative amount silently producing a no-op
  // receipt, and against a fractional cent value corrupting the ledger.
  const parsed = TransferRequest.safeParse({ payeeId, amountCents, pin, reference });
  if (!parsed.success) {
    if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) {
      return { ok: false, error: { code: "invalid_pin" } };
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new Error(`transfer amount must be a positive integer of cents, got ${amountCents}`);
    }
    return { ok: false, error: { code: "payee_not_found" } };
  }

  const pinCheck = verifyPin(parsed.data.pin);
  if (!pinCheck.ok) return pinCheck;

  const payee = state.payees.find((p) => p.id === parsed.data.payeeId);
  if (!payee) return { ok: false, error: { code: "payee_not_found" } };
  if (state.account.balanceCents < parsed.data.amountCents) {
    return { ok: false, error: { code: "insufficient_funds" } };
  }

  state.account.balanceCents -= parsed.data.amountCents;
  if (!payee.trusted) {
    payee.trusted = true;
    payee.typicalAmountCents = parsed.data.amountCents;
  }

  return {
    ok: true,
    value: makeReceipt(
      "fps_transfer",
      parsed.data.amountCents,
      payee.name,
      parsed.data.reference?.trim() ? parsed.data.reference.trim() : "FPS",
    ),
  };
}
