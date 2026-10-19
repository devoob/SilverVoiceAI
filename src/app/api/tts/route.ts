/**
 * Local open-source Cantonese TTS proxy.
 *
 * Browsers ship no reliable Cantonese voice; the system `zh-HK` voice is often
 * missing, and the naive fallback hands Cantonese text to a Mandarin voice —
 * which is exactly the "speaks Putonghua instead of 廣東話" defect. This route
 * lets the app speak through a genuinely Cantonese model running locally.
 *
 * The contract here is deliberately engine-agnostic so the backend can change
 * without touching the app:
 *
 *   GET  /api/tts  -> { available, engine, ... }   (health probe)
 *   POST /api/tts  -> audio/wav                    (synthesis)
 *
 * The sidecar is expected to expose the same shape. `scripts/cosyvoice_server.py`
 * adapts CosyVoice 3 (Apache-2.0, Guangdong dialect + instruct control) to it;
 * any other engine can be dropped in behind the same two endpoints.
 *
 * Point TTS_SIDECAR_URL at a different host/port if needed. Nothing here is
 * required for the app to work — the browser voice is used when the sidecar is
 * absent.
 */

import { connection } from "next/server";
import { z } from "zod";

const SIDECAR_URL = process.env.TTS_SIDECAR_URL ?? "http://127.0.0.1:50000";
const PROBE_TIMEOUT_MS = 1500;
/** Generous: a 0.5B model on CPU can take several seconds for a long sentence. */
const SYNTH_TIMEOUT_MS = 60_000;

async function withTimeout<T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  // Request-time only: the answer depends on whether a local process is up.
  await connection();

  try {
    const response = await withTimeout(PROBE_TIMEOUT_MS, (signal) =>
      fetch(`${SIDECAR_URL}/health`, { signal, cache: "no-store" }),
    );
    if (!response.ok) {
      return Response.json({ available: false, engine: null, url: SIDECAR_URL });
    }
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({
      available: true,
      engine: typeof data.engine === "string" ? data.engine : "local",
      model: data.model ?? null,
      speaker: data.speaker ?? null,
      url: SIDECAR_URL,
    });
  } catch {
    return Response.json({ available: false, engine: null, url: SIDECAR_URL });
  }
}

const RequestBody = z.object({
  text: z.string().min(1).max(1000),
  lang: z.string().default("zh-HK"),
  rate: z.number().positive().max(2).default(1),
  pitch: z.number().min(0.5).max(1.5).default(1),
});

export async function POST(request: Request) {
  await connection();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = RequestBody.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const upstream = await withTimeout(SYNTH_TIMEOUT_MS, (signal) =>
      fetch(`${SIDECAR_URL}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal,
        cache: "no-store",
      }),
    );

    if (!upstream.ok) {
      // The sidecar is up but could not synthesise (e.g. no Cantonese speaker
      // available in the installed model). Let the client fall back.
      const detail = await upstream.text().catch(() => "");
      return Response.json(
        { error: "local_tts_failed", status: upstream.status, detail: detail.slice(0, 300) },
        { status: 502 },
      );
    }

    const audio = await upstream.arrayBuffer();
    if (audio.byteLength < 128) {
      return Response.json({ error: "local_tts_empty" }, { status: 502 });
    }

    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "audio/wav",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "local_tts_unreachable", url: SIDECAR_URL }, { status: 503 });
  }
}