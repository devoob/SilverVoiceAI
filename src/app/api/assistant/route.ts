/**
 * Server-side orchestration seam (PRD 4 architecture diagram).
 *
 * The shipped demo parses intents in the browser so a turn costs zero network
 * round-trips — latency is a real usability problem for elderly users, and the
 * demo must survive a flaky venue connection. This route exposes exactly the
 * same engine over HTTP and is the intended integration point for:
 *
 *   - an LLM fallback for out-of-script utterances
 *   - server-side ASR (SenseVoice / Fun-ASR) and TTS (CosyVoice 3)
 *   - a real core-banking API behind the PIN guardrail
 *
 * It deliberately refuses any `pin` field. A PIN must never travel to an
 * orchestration endpoint; it is verified only against the ledger at execution
 * time. Rejecting it here makes that policy explicit rather than incidental.
 */

import { connection } from "next/server";
import { z } from "zod";
import { detectCoercion } from "@/lib/guardrails";
import { parseIntent } from "@/lib/intent";
import { isLanguage, DEFAULT_LANGUAGE } from "@/lib/i18n";

const RequestBody = z.object({
  text: z.string().min(1).max(500),
  language: z.string().optional(),
});

export async function GET() {
  return Response.json({
    service: "silvervoice-assistant",
    version: "1.0.0-mvp",
    languages: ["cantonese", "putonghua", "english"],
    speechTags: { cantonese: "zh-HK", putonghua: "zh-CN", english: "en-HK" },
    intents: [
      "balance",
      "advice",
      "list_bills",
      "pay_bill",
      "transfer",
      "handover",
      "help",
      "greeting",
      "confirm",
      "deny",
      "repeat",
      "unknown",
    ],
    guardrails: [
      "pin_required_for_all_money_movement",
      "spoken_pin_rejected",
      "pin_field_rejected_by_api",
      "coercion_keyword_screen",
      "first_time_payee_caution",
      "unusual_amount_caution",
      "high_value_review",
    ],
  });
}

export async function POST(request: Request) {
  // Marks this handler as request-time so Cache Components never prerenders it.
  await connection();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (
    typeof payload === "object" &&
    payload !== null &&
    Object.prototype.hasOwnProperty.call(payload, "pin")
  ) {
    return Response.json(
      {
        error: "pin_rejected",
        message:
          "This endpoint never accepts a PIN. Money movement requires on-device verification.",
      },
      { status: 422 },
    );
  }

  const parsed = RequestBody.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { text } = parsed.data;
  const language = isLanguage(parsed.data.language) ? parsed.data.language : DEFAULT_LANGUAGE;

  const intent = parseIntent(text);
  const coercion = detectCoercion(text);

  return Response.json({
    language,
    intent: intent.intent,
    confidence: Number(intent.confidence.toFixed(2)),
    slots: {
      amountCents: intent.amountCents,
      billerId: intent.billerId,
      payeeId: intent.payeeId,
    },
    coercionFlags: coercion.map((flag) => flag.reason),
    // The client still enforces this; echoing it keeps the contract visible.
    requiresPinBeforeExecution: intent.intent === "pay_bill" || intent.intent === "transfer",
  });
}
