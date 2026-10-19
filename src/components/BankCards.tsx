"use client";

/**
 * The visual half of the PRD's "dual feedback" rule: every spoken response is
 * also rendered here as large, high-contrast, non-cluttered cards.
 */

import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Droplets,
  Flame,
  Headset,
  Lightbulb,
  Phone,
  PiggyBank,
  Receipt,
  Users,
  Wallet,
  Zap,
  ArrowRightLeft,
} from "lucide-react";
import {
  BILLERS,
  formatAmount,
  type Bill,
  type BillerId,
  type LocalisedName,
} from "@/lib/bank";
import type { CardPayload } from "@/lib/dialogue";
import type { Language } from "@/lib/i18n";
import { formatDate, formatTime } from "@/lib/utils";
import { Amount, Button, Card, CardTitle, Label, Pill } from "./ui";

const BILLER_ICON: Record<BillerId, typeof Zap> = {
  clp: Zap,
  hkelectric: Zap,
  water: Droplets,
  towngas: Flame,
};

function localise(value: LocalisedName, lang: Language): string {
  return value[lang];
}

/**
 * A single definition-list row.
 *
 * Rendered as div > dt + dd, which is the only grouping HTML5 permits inside a
 * <dl>. Using spans here reads fine visually but strips the term/definition
 * semantics a screen reader relies on to announce "Due: 5 November".
 */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b-2 border-line-soft py-4 last:border-b-0">
      <dt className="text-base font-bold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-lg font-bold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

type CardProps = {
  card: CardPayload;
  lang: Language;
  locale: string;
  onConfirm?: () => void;
  onDeny?: () => void;
  onSelectBill?: (billId: string) => void;
  onHandover?: () => void;
  onResume?: () => void;
  labels: {
    confirmYes: string;
    confirmNo: string;
    payNow: string;
    billDue: string;
    pendingBills: string;
    noPendingBills: string;
    balanceTitle: string;
    availableBalance: string;
    accountEnding: string;
    savingsTip: string;
    transferTitle: string;
    amount: string;
    recipient: string;
    reference: string;
    receiptTitle: string;
    billPaid: string;
    transferComplete: string;
    status: string;
    transactionId: string;
    completedAt: string;
    newBalance: string;
    handoverTitle: string;
    handoverBody: string;
    callHotline: string;
    callFamily: string;
    backToAssistant: string;
    scamProceed: string;
    scamStop: string;
    scamFirstTime: string;
    scamHighAmount: string;
    scamAdvice: string;
    scamTitle: string;
    scamBody: string;
    statusSuccess: string;
    capabilitiesTitle: string;
    capabilities: string[];
    chooseBill: string;
    statusStopped: string;
  };
};

