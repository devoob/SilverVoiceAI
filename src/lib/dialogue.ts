/**
 * Conversation engine for the three PRD showcase journeys.
 *
 * The engine is a pure state machine over a `DialogueState`, driven by three
 * kinds of input: recognised speech, PIN-pad entry, and direct UI taps.
 * Returning UI cards alongside the spoken line is what implements the PRD's
 * "visual dual-feedback" requirement — every spoken response is also rendered
 * as large, high-contrast text and a card.
 *
 * Tone follows PRD 2: warm and adult, never patronising. Reassurance after a
 * cancellation is explicit ("your money has not moved") because that is the
 * single thing an anxious elderly user most needs to hear.
 */

import {
  getAccount,
  getBill,
  getBills,
  getPayee,
  getPayees,
  billerOf,
  payBill,
  transfer,
  resetPinLock,
  isPinLocked,
  pinAttemptsLeft,
  PIN_LENGTH,
  type Account,
  type Bill,
  type LocalisedName,
  type Payee,
  type Receipt,
} from "./bank";
import { detectConfirmation, parseIntent } from "./intent";
import { speakableAmount } from "./numerals";
import { assessTransaction, detectCoercion, type FindingCode } from "./guardrails";
import { strings, type Language } from "./i18n";
import {
  acknowledge,
  fallbackVariants,
  greetingVariants,
  rotate,
  socialReply,
} from "./phrasing";

export type CardPayload =
  | { kind: "balance"; account: Account; tip?: string }
  | { kind: "bills"; bills: Bill[] }
  | { kind: "bill_confirm"; bill: Bill }
  | { kind: "transfer_confirm"; payee: Payee; amountCents: number }
  | { kind: "receipt"; receipt: Receipt }
  | { kind: "handover" }
  | { kind: "scam_warning"; payee: Payee; amountCents: number; warnings: FindingCode[] }
  | { kind: "capabilities" };

export type PendingAction =
  | { type: "pay_bill"; billId: string; amountCents: number }
  | { type: "transfer"; payeeId: string; amountCents: number };

export type DialoguePhase =
  | "idle"
  | "awaiting_confirmation"
  | "awaiting_scam_decision"
  | "awaiting_pin"
  | "awaiting_bill_choice"
  | "awaiting_transfer_amount"
  | "handover";

export type DialogueState = {
  phase: DialoguePhase;
  pending: PendingAction | null;
  warnings: FindingCode[];
  /** Last assistant utterance, so "repeat?" works without re-deriving it. */
  lastSpoken: string | null;
};

export const initialState: DialogueState = {
  phase: "idle",
  pending: null,
  warnings: [],
  lastSpoken: null,
};

export type Input =
  | { kind: "utterance"; text: string }
  | { kind: "pin"; pin: string }
  | { kind: "ui"; event: "confirm" | "deny" | "cancel" | "handover" | "resume"; billId?: string }
  | { kind: "select_bill"; billId: string };

export type TurnResult = {
  state: DialogueState;
  /** Text handed to speech synthesis. Null means stay silent. */
  speak: string | null;
  /** Text shown in the transcript and as large on-screen copy. */
  display: string;
  card: CardPayload | null;
  /** True while the PIN pad must be on screen. */
  requiresPin: boolean;
  /** True when the assistant is waiting on the user rather than closing a turn. */
  awaitingUser: boolean;
};

type Reply = {
  phase: DialoguePhase;
  pending?: PendingAction | null;
  warnings?: FindingCode[];
  speak: string;
  card?: CardPayload | null;
};

function turn(state: DialogueState, reply: Reply, extra?: Partial<TurnResult>): TurnResult {
  const nextState: DialogueState = {
    phase: reply.phase,
    pending: reply.pending ?? null,
    warnings: reply.warnings ?? [],
    lastSpoken: reply.speak,
  };
  return {
    state: nextState,
    speak: reply.speak,
    display: reply.speak,
    card: reply.card ?? null,
    requiresPin: reply.phase === "awaiting_pin",
    awaitingUser: reply.phase !== "idle",
    ...extra,
  };
}

/** Cantonese/Putonghua spoken money: 12480.50 -> "12480蚊5毫" / "12480元5角" */
export function spokenMoney(amountCents: number, lang: Language): string {
  return speakableAmount(amountCents, lang);
}

