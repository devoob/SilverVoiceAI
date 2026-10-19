#!/usr/bin/env bash
#
# Build and run the local Cantonese TTS sidecar for SilverVoice AI.
#
# Browsers have no dependable Cantonese voice. This installs CosyVoice 3
# (Apache-2.0 — Guangdong dialect, instruct control over emotion and speed)
# and serves it on http://127.0.0.1:50000, where the app's /api/tts route will
# find it automatically. Nothing here is required: without it the app falls
# back to the browser voice.
#
# Usage:
#   bash scripts/tts-sidecar.sh            # set up (first run) and serve
#   COSYVOICE_PROMPT_WAV=ref.wav bash scripts/tts-sidecar.sh
#
# Environment:
#   COSYVOICE_DIR         where the CosyVoice checkout lives
#                         (default: ~/.cache/silvervoice/CosyVoice)
#   COSYVOICE_MODEL       Hugging Face model id
#                         (default: FunAudioLLM/Fun-CosyVoice3-0.5B-2512)
#   COSYVOICE_MODEL_DIR   local model directory (derived from the above)
#   COSYVOICE_SPEAKER     force a built-in speaker id
#   COSYVOICE_PROMPT_WAV  reference clip — gives the best and most Cantonese
#                         result, so it is worth recording ten seconds of speech
#   COSYVOICE_PROMPT_TEXT transcript of that clip
#   PORT                  sidecar port (default 50000)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COSYVOICE_DIR="${COSYVOICE_DIR:-$HOME/.cache/silvervoice/CosyVoice}"
COSYVOICE_MODEL="${COSYVOICE_MODEL:-FunAudioLLM/Fun-CosyVoice3-0.5B-2512}"
COSYVOICE_MODEL_DIR="${COSYVOICE_MODEL_DIR:-$COSYVOICE_DIR/pretrained_models/$(basename "$COSYVOICE_MODEL")}"
PORT="${PORT:-50000}"
VENV="$COSYVOICE_DIR/.venv"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }

say "SilverVoice — local Cantonese TTS sidecar"
echo "  checkout : $COSYVOICE_DIR"
echo "  model    : $COSYVOICE_MODEL_DIR"
echo "  port     : $PORT"

# --- 1. Tooling -------------------------------------------------------------
command -v python3 >/dev/null || { warn "python3 is required."; exit 1; }
command -v git >/dev/null || { warn "git is required."; exit 1; }

PY_OK=$(python3 - <<'PY'
import sys
sys.exit(0 if sys.version_info >= (3, 10) else 1)
PY
) || true
if [ -z "${PY_OK:-}" ]; then :; fi
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' || {
  warn "Python 3.10 or newer is required (found $(python3 -V 2>&1))."
  exit 1
}

# --- 2. Checkout ------------------------------------------------------------
if [ ! -d "$COSYVOICE_DIR/.git" ]; then
  say "Cloning CosyVoice (Apache-2.0)…"
  mkdir -p "$(dirname "$COSYVOICE_DIR")"
  git clone --depth 1 https://github.com/QwenAudio/CosyVoice.git "$COSYVOICE_DIR"
else
  say "CosyVoice checkout already present."
fi

# --- 3. Virtualenv + dependencies ------------------------------------------
if [ ! -x "$VENV/bin/python" ]; then
  say "Creating virtualenv…"
  python3 -m venv "$VENV"
fi

say "Installing dependencies (this is the slow part, ~1–2 GB)…"
"$VENV/bin/python" -m pip install --upgrade pip wheel >/dev/null
"$VENV/bin/python" -m pip install torch torchaudio
"$VENV/bin/python" -m pip install fastapi "uvicorn[standard]" pydantic huggingface_hub

if [ -f "$COSYVOICE_DIR/requirements.txt" ]; then
  # CosyVoice's full requirements pull in GPU-only and serving extras. Install
  # what applies and report what did not, rather than failing the whole setup.
  if ! "$VENV/bin/python" -m pip install -r "$COSYVOICE_DIR/requirements.txt"; then
    warn "Some optional CosyVoice requirements failed to install; continuing."
    warn "If synthesis fails, install the missing packages manually."
  fi
fi

# --- 4. Model weights -------------------------------------------------------
if [ ! -d "$COSYVOICE_MODEL_DIR" ] || [ -z "$(ls -A "$COSYVOICE_MODEL_DIR" 2>/dev/null)" ]; then
  say "Downloading $COSYVOICE_MODEL (Apache-2.0)…"
  mkdir -p "$COSYVOICE_MODEL_DIR"
  COSYVOICE_MODEL="$COSYVOICE_MODEL" COSYVOICE_MODEL_DIR="$COSYVOICE_MODEL_DIR" \
    "$VENV/bin/python" - <<'PY'
import os
from huggingface_hub import snapshot_download

model = os.environ["COSYVOICE_MODEL"]
target = os.environ["COSYVOICE_MODEL_DIR"]
snapshot_download(repo_id=model, local_dir=target)
print(f"downloaded {model} -> {target}")
PY
else
  say "Model weights already present."
fi

# --- 5. Serve ---------------------------------------------------------------
export COSYVOICE_MODEL_DIR
# CosyVoice imports its own package plus the vendored Matcha-TTS from the checkout.
export PYTHONPATH="$COSYVOICE_DIR:$COSYVOICE_DIR/third_party/Matcha-TTS${PYTHONPATH:+:$PYTHONPATH}"
export PORT

say "Serving on http://127.0.0.1:$PORT  (Ctrl-C to stop)"
echo "The app detects this automatically — no configuration needed."
echo "Health check:  curl -s http://127.0.0.1:$PORT/health"
if [ -z "${COSYVOICE_PROMPT_WAV:-}" ]; then
  warn "Tip: set COSYVOICE_PROMPT_WAV to ten seconds of Cantonese speech for the"
  warn "     warmest, most reliably Cantonese output."
fi

exec "$VENV/bin/python" "$ROOT/scripts/cosyvoice_server.py"