export function BankCard({ card, lang, locale, labels, ...handlers }: CardProps) {
  switch (card.kind) {
    case "balance": {
      const { account, tip } = card;
      return (
        <Card data-testid="card-balance">
          <header className="mb-4 flex items-center gap-4">
            <Wallet aria-hidden="true" className="size-11 shrink-0 text-brand" strokeWidth={2.5} />
            <CardTitle>{labels.balanceTitle}</CardTitle>
          </header>
          <div className="rounded-2xl border-4 border-line bg-surface p-6">
            <Label>{labels.availableBalance}</Label>
            <Amount value={formatAmount(account.balanceCents, locale)} className="mt-2 text-hero" />
            <p className="mt-3 text-base font-bold text-muted">
              {labels.accountEnding} {account.maskedNumber}
            </p>
          </div>
          {tip ? (
            <div className="mt-5 flex items-start gap-4 rounded-2xl border-4 border-success bg-surface-success p-5">
              <Lightbulb aria-hidden="true" className="mt-0.5 size-9 shrink-0 text-success" strokeWidth={2.5} />
              <div>
                <Label className="text-success">{labels.savingsTip}</Label>
                <p className="mt-2 text-base leading-relaxed text-ink">{tip}</p>
              </div>
            </div>
          ) : null}
        </Card>
      );
    }

    case "bills": {
      const bills = card.bills;
      if (bills.length === 0) {
        return (
          <Card data-testid="card-bills">
            <header className="mb-4 flex items-center gap-4">
              <CheckCircle2 aria-hidden="true" className="size-11 shrink-0 text-success" strokeWidth={2.5} />
              <CardTitle>{labels.pendingBills}</CardTitle>
            </header>
            <p className="text-lg font-bold text-success">{labels.noPendingBills}</p>
          </Card>
        );
      }
      return (
        <Card data-testid="card-bills">
          <header className="mb-5 flex items-center gap-4">
            <Receipt aria-hidden="true" className="size-11 shrink-0 text-brand" strokeWidth={2.5} />
            <CardTitle>{labels.pendingBills}</CardTitle>
          </header>
          <ul className="flex flex-col gap-4">
            {bills.map((bill: Bill) => {
              const biller = BILLERS[bill.billerId];
              const Icon = BILLER_ICON[bill.billerId];
              return (
                <li
                  key={bill.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-4 border-line bg-white p-5"
                  data-testid={`bill-${biller.id}`}
                >
                  <div className="flex items-start gap-4">
                    <Icon aria-hidden="true" className="mt-1 size-9 shrink-0 text-brand" strokeWidth={2.5} />
                    <div>
                      <p className="text-lg font-extrabold text-ink">{localise(biller.name, lang)}</p>
                      <p className="mt-1 flex items-center gap-2 text-base text-muted">
                        <CalendarClock aria-hidden="true" className="size-5" strokeWidth={2.5} />
                        {labels.billDue} {formatDate(bill.dueDate, locale)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-5">
                    <Amount value={formatAmount(bill.amountCents, locale)} className="text-2xl" />
                    {handlers.onSelectBill ? (
                      <Button onClick={() => handlers.onSelectBill?.(bill.id)} data-testid={`pay-${biller.id}`}>
                        {labels.payNow}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      );
    }

    case "bill_confirm": {
      const bill = card.bill;
      const biller = BILLERS[bill.billerId];
      const Icon = BILLER_ICON[bill.billerId];
      return (
        <Card className="border-brand bg-surface-brand" data-testid="card-bill-confirm">
          <header className="mb-5 flex items-center gap-4">
            <Icon aria-hidden="true" className="size-11 shrink-0 text-brand" strokeWidth={2.5} />
            <CardTitle>{localise(biller.name, lang)}</CardTitle>
          </header>
          <div className="rounded-2xl border-4 border-line bg-white p-6">
            <Label>{labels.amount}</Label>
            <Amount value={formatAmount(bill.amountCents, locale)} className="mt-2 text-hero" />
          </div>
          <dl className="mt-5">
            <Row label={labels.reference} value={bill.accountRef} />
            <Row label={labels.billDue} value={formatDate(bill.dueDate, locale)} />
          </dl>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Button variant="success" size="large" onClick={handlers.onConfirm} data-testid="confirm-yes">
              {labels.confirmYes}
            </Button>
            <Button variant="secondary" size="large" onClick={handlers.onDeny} data-testid="confirm-no">
              {labels.confirmNo}
            </Button>
          </div>
        </Card>
      );
    }

    case "transfer_confirm": {
      const { payee, amountCents } = card;
      return (
        <Card className="border-brand bg-surface-brand" data-testid="card-transfer-confirm">
          <header className="mb-5 flex items-center gap-4">
            <ArrowRightLeft aria-hidden="true" className="size-11 shrink-0 text-brand" strokeWidth={2.5} />
            <CardTitle>{labels.transferTitle}</CardTitle>
          </header>
          <div className="rounded-2xl border-4 border-line bg-white p-6">
            <Label>{labels.amount}</Label>
            <Amount value={formatAmount(amountCents, locale)} className="mt-2 text-hero" />
          </div>
          <dl className="mt-5">
            <Row label={labels.recipient} value={localise(payee.name, lang)} />
            <Row label="FPS ID" value={payee.fpsId} />
          </dl>
          {amountCents > 0 ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Button variant="success" size="large" onClick={handlers.onConfirm} data-testid="confirm-yes">
                {labels.confirmYes}
              </Button>
              <Button variant="secondary" size="large" onClick={handlers.onDeny} data-testid="confirm-no">
                {labels.confirmNo}
              </Button>
            </div>
          ) : null}
        </Card>
      );
    }

    case "receipt": {
      const { receipt } = card;
      return (
        <Card className="border-success bg-surface-success" data-testid="card-receipt">
          <header className="mb-5 flex items-center gap-4">
            <CheckCircle2 aria-hidden="true" className="size-12 shrink-0 text-success" strokeWidth={2.5} />
            <CardTitle>
              {receipt.kind === "bill_payment" ? labels.billPaid : labels.transferComplete}
            </CardTitle>
          </header>
          <div className="rounded-2xl border-4 border-success bg-white p-6">
            <Label>{labels.amount}</Label>
            <Amount value={formatAmount(receipt.amountCents, locale)} className="mt-2 text-hero" />
          </div>
          <dl className="mt-5">
            <Row
              label={receipt.kind === "bill_payment" ? labels.recipient : labels.recipient}
              value={localise(receipt.counterparty, lang)}
            />
            <Row label={labels.transactionId} value={receipt.id} />
            <Row label={labels.completedAt} value={formatTime(receipt.completedAt, locale)} />
            <Row label={labels.newBalance} value={formatAmount(receipt.balanceAfterCents, locale)} />
            <Row label={labels.status} value={labels.statusSuccess} />
          </dl>
        </Card>
      );
    }

    case "scam_warning": {
      const { payee, amountCents, warnings } = card;
      return (
        <Card className="border-danger bg-surface-danger" data-testid="card-scam">
          <header className="mb-5 flex items-start gap-4">
            <AlertTriangle aria-hidden="true" className="size-12 shrink-0 text-danger" strokeWidth={2.5} />
            <div>
              <CardTitle className="text-danger">{labels.scamTitle}</CardTitle>
              <p className="mt-2 text-base leading-relaxed text-ink">{labels.scamBody}</p>
            </div>
          </header>

          <ul className="mb-5 flex flex-col gap-3">
            {warnings.map((w) => (
              <li key={w} className="flex items-start gap-3 rounded-2xl border-2 border-danger bg-white p-4">
                <span aria-hidden="true" className="mt-1 size-4 shrink-0 rounded-full bg-danger" />
                <span className="text-base font-bold text-ink">
                  {w === "scam_first_time_payee" ? labels.scamFirstTime : labels.scamHighAmount}
                </span>
              </li>
            ))}
          </ul>

          <dl className="mb-5 rounded-2xl border-4 border-line bg-white p-5">
            <Row label={labels.recipient} value={localise(payee.name, lang)} />
            <Row label="FPS ID" value={payee.fpsId} />
            <Row label={labels.amount} value={formatAmount(amountCents, locale)} />
          </dl>

          <p className="mb-6 rounded-2xl bg-white p-5 text-base leading-relaxed text-ink">
            {labels.scamAdvice}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Button variant="danger" size="large" onClick={handlers.onDeny} data-testid="scam-stop">
              {labels.scamStop}
            </Button>
            <Button variant="secondary" size="large" onClick={handlers.onConfirm} data-testid="scam-proceed">
              {labels.scamProceed}
            </Button>
          </div>
        </Card>
      );
    }

    case "handover": {
      return (
        <Card className="border-info" data-testid="card-handover">
          <header className="mb-5 flex items-center gap-4">
            <Headset aria-hidden="true" className="size-11 shrink-0 text-info" strokeWidth={2.5} />
            <CardTitle>{labels.handoverTitle}</CardTitle>
          </header>
          <p className="mb-6 text-lg leading-relaxed text-ink">{labels.handoverBody}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Button variant="info" size="large" onClick={handlers.onHandover} data-testid="call-hotline">
              <Phone aria-hidden="true" className="size-7" strokeWidth={2.5} />
              {labels.callHotline}
            </Button>
            <Button variant="secondary" size="large" onClick={handlers.onHandover} data-testid="call-family">
              <Users aria-hidden="true" className="size-7" strokeWidth={2.5} />
              {labels.callFamily}
            </Button>
          </div>
          {handlers.onResume ? (
            <Button variant="quiet" size="block" onClick={handlers.onResume} className="mt-4" data-testid="resume-assistant">
              {labels.backToAssistant}
            </Button>
          ) : null}
        </Card>
      );
    }

    case "capabilities": {
      return (
        <Card data-testid="card-capabilities">
          <header className="mb-5 flex items-center gap-4">
            <PiggyBank aria-hidden="true" className="size-11 shrink-0 text-brand" strokeWidth={2.5} />
            <CardTitle>{labels.capabilitiesTitle}</CardTitle>
          </header>
          <ul className="flex flex-col gap-3">
            {labels.capabilities.map((capability) => (
              <li
                key={capability}
                className="flex items-start gap-3 rounded-2xl border-2 border-line bg-surface p-4"
              >
                <span aria-hidden="true" className="mt-2 size-3.5 shrink-0 rounded-full bg-brand" />
                <span className="text-lg font-semibold text-ink">{capability}</span>
              </li>
            ))}
          </ul>
        </Card>
      );
    }

    default:
      return null;
  }
}

/** Compact status chip shown beside the transcript while a turn is in flight. */
export function PhasePill({ phase, text }: { phase: string; text: string }) {
  const tone = phase === "listening" ? "brand" : phase === "thinking" ? "warn" : "neutral";
  return <Pill tone={tone as "brand" | "warn" | "neutral"}>{text}</Pill>;
}