function localiseName(value: LocalisedName, lang: Language): string {
  return value[lang];
}

function name(payee: Payee, lang: Language): string {
  return localiseName(payee.name, lang);
}

function billerName(bill: Bill, lang: Language): string {
  return localiseName(billerOf(bill).name, lang);
}

const SAVINGS_TIPS = {
  cantonese: [
    "你每個月交完賬單之後，其實仲有大約三千蚊可以靈活運用。如果將其中五百蚊自動轉去一個定期戶口，一年之後就連利息都多過六千蚊，而且你完全唔使自己記得去做。",
    "一個好簡單嘅方法：每交完一張單，就將同樣嘅金額轉去儲蓄戶口。等於你慳到幾多，就儲到幾多，唔會影響日常生活。",
  ],
  putonghua: [
    "你每个月交完账单之后，其实还有大约三千元可以灵活运用。如果将其中五百元自动转去定期户口，一年之后连利息就多过六千元，而且你完全不需要自己记得去做。",
    "一个很简单的方法：每交完一张账单，就把同样的金额转去储蓄户口。等于你省下多少，就存到多少，不会影响日常生活。",
  ],
  english: [
    "After your bills each month you still have roughly three thousand dollars of flexibility. Moving five hundred of that into an automatic standing order would give you over six thousand in a year, and you would never have to remember to do it.",
    "Here's a simple approach: after you pay each bill, move the same amount into savings. You save exactly what you set aside, without changing your daily routine.",
  ],
} as const;

function pickTip(lang: Language): string {
  // Rotates through every tip. Previously this always returned list[0], so the
  // second tip was unreachable and "give me advice" repeated itself verbatim.
  return rotate(`tip:${lang}`, SAVINGS_TIPS[lang]);
}

/**
 * Choose one realisation for the current language.
 *
 * Every variant of a phrase must carry the same essential facts, because the
 * tests assert on those facts rather than on the wording.
 */
function phrase(
  lang: Language,
  key: string,
  options: Record<Language, readonly string[]>,
): string {
  return rotate(`${key}:${lang}`, options[lang]);
}

/**
 * A nudge back to whatever action was already in progress, so a social turn
 * never silently loses the user's place in a transaction.
 */
function pendingReminder(state: DialogueState, lang: Language): string {
  switch (state.phase) {
    case "awaiting_confirmation":
      return lang === "cantonese"
        ? "咁頭先嗰單，仲要唔要幫你交？"
        : lang === "putonghua"
          ? "那刚才那笔，还要不要帮你办？"
          : "So — shall I still go ahead with that?";
    case "awaiting_transfer_amount":
      return lang === "cantonese"
        ? "咁你想轉幾多錢？"
        : lang === "putonghua"
          ? "那你想转多少钱？"
          : "How much would you like to send?";
    case "awaiting_bill_choice":
      return lang === "cantonese"
        ? "咁你想交邊張單？"
        : lang === "putonghua"
          ? "那你想交哪一张账单？"
          : "Which bill would you like to pay?";
    case "awaiting_scam_decision":
      return lang === "cantonese"
        ? "咁你想繼續，定係停一停？"
        : lang === "putonghua"
          ? "那你想继续，还是先停一停？"
          : "Would you like to continue, or shall we stop?";
    default:
      return "";
  }
}

