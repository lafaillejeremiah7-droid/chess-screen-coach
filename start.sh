#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv --without-pip .venv
fi
# A failed Debian ensurepip run can leave bin/python present but pip missing.
if ! .venv/bin/python -m pip --version >/dev/null 2>&1; then
  if ! .venv/bin/python -m ensurepip --upgrade >/dev/null 2>&1; then
    echo "Installing verified pip in the project's virtual environment..."
    .venv/bin/python scripts/bootstrap_pip.py
  fi
fi
.venv/bin/python -m pip --disable-pip-version-check install --quiet -r requirements.txt
.venv/bin/python scripts/install_stockfish19.py
exec .venv/bin/python server.py
