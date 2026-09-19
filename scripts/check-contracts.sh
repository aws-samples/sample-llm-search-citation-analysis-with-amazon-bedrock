#!/usr/bin/env bash
# Run the cross-boundary contract checks (scripts/check-contracts.py) with the
# repo-local Python toolchain, the way the other Python-driven gates do.
#
# Usage:
#   scripts/check-contracts.sh          # env + types
#   scripts/check-contracts.sh env      # one check
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ -d "$REPO_ROOT/.venv/bin" ]; then
  export PATH="$REPO_ROOT/.venv/bin:$PATH"
fi

echo "==> contracts (CDK env vars <-> Lambda reads; web/src/types members <-> dashboard reads)"
python3 scripts/check-contracts.py "$@"