async function proposeAction(
  lang: Language,
  pending: PendingAction,
): Promise<TurnResult> {
  const t = strings(lang);
  const account = getAccount();

  const facts =
    pending.type === "pay_bill"
      ? {
          kind: "bill_payment" as const,
          amountCents: pending.amountCents,
          balanceCents: account.balanceCents,
          payeeTrusted: true,
          typicalAmountCents: 0,
        }
      : (() => {
          const payee = getPayee(pending.payeeId);
          return {
            kind: "fps_transfer" as const,
            amountCents: pending.amountCents,
            balanceCents: account.balanceCents,
            payeeTrusted: payee?.trusted ?? false,
            typicalAmountCents: payee?.typicalAmountCents ?? 0,
          };
        })();

  const assessment = await assessTransaction(facts);

  if (assessment.blocked) {
    return turn(initialState, {
      phase: "idle",
      speak: t.errors.insufficientFunds,
      card: { kind: "balance", account },
    });
  }

  // Scam caution is spoken BEFORE the PIN pad, per PRD 6. The hotline advice
  // is spoken in every language — a Cantonese-speaking elderly user is exactly
  // the person who most needs to hear 18222, not the one to skip it for.
  if (pending.type === "transfer" && assessment.scamWarnings.length > 0) {
    const payee = getPayee(pending.payeeId)!;
    const reasons = assessment.scamWarnings
      .map((w) => (w === "scam_first_time_payee" ? t.scam.firstTime : t.scam.highAmount))
      .join(lang === "english" ? " " : "");

    const speak =
      lang === "english"
        ? `${t.scam.title}. ${t.scam.body} ${reasons} ${t.scam.advice}`
        : `${t.scam.title}。${t.scam.body}${reasons ? ` ${reasons}` : ""}。${t.scam.advice}`;

    return turn(
      { ...initialState, phase: "awaiting_scam_decision", pending, warnings: assessment.scamWarnings },
      {
        phase: "awaiting_scam_decision",
        pending,
        warnings: assessment.scamWarnings,
        speak,
        card: {
          kind: "scam_warning",
          payee,
          amountCents: pending.amountCents,
          warnings: assessment.scamWarnings,
        },
      },
    );
  }

  if (pending.type === "pay_bill") {
    const bill = getBill(pending.billId)!;
    const biller = billerName(bill, lang);
    const amount = spokenMoney(pending.amountCents, lang);
    const due = duePhrase(bill, lang);
    const core = phrase(lang, "billProposal", {
      cantonese: [
        `你有一張 ${amount} 嘅${biller}賬單，${due}。要而家幫你交嗎？`,
        `搵到張${biller}單，${amount}，${due}。而家幫你交好嗎？`,
        `${biller}嗰張單係 ${amount}，${due}。即刻幫你交？`,
      ],
      putonghua: [
        `你有一张 ${amount} 的${biller}账单，${due}。要现在帮你缴交吗？`,
        `找到一张${biller}账单，${amount}，${due}。现在帮你交好吗？`,
        `${biller}那张账单是 ${amount}，${due}。马上帮你交？`,
      ],
      english: [
        `you have a ${biller} bill for ${amount}, ${due}. Shall I pay it now?`,
        `I found a ${biller} bill for ${amount}, ${due}. Want me to take care of it?`,
        `there's a ${biller} bill of ${amount} here, ${due}. Pay it now?`,
      ],
    });
    const speak = `${acknowledge(lang)}${core}`;
    return turn(
      { ...initialState, phase: "awaiting_confirmation", pending },
      { phase: "awaiting_confirmation", pending, speak, card: { kind: "bill_confirm", bill } },
    );
  }

  const payee = getPayee(pending.payeeId)!;
  const amount = spokenMoney(pending.amountCents, lang);
  const who = name(payee, lang);
  const core = phrase(lang, "transferProposal", {
    cantonese: [
      `我會轉 ${amount} 畀${who}，轉數快即刻到。確認嗎？`,
      `轉 ${amount} 畀${who}，即時到賬。可以嗎？`,
      `即係 ${amount} 過數畀${who}。啱唔啱？`,
    ],
    putonghua: [
      `我会转 ${amount} 给${who}，转数快即时到账。确认吗？`,
      `转 ${amount} 给${who}，马上到账。可以吗？`,
      `也就是 ${amount} 转给${who}。对吗？`,
    ],
    english: [
      `I'll send ${amount} to ${who} by FPS — it arrives instantly. Shall I go ahead?`,
      `that's ${amount} to ${who}, arriving straight away. Okay?`,
      `so, ${amount} over to ${who}. Is that right?`,
    ],
  });
  const speak = `${acknowledge(lang)}${core}`;
  return turn(
    { ...initialState, phase: "awaiting_confirmation", pending },
    {
      phase: "awaiting_confirmation",
      pending,
      speak,
      card: { kind: "transfer_confirm", payee, amountCents: pending.amountCents },
    },
  );
}

