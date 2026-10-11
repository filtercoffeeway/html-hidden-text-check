#!/usr/bin/env bash
# One-time setup: a private venv with Playwright + headless Chromium.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
PLAYWRIGHT_BROWSERS_PATH="$(pwd)/.browsers" .venv/bin/playwright install chromium-headless-shell
echo "ready: $(pwd)/.venv/bin/python scripts/check.py PAGE.html"
