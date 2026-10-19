#!/usr/bin/env python3
"""
Local Cantonese TTS sidecar for SilverVoice AI.

Browsers ship no dependable Cantonese voice, so the assistant can speak through
a genuinely Cantonese model running on this machine instead. This adapter maps
CosyVoice 3 (Apache-2.0 — Guangdong dialect, with instruct control over
emotion and speed) onto the two-endpoint contract used by
`src/app/api/tts/route.ts`:

    GET  /health      -> { available, engine, model, speaker, device }
    POST /synthesize  -> audio/wav

Start it with `scripts/tts-sidecar.sh`, which builds the environment and
downloads the model. If this process is not running the app simply falls back
to the browser voice — nothing breaks.

Configuration (all optional, via environment):
    COSYVOICE_MODEL_DIR   model directory (default pretrained_models/Fun-CosyVoice3-0.5B-2512)
    COSYVOICE_SPEAKER     force a built-in speaker id (e.g. a Cantonese voice)
    COSYVOICE_PROMPT_WAV  reference clip for zero-shot / instruct synthesis
    COSYVOICE_PROMPT_TEXT transcript of that clip
"""

from __future__ import annotations

import io
import os
import threading
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

MODEL_DIR = os.environ.get(
    "COSYVOICE_MODEL_DIR", "pretrained_models/Fun-CosyVoice3-0.5B-2512"
)
FORCED_SPEAKER = os.environ.get("COSYVOICE_SPEAKER") or None
PROMPT_WAV = os.environ.get("COSYVOICE_PROMPT_WAV") or None
PROMPT_TEXT = os.environ.get("COSYVOICE_PROMPT_TEXT") or None

# Speaker names that indicate a Cantonese voice, across naming conventions.
CANTONESE_HINTS = ("粤", "粵", "yue", "cantonese", "guangdong", "廣東", "广东")

INSTRUCT = {
    "cantonese": "用廣東話講，語氣溫柔、親切，速度慢一點，像對長輩說話一樣。",
    "putonghua": "用普通話，語氣溫柔親切，速度慢一點。",
    "english": "Speak warmly and slowly, as if talking to an older adult.",
}


def language_key(lang: str) -> str:
    lowered = (lang or "").lower()
    if lowered.startswith("yue") or "zh-hk" in lowered or "zh_mo" in lowered:
        return "cantonese"
    if lowered.startswith("zh"):
        return "putonghua"
    return "english"


app = FastAPI(title="SilverVoice Cantonese TTS sidecar")

_model: Any = None
_model_error: str | None = None
_lock = threading.Lock()


def _detect_device() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:  # pragma: no cover - torch is imported lazily
        pass
    return "cpu"


def _load_model() -> Any:
    """Load CosyVoice once, tolerating the API differences between versions."""
    global _model, _model_error

    if _model is not None:
        return _model
    if _model_error is not None:
        raise RuntimeError(_model_error)

    try:
        try:
            # CosyVoice 3
            from cosyvoice.cli.cosyvoice import AutoModel

            _model = AutoModel(model_dir=MODEL_DIR)
        except Exception:
            # CosyVoice 2 and earlier
            from cosyvoice.cli.cosyvoice import CosyVoice2

            _model = CosyVoice2(MODEL_DIR, load_jit=False, load_trt=False, fp16=False)
    except Exception as error:  # pragma: no cover - environment dependent
        _model_error = f"{type(error).__name__}: {error}"
        raise RuntimeError(_model_error) from error

    return _model


def _available_speakers(model: Any) -> list[str]:
    for attribute in ("list_available_spks", "list_available_speakers"):
        getter = getattr(model, attribute, None)
        if callable(getter):
            try:
                return list(getter())
            except Exception:
                return []
    return []


def _cantonese_speaker(model: Any) -> str | None:
    if FORCED_SPEAKER:
        return FORCED_SPEAKER
    for speaker in _available_speakers(model):
        if any(hint in speaker.lower() for hint in CANTONESE_HINTS):
            return speaker
    return None


def _synthesise(model: Any, text: str, key: str) -> tuple[Any, int]:
    """Return (audio tensor, sample_rate), trying the best available path."""
    instruct = INSTRUCT[key]

    # 1) Instruct control with a reference clip — the warmest, most controllable
    #    path, and the one that actually asks for Cantonese.
    if PROMPT_WAV and hasattr(model, "inference_instruct2"):
        chunks = [
            out["tts_speech"]
            for out in model.inference_instruct2(text, instruct, PROMPT_WAV, stream=False)
        ]
        return _concat(chunks), model.sample_rate

    # 2) A built-in speaker, preferring one that is Cantonese.
    speaker = _cantonese_speaker(model)
    if speaker and hasattr(model, "inference_sft"):
        chunks = [
            out["tts_speech"] for out in model.inference_sft(text, speaker, stream=False)
        ]
        return _concat(chunks), model.sample_rate

    # 3) Zero-shot cloning from a reference clip.
    if PROMPT_WAV and hasattr(model, "inference_zero_shot"):
        chunks = [
            out["tts_speech"]
            for out in model.inference_zero_shot(text, PROMPT_TEXT or "", PROMPT_WAV, stream=False)
        ]
        return _concat(chunks), model.sample_rate

    raise HTTPException(
        status_code=503,
        detail=(
            "No Cantonese synthesis path available. Set COSYVOICE_PROMPT_WAV to a "
            "short Cantonese reference clip (best quality), or set COSYVOICE_SPEAKER "
            "to a Cantonese speaker id from the installed model. "
            f"Speakers found: {_available_speakers(model)!r}"
        ),
    )


def _concat(chunks: list[Any]) -> Any:
    import torch

    if not chunks:
        raise HTTPException(status_code=502, detail="Model produced no audio")
    return torch.cat(chunks, dim=1) if len(chunks) > 1 else chunks[0]


class SynthRequest(BaseModel):
    text: str
    lang: str = "zh-HK"
    rate: float = 1.0
    pitch: float = 1.0


@app.get("/health")
def health() -> dict[str, Any]:
    model_present = os.path.isdir(MODEL_DIR)
    payload: dict[str, Any] = {
        "available": model_present,
        "engine": "cosyvoice",
        "model": MODEL_DIR,
        "device": _detect_device(),
        "loaded": _model is not None,
    }
    if _model is not None:
        payload["speaker"] = _cantonese_speaker(_model)
        payload["speakers"] = _available_speakers(_model)
    if _model_error:
        payload["error"] = _model_error
    if not model_present:
        payload["error"] = f"model directory not found: {MODEL_DIR}"
    return payload


@app.post("/synthesize")
def synthesize(request: SynthRequest) -> Response:
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    try:
        import torchaudio
    except Exception as error:  # pragma: no cover - environment dependent
        raise HTTPException(status_code=503, detail=f"torchaudio unavailable: {error}") from error

    with _lock:
        try:
            model = _load_model()
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

        key = language_key(request.lang)
        try:
            speech, sample_rate = _synthesise(model, request.text, key)
        except HTTPException:
            raise
        except Exception as error:  # pragma: no cover - model dependent
            raise HTTPException(
                status_code=502, detail=f"synthesis failed: {type(error).__name__}: {error}"
            ) from error

    buffer = io.BytesIO()
    torchaudio.save(buffer, speech, sample_rate, format="wav")
    return Response(content=buffer.getvalue(), media_type="audio/wav")


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "50000")))