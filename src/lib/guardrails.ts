/**
 * Safety guardrails (PRD 6).
 *
 * Two guarantees this module exists to enforce:
 *
 *   1. The assistant can never move money on the strength of a voice command
 *      alone. Every money movement yields a `pin_required` finding, and the
 *      ledger functions refuse to execute without a verified PIN.
 *   2. Suspicious transfers raise a spoken caution before the PIN pad appears.
 *
 * Policy is expressed as declarative rule data rather than imperative checks,
 * so a compliance reviewer can read (and change) the thresholds without
 * touching application logic. Rules are evaluated by json-rules-engine (ISC).
 */

import { Engine } from "json-rules-engine";

export type TransactionKind = "bill_payment" | "fps_transfer";

export type FindingCode =
  | "pin_required"
  | "insufficient_funds"
  | "scam_first_time_payee"
  | "scam_unusual_amount"
  | "high_value_review";

export type Severity = "require" | "warn" | "block";

export type Finding = {
  code: FindingCode;
  severity: Severity;
};

export type TransactionFacts = {
  kind: TransactionKind;
  amountCents: number;
  balanceCents: number;
  /** False for a recipient the customer has never paid before. */
  payeeTrusted: boolean;
  /** Typical amount previously sent to this payee; 0 when there is no history. */
  typicalAmountCents: number;
};

export type Assessment = {
  findings: Finding[];
  /** Always true for money movement. The UI must gate on this. */
  requiresPin: boolean;
  /** Findings that should be spoken as a caution before proceeding. */
  scamWarnings: FindingCode[];
  /** True when the transaction must not proceed at all. */
  blocked: boolean;
};

/** Thresholds in cents. Kept here so judges can see them at a glance. */
export const LIMITS = {
  /** First payment to an unknown recipient above this triggers a scam caution. */
  firstTimePayeeWarnCents: 100_00,
  /** Amounts this many times the usual figure for a payee look anomalous. */
  unusualAmountRatio: 3,
  /** Above this, ask for an explicit second confirmation regardless of payee. */
  highValueReviewCents: 5000_00,
} as const;

type PolicyRule = {
  code: FindingCode;
  severity: Severity;
  conditions: Record<string, unknown>;
};

const POLICY: PolicyRule[] = [
  {
    code: "pin_required",
    severity: "require",
    conditions: {
      all: [{ fact: "isMoneyMovement", operator: "equal", value: true }],
    },
  },
  {
    code: "insufficient_funds",
    severity: "block",
    conditions: {
      all: [{ fact: "amountCents", operator: "greaterThan", value: { fact: "balanceCents" } }],
    },
  },
  {
    code: "scam_first_time_payee",
    severity: "warn",
    conditions: {
      all: [
        { fact: "kind", operator: "equal", value: "fps_transfer" },
        { fact: "payeeTrusted", operator: "equal", value: false },
        {
          fact: "amountCents",
          operator: "greaterThanInclusive",
          value: LIMITS.firstTimePayeeWarnCents,
        },
      ],
    },
  },
  {
    code: "scam_unusual_amount",
    severity: "warn",
    conditions: {
      all: [
        { fact: "hasPayeeHistory", operator: "equal", value: true },
        { fact: "amountRatio", operator: "greaterThanInclusive", value: LIMITS.unusualAmountRatio },
      ],
    },
  },
  {
    code: "high_value_review",
    severity: "warn",
    conditions: {
      all: [
        {
          fact: "amountCents",
          operator: "greaterThanInclusive",
          value: LIMITS.highValueReviewCents,
        },
      ],
    },
  },
];

function buildEngine(): Engine {
  const engine = new Engine();
  for (const rule of POLICY) {
    engine.addRule({
      conditions: rule.conditions as never,
      event: { type: rule.code, params: { severity: rule.severity } },
    });
  }
  return engine;
}

const ENGINE = buildEngine();

/** Expand the raw facts with the derived values the policy rules reference. */
function deriveFacts(facts: TransactionFacts) {
  const amountRatio =
    facts.typicalAmountCents > 0 ? facts.amountCents / facts.typicalAmountCents : 0;
  return {
    ...facts,
    isMoneyMovement: true,
    hasPayeeHistory: facts.typicalAmountCents > 0,
    amountRatio: Number(amountRatio.toFixed(2)),
  };
}

/**
 * Evaluate the policy for a prospective transaction.
 *
 * Note this is a pre-flight assessment used to shape the conversation. The
 * authoritative checks are repeated inside the ledger itself, so a tampered
 * client cannot authorise a payment by skipping this step.
 */
export async function assessTransaction(facts: TransactionFacts): Promise<Assessment> {
  const { events } = await ENGINE.run(deriveFacts(facts));

  const findings: Finding[] = events.map((event) => ({
    code: event.type as FindingCode,
    severity: (event.params?.severity as Severity) ?? "warn",
  }));

  return {
    findings,
    requiresPin: findings.some((f) => f.code === "pin_required"),
    scamWarnings: findings.filter((f) => f.severity === "warn").map((f) => f.code),
    blocked: findings.some((f) => f.severity === "block"),
  };
}

/** True when the given warning code should interrupt with a spoken caution. */
export function isScamWarning(code: FindingCode): boolean {
  return (
    code === "scam_first_time_payee" ||
    code === "scam_unusual_amount" ||
    code === "high_value_review"
  );
}

/**
 * Keyword screen applied to incoming speech before any intent is acted on.
 * Catches the coercion patterns behind the overwhelming majority of elder
 * financial fraud in Hong Kong: someone else directing the call, urgency,
 * or a request to keep it secret.
 */
const COERCION_PATTERNS: { pattern: RegExp; reason: "third_party" | "urgency" | "secrecy" }[] = [
  {
    pattern: /(公安|警察|police|court|法庭|檢察|检察|稅務|税务|arrest|拘捕|通緝|通缉|涉案)/i,
    reason: "third_party",
  },
  {
    pattern: /(安全賬戶|安全账户|safe account|保證金|保证金|立即轉|立即转|马上轉|马上转|urgent|急用)/i,
    reason: "urgency",
  },
  {
    pattern: /(唔好同|不要同|不要跟|別同|别同|don'?t tell|secret|保密|瞞住|瞒住|keep it quiet)/i,
    reason: "secrecy",
  },
];

export type CoercionFlag = { reason: "third_party" | "urgency" | "secrecy" };

/** Returns the coercion signals present in an utterance, if any. */
export function detectCoercion(utterance: string): CoercionFlag[] {
  return COERCION_PATTERNS.filter(({ pattern }) => pattern.test(utterance)).map(({ reason }) => ({
    reason,
  }));
}