function duePhrase(bill: Bill, lang: Language): string {
  const date = new Date(`${bill.dueDate}T00:00:00`);
  const formatted = date.toLocaleDateString(lang === "english" ? "en-HK" : "zh-HK", {
    month: "long",
    day: "numeric",
  });
  if (lang === "cantonese") return `${formatted}到期`;
  if (lang === "putonghua") return `${formatted}到期`;
  return `due ${formatted}`;
}

function executePending(
  state: DialogueState,
  pin: string,
  lang: Language,
): TurnResult {
  const t = strings(lang);
  const pending = state.pending;
  if (!pending) {
    return turn(initialState, { phase: "idle", speak: t.errors.generic });
  }

  if (isPinLocked()) {
    return turn(
      { ...state, phase: "awaiting_pin", pending, warnings: state.warnings },
      { phase: "awaiting_pin", pending, speak: t.pin.locked },
    );
  }

  const result =
    pending.type === "pay_bill"
      ? payBill(pending.billId, pin)
      : transfer(pending.payeeId, pending.amountCents, pin);

  if (!result.ok) {
    if (result.error.code === "invalid_pin") {
      const left = pinAttemptsLeft();
      return turn(
        { ...state, phase: "awaiting_pin", pending, warnings: state.warnings },
        {
          phase: "awaiting_pin",
          pending,
          speak: `${t.pin.wrongPin} ${t.pin.attemptsLeft}: ${left}.`,
        },
      );
    }
    if (result.error.code === "pin_locked") {
      return turn(
        { ...state, phase: "awaiting_pin", pending, warnings: state.warnings },
        { phase: "awaiting_pin", pending, speak: t.pin.locked },
      );
    }
    const message =
      result.error.code === "insufficient_funds"
        ? t.errors.insufficientFunds
        : result.error.code === "bill_already_paid" || result.error.code === "bill_not_found"
          ? t.errors.billNotFound
          : t.errors.payeeNotFound;
    return turn(initialState, { phase: "idle", speak: message });
  }

  const receipt = result.value;
  const account = getAccount();
  resetPinLock();

  // The receipt already carries the localised counterparty name, so there is
  // no need to reach back into the pending union (and no risk of a mismatch
  // if the payee record changed during the turn).
  const who = localiseName(receipt.counterparty, lang);

  const paid = spokenMoney(receipt.amountCents, lang);
  const left = spokenMoney(account.balanceCents, lang);
  const ref = spokenRef(receipt.id);

  const speak = phrase(lang, `receipt:${receipt.kind}`, {
    cantonese:
      receipt.kind === "bill_payment"
        ? [
            `搞掂！已經幫你交咗 ${paid}，交易編號 ${ref}。你而家仲有 ${left}。`,
            `交妥喇，${paid} 已經過數，編號 ${ref}。剩返 ${left}。`,
            `手續辦好，繳咗 ${paid}，編號 ${ref}，戶口仲有 ${left}。`,
          ]
        : [
            `搞掂！已經轉咗 ${paid} 畀${who}。你而家仲有 ${left}。`,
            `轉好喇，${paid} 已經到咗${who}嗰邊。剩返 ${left}。`,
            `完成，${paid} 已經過畀${who}，戶口仲有 ${left}。`,
          ],
    putonghua:
      receipt.kind === "bill_payment"
        ? [
            `办妥了！已经帮你缴交了 ${paid}，交易编号 ${ref}。你现在还有 ${left}。`,
            `交好了，${paid} 已经过账，编号 ${ref}。还剩 ${left}。`,
            `手续办好，缴了 ${paid}，编号 ${ref}，账户还有 ${left}。`,
          ]
        : [
            `办妥了！已经转了 ${paid} 给${who}。你现在还有 ${left}。`,
            `转好了，${paid} 已经到${who}那边。还剩 ${left}。`,
            `完成，${paid} 已经转给${who}，账户还有 ${left}。`,
          ],
    english:
      receipt.kind === "bill_payment"
        ? [
            `All done. I've paid ${paid}, reference ${ref}. Your balance is now ${left}.`,
            `That's paid — ${paid} settled, reference ${ref}. You now have ${left}.`,
            `Paid. ${paid} went through under reference ${ref}, leaving ${left}.`,
          ]
        : [
            `All done. I've sent ${paid} to ${who}. Your balance is now ${left}.`,
            `That's sent — ${paid} is with ${who}. You now have ${left}.`,
            `Done. ${paid} has gone to ${who}, leaving ${left}.`,
          ],
  });

  return turn(initialState, {
    phase: "idle",
    speak,
    card: { kind: "receipt", receipt },
  });
}

