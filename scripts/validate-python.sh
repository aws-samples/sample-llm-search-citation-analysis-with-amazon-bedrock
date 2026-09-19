#!/usr/bin/env bash
# The Python half of `npm run validate`: lint, dead code, duplication, tests.
#
# Usage:
#   scripts/validate-python.sh
#
# Requires the toolchain from lambda/requirements-dev.txt — either in the
# repo-local .venv (preferred, created with `python3 -m venv .venv &&
# .venv/bin/pip install -r lambda/requirements-dev.txt`) or on PATH — plus the
# built shared layer (`lambda/layer/build-layer.sh`) for the runtime libraries
# the tests import.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ -d "$REPO_ROOT/.venv/bin" ]; then
  export PATH="$REPO_ROOT/.venv/bin:$PATH"
fi

for tool in ruff vulture pyright pytest; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool not found — install the Python toolchain: python3 -m venv .venv && .venv/bin/pip install -r lambda/requirements-dev.txt" >&2
    exit 127
  fi
done

echo "==> ruff"
scripts/lint-python.sh

echo "==> pyright (types)"
scripts/lint-python.sh --types

echo "==> vulture (production code, tests excluded)"
scripts/lint-python.sh --dead-code

echo "==> vulture (whole tree: test helpers, fixtures, stubs)"
scripts/lint-python.sh --dead-code-tests

echo "==> jscpd (Lambda production code)"
npx jscpd --config .jscpd.python.json lambda scripts

echo "==> jscpd (Lambda tests)"
npx jscpd --config .jscpd.python-tests.json lambda

echo "==> pytest"
pytest -q -p no:cacheprovider