/** Read a transaction reference aloud digit by digit — nobody can catch a long code. */
function spokenRef(id: string): string {
  return [...id.replace(/[^A-Za-z0-9]/g, "")].join(" ");
}

async function handleIntent(
  text: string,
  lang: Language,
  state: DialogueState,
): Promise<TurnResult> {
  const t = strings(lang);
  const parsed = parseIntent(text);

  // Elder-fraud coercion screen runs before anything else (PRD 6).
  const coercion = detectCoercion(text);
  if (coercion.length > 0) {
    return turn(initialState, {
      phase: "idle",
      speak:
        lang === "english"
          ? `${t.scam.title}. ${t.scam.advice}`
          : `${t.scam.title}。${t.scam.advice}`,
      card: { kind: "handover" },
    });
  }

  switch (parsed.intent) {
    case "handover": {
      return turn(
        { ...initialState, phase: "handover" },
        {
          phase: "handover",
          speak:
            lang === "cantonese"
              ? "冇問題，我而家幫你接駁真人客服。請稍等，唔使急，我會一直喺度。"
              : lang === "putonghua"
                ? "没问题，我现在帮你接驳真人客服。请稍候，不用急，我会一直在。"
                : "Of course. I'm connecting you to a person now. Please hold — there's no rush, and I'll stay with you.",
          card: { kind: "handover" },
        },
      );
    }

    case "greeting": {
      // A natural, short opener — not a recitation of features. The capability
      // list still appears on screen, which is where a low-vision or
      // hard-of-hearing user can read it at their own pace.
      const speak = rotate(`greeting:${lang}`, [
        t.mic.greeting,
        ...greetingVariants(lang),
      ]);
      return turn(initialState, {
        phase: "idle",
        speak,
        card: { kind: "capabilities" },
      });
    }

    case "help": {
      return turn(initialState, {
        phase: "idle",
        speak: t.mic.help,
        card: { kind: "capabilities" },
      });
    }

    case "balance": {
      const account = getAccount();
      const amount = spokenMoney(account.balanceCents, lang);
      const core = phrase(lang, "balance", {
        cantonese: [
          `你嘅儲蓄戶口尾號 ${account.maskedNumber}，而家可用結餘係 ${amount}。`,
          `你個戶口尾號 ${account.maskedNumber}，而家有 ${amount} 可以用。`,
          `尾號 ${account.maskedNumber} 嘅儲蓄戶口，可用結餘 ${amount}。`,
        ],
        putonghua: [
          `你的储蓄账户尾号 ${account.maskedNumber}，现在可用结余是 ${amount}。`,
          `你尾号 ${account.maskedNumber} 的账户，现在有 ${amount} 可以用。`,
          `尾号 ${account.maskedNumber} 的储蓄账户，可用结余 ${amount}。`,
        ],
        english: [
          `your savings account ending ${account.maskedNumber} has ${amount} available.`,
          `you've got ${amount} available in the account ending ${account.maskedNumber}.`,
          `the account ending ${account.maskedNumber} currently holds ${amount}.`,
        ],
      });
      return turn(initialState, {
        phase: "idle",
        speak: `${acknowledge(lang)}${core}`,
        card: { kind: "balance", account },
      });
    }

    case "advice": {
      const account = getAccount();
      const tip = pickTip(lang);
      const amount = spokenMoney(account.balanceCents, lang);
      const lead = phrase(lang, "adviceLead", {
        cantonese: [
          `你而家有 ${amount}。`,
          `你戶口而家係 ${amount}。`,
          `睇一睇你嘅結餘，有 ${amount}。`,
        ],
        putonghua: [
          `你现在有 ${amount}。`,
          `你账户现在是 ${amount}。`,
          `看一下你的结余，有 ${amount}。`,
        ],
        english: [
          `you currently have ${amount}. `,
          `your balance sits at ${amount}. `,
          `there's ${amount} in the account. `,
        ],
      });
      return turn(initialState, {
        phase: "idle",
        speak: `${acknowledge(lang)}${lead}${tip}`,
        card: { kind: "balance", account, tip },
      });
    }

    case "list_bills": {
      const bills = getBills();
      if (bills.length === 0) {
        return turn(initialState, {
          phase: "idle",
          speak: t.cards.noPendingBills,
          card: { kind: "bills", bills: [] },
        });
      }
      const summary = bills
        .map((b) => `${billerName(b, lang)} ${spokenMoney(b.amountCents, lang)}`)
        .join(lang === "english" ? ", " : "、");
      const count = bills.length;
      const core = phrase(lang, "listBills", {
        cantonese: [
          `你有 ${count} 張單未交：${summary}。想交邊張？`,
          `仲有 ${count} 張單未找數：${summary}。想先交邊張？`,
        ],
        putonghua: [
          `你有 ${count} 张账单未缴：${summary}。想缴哪一张？`,
          `还有 ${count} 张账单没交：${summary}。想先缴哪一张？`,
        ],
        english: [
          `you have ${count} bills to pay: ${summary}. Which one would you like to pay?`,
          `there are ${count} bills outstanding: ${summary}. Which shall we do first?`,
        ],
      });
      const speak = `${acknowledge(lang)}${core}`;
      return turn(
        { ...initialState, phase: bills.length > 1 ? "awaiting_bill_choice" : "idle" },
        { phase: bills.length > 1 ? "awaiting_bill_choice" : "idle", speak, card: { kind: "bills", bills } },
      );
    }

    case "pay_bill": {
      const bills = getBills();
      if (bills.length === 0) {
        return turn(initialState, {
          phase: "idle",
          speak: t.cards.noPendingBills,
          card: { kind: "bills", bills: [] },
        });
      }

      // Prefer an exact biller match; note CLP and HK Electric both alias to
      // "電費", so fall back to the earliest-due electricity bill.
      let bill: Bill | undefined;
      if (parsed.billerId) {
        const candidates = bills.filter((b) => b.billerId === parsed.billerId);
        bill = candidates.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
      }
      if (!bill && bills.length === 1) bill = bills[0];

      if (!bill) {
        const summary = bills
          .map((b) => `${billerName(b, lang)} ${spokenMoney(b.amountCents, lang)}`)
          .join(lang === "english" ? ", " : "、");
        const speak =
          lang === "cantonese"
            ? `你有幾張單未交：${summary}。你想交邊張？`
            : lang === "putonghua"
              ? `你有几张账单未缴：${summary}。你想缴哪一张？`
              : `You have a few bills outstanding: ${summary}. Which one would you like to pay?`;
        return turn(
          { ...initialState, phase: "awaiting_bill_choice" },
          { phase: "awaiting_bill_choice", speak, card: { kind: "bills", bills } },
        );
      }

      return proposeAction(lang, { type: "pay_bill", billId: bill.id, amountCents: bill.amountCents });
    }

    case "transfer": {
      const payee = parsed.payeeId ? getPayee(parsed.payeeId) : undefined;
      const amount = parsed.amountCents;

      if (!payee) {
        const payeeList = getPayees()
          .slice(0, 4)
          .map((p) => name(p, lang))
          .join(lang === "english" ? ", " : "、");
        const speak =
          lang === "cantonese"
            ? `你想轉數快畀邊個？你經常轉賬嘅人有：${payeeList}。`
            : lang === "putonghua"
              ? `你想转数快给谁？你经常转账的人有：${payeeList}。`
              : `Who would you like to send money to? People you often pay are ${payeeList}.`;
        return turn(initialState, { phase: "idle", speak });
      }

      if (amount === null) {
        const speak =
          lang === "cantonese"
            ? `好，你想轉幾多錢畀${name(payee, lang)}？`
            : lang === "putonghua"
              ? `好，你想转多少钱给${name(payee, lang)}？`
              : `Sure. How much would you like to send to ${name(payee, lang)}?`;
        return turn(
          { ...initialState, phase: "awaiting_transfer_amount", pending: { type: "transfer", payeeId: payee.id, amountCents: 0 } },
          {
            phase: "awaiting_transfer_amount",
            pending: { type: "transfer", payeeId: payee.id, amountCents: 0 },
            speak,
            card: { kind: "transfer_confirm", payee, amountCents: 0 },
          },
        );
      }

      return proposeAction(lang, { type: "transfer", payeeId: payee.id, amountCents: amount });
    }

    case "repeat": {
      const speak = state.lastSpoken ?? (lang === "english" ? t.errors.unknownIntent : t.errors.unknownIntent);
      return turn(state, { phase: state.phase, pending: state.pending, speak, card: null });
    }

    case "unknown":
    default: {
      // Varied rather than the same menu every time, but every realisation
      // still names something concrete the user can say.
      const speak = rotate(`fallback:${lang}`, [
        t.errors.unknownIntent,
        ...fallbackVariants(lang),
      ]);
      return turn(initialState, { phase: "idle", speak, card: { kind: "capabilities" } });
    }
  }
}

/**
 * Advance the conversation by one turn.
 */
export async function advance(
  state: DialogueState,
  input: Input,
  lang: Language,
): Promise<TurnResult> {
  const t = strings(lang);

  if (input.kind === "pin") {
    if (state.phase !== "awaiting_pin" || !state.pending) {
      return turn(initialState, { phase: "idle", speak: t.errors.generic });
    }
    if (input.pin.length !== PIN_LENGTH) {
      return turn(state, { phase: "awaiting_pin", pending: state.pending, speak: t.pin.title });
    }
    return executePending(state, input.pin, lang);
  }

  if (input.kind === "select_bill") {
    const bill = getBill(input.billId);
    if (!bill || bill.paid) {
      return turn(initialState, { phase: "idle", speak: t.errors.billNotFound });
    }
    return proposeAction(lang, { type: "pay_bill", billId: bill.id, amountCents: bill.amountCents });
  }

  if (input.kind === "ui") {
    switch (input.event) {
      case "handover":
        return advance(state, { kind: "utterance", text: lang === "english" ? "talk to a person" : "搵真人" }, lang);
      case "resume":
        return turn(initialState, {
          phase: "idle",
          speak:
            lang === "cantonese"
              ? "好，我哋繼續。你想做啲乜？"
              : lang === "putonghua"
                ? "好，我们继续。你想做什么？"
                : "Right, let's carry on. What would you like to do?",
        });
      case "cancel":
      case "deny":
        return turn(initialState, { phase: "idle", speak: t.pin.cancelled });
      case "confirm":
        if (state.pending) {
          return turn(
            { ...state, phase: "awaiting_pin" },
            {
              phase: "awaiting_pin",
              pending: state.pending,
              warnings: state.warnings,
              speak:
                lang === "cantonese"
                  ? `${t.pin.title}。${t.pin.secureNote}`
                  : lang === "putonghua"
                    ? `${t.pin.title}。${t.pin.secureNote}`
                    : `${t.pin.title} ${t.pin.secureNote}`,
            },
          );
        }
        return turn(initialState, { phase: "idle", speak: t.errors.generic });
    }
  }

  // Utterance input.
  const text = input.text;

  if (state.phase === "awaiting_pin") {
    // Never accept a spoken PIN. This is the anti-spoofing control from PRD 2:
    // money movement requires touch or biometric, not voice.
    return turn(state, {
      phase: "awaiting_pin",
      pending: state.pending,
      speak:
        lang === "cantonese"
          ? "為咗安全，密碼唔可以用講嘅。請你用手指喺畫面上輸入六位數密碼。"
          : lang === "putonghua"
            ? "为了安全，密码不可以用说的。请你用手指在画面上输入六位数字密码。"
            : "For your security I can't take the PIN by voice. Please tap the six digits on the screen.",
    });
  }

  if (state.phase === "handover") {
    return turn(state, {
      phase: "handover",
      speak: t.cards.handoverBody,
      card: { kind: "handover" },
    });
  }

  /**
   * A social turn can arrive at any point, including mid-transaction. Answer it
   * warmly and keep whatever was pending, so being polite never costs the user
   * their place in the flow. Handled before the phase branches for that reason.
   */
  if (parseIntent(text).intent === "thanks") {
    const reminder = pendingReminder(state, lang);
    const thanks = socialReply("thanks", lang);
    const speak = reminder
      ? `${thanks}${lang === "english" ? " " : ""}${reminder}`
      : thanks;
    return turn(state, {
      phase: state.phase,
      pending: state.pending,
      warnings: state.warnings,
      speak,
      card: null,
    });
  }

  if (state.phase === "awaiting_scam_decision") {
    const decision = detectConfirmation(text);
    if (decision === "confirm" && state.pending) {
      return turn(
        { ...state, phase: "awaiting_pin", warnings: [] },
        {
          phase: "awaiting_pin",
          pending: state.pending,
          speak:
            lang === "cantonese"
              ? `${t.pin.title}。${t.pin.secureNote}`
              : lang === "putonghua"
                ? `${t.pin.title}。${t.pin.secureNote}`
                : `${t.pin.title} ${t.pin.secureNote}`,
        },
      );
    }
    if (decision === "deny") {
      return turn(initialState, {
        phase: "idle",
        speak:
          lang === "cantonese"
            ? "好，我停低先。你嘅錢完全冇郁過。如果想搵人傾下，可以講「搵真人」。"
            : lang === "putonghua"
              ? "好，我先停下来。你的钱完全没有动过。如果想找人谈谈，可以说「找真人」。"
            : "Good call — I've stopped there. Your money has not moved at all. If you'd like to talk it over, just say \"talk to a person\".",
      });
    }
    return turn(state, {
      phase: "awaiting_scam_decision",
      pending: state.pending,
      warnings: state.warnings,
      speak:
        lang === "cantonese"
          ? `你想繼續，定係停一停？${t.scam.advice}`
          : lang === "putonghua"
            ? `你想继续，还是停一停？${t.scam.advice}`
            : `Would you like to continue, or shall we stop? ${t.scam.advice}`,
    });
  }

  if (state.phase === "awaiting_confirmation") {
    const decision = detectConfirmation(text);
    if (decision === "confirm" && state.pending) {
      return advance(state, { kind: "ui", event: "confirm" }, lang);
    }
    if (decision === "deny") {
      return turn(initialState, { phase: "idle", speak: t.pin.cancelled });
    }
    // Ambiguous answer: repeat the question rather than guessing on money.
    return turn(state, {
      phase: "awaiting_confirmation",
      pending: state.pending,
      speak: phrase(lang, "reaskConfirm", {
        cantonese: [
          `唔好意思，我唔肯定你嘅意思。即係要，定係唔要？`,
          `你可以答我「係」或者「唔好」，我就照做。`,
        ],
        putonghua: [
          `不好意思，我不太确定你的意思。是要，还是不要？`,
          `你可以回我「是」或者「不要」，我就照办。`,
        ],
        english: [
          `Sorry, I'm not sure I followed. Is that a yes or a no?`,
          `Just say "yes" or "no" and I'll take it from there.`,
        ],
      }),
    });
  }

  if (state.phase === "awaiting_transfer_amount" && state.pending?.type === "transfer") {
    const parsed = parseIntent(text);
    const amount = parsed.amountCents ?? (parsed.intent === "unknown" ? parseIntent(text).amountCents : null);
    if (amount !== null && amount > 0) {
      return proposeAction(lang, { type: "transfer", payeeId: state.pending.payeeId, amountCents: amount });
    }
    return turn(state, {
      phase: "awaiting_transfer_amount",
      pending: state.pending,
      speak: t.errors.noAmount,
    });
  }

  if (state.phase === "awaiting_bill_choice") {
    const parsed = parseIntent(text);
    const bills = getBills();
    let bill: Bill | undefined;
    if (parsed.billerId) bill = bills.find((b) => b.billerId === parsed.billerId);
    if (!bill && parsed.amountCents !== null) {
      bill = bills.find((b) => b.amountCents === parsed.amountCents);
    }
    if (bill) {
      return proposeAction(lang, { type: "pay_bill", billId: bill.id, amountCents: bill.amountCents });
    }
    return turn(state, {
      phase: "awaiting_bill_choice",
      speak: t.cards.chooseBill,
      card: { kind: "bills", bills },
    });
  }

  return handleIntent(text, lang, state);
}
