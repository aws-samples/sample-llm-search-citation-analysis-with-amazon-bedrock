#!/usr/bin/env bash
# Run Python linters for the Lambda codebase.
#
# Usage:
#   scripts/lint-python.sh                    # Check-only, exits non-zero on issues
#   scripts/lint-python.sh --fix              # Apply safe auto-fixes in place
#   scripts/lint-python.sh --full-fix         # Apply safe + whitespace-in-docstring fixes (uses --unsafe-fixes selectively)
#   scripts/lint-python.sh --dead-code        # vulture over production code only (tests cannot vouch for a symbol)
#   scripts/lint-python.sh --dead-code-tests  # vulture over the whole tree: dead test helpers, fixtures, stubs
#   scripts/lint-python.sh --types            # pyright over the directories listed in pyproject [tool.pyright].include
#
# Requires: ruff, vulture and pyright on PATH. All are pinned in
# lambda/requirements-dev.txt (`pip install -r lambda/requirements-dev.txt`),
# or install standalone with:
#   pipx install ruff
#   pipx install vulture
#   pipx install pyright
#
# Dead code runs as two scans because vulture counts any reference as a use,
# including one from a test. The production scan excludes test_*.py,
# conftest.py and lambda/testing/, so a production function that only its own
# tests still call is reported. The whole-tree scan then adds the test files;
# once the production scan is clean, whatever it reports is test-support code
# nothing exercises. Scanning test files alone is not an option: stubs assign
# attributes that production reads (`mod.s3_client = ...`), which look unused
# when production is out of the picture.
#
# Shared vulture settings (exclusions, ignored names and decorators, the 60%
# confidence floor) live in pyproject.toml [tool.vulture]. CLI flags replace
# rather than extend those values, so the production scan restates the base
# exclusions before adding its own.
#
# Types: ruff does not check them. `--types` runs pyright over the directories
# in pyproject [tool.pyright].include — a ratchet that widens as each directory
# is made clean (the header comment there records the measured backlog).
#
# For running the test suite (pytest, boto3, hypothesis), see
# lambda/requirements-dev.txt.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Prefer the repo-local virtualenv (see lambda/requirements-dev.txt) when present.
if [ -d "$REPO_ROOT/.venv/bin" ]; then
  export PATH="$REPO_ROOT/.venv/bin:$PATH"
fi

# Lambda source tree plus the repo's own Python tooling (scripts/*.py).
LAMBDA_PATH="./lambda"
PYTHON_PATHS=("$LAMBDA_PATH" ./scripts)

# Mirrors [tool.vulture].exclude in pyproject.toml; keep the two in step.
VULTURE_BASE_EXCLUDE='*/.deps/*,*/layer/python/*,*/crawler-layer/python/*,*/__pycache__/*'
VULTURE_TEST_EXCLUDE='*/test_*.py,*/conftest.py,*/testing/*'

MODE="check"
for arg in "$@"; do
  case "$arg" in
    --fix)              MODE="fix" ;;
    --full-fix)         MODE="full-fix" ;;
    --dead-code)        MODE="dead-code" ;;
    --dead-code-tests)  MODE="dead-code-tests" ;;
    --types)            MODE="types" ;;
    -h|--help)
      sed -n '2,11p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      exit 2
      ;;
  esac
done

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 not found — install with: pipx install $1" >&2
    exit 127
  fi
}

require ruff

case "$MODE" in
  check)
    echo "==> Running ruff (check-only)"
    ruff check "${PYTHON_PATHS[@]}"
    ;;

  fix)
    echo "==> Running ruff --fix (safe auto-fixes only)"
    ruff check "${PYTHON_PATHS[@]}" --fix
    echo "==> Remaining issues after fix:"
    ruff check "${PYTHON_PATHS[@]}" --statistics || true
    ;;

  full-fix)
    echo "==> Phase 1: safe auto-fixes (imports, local vars, import sort)"
    ruff check "$LAMBDA_PATH" --fix
    echo "==> Phase 2: safe ruff-specific rewrites (RUF010, RUF019, RUF100, RUF102, UP015)"
    ruff check "$LAMBDA_PATH" --select RUF010,RUF019,RUF100,RUF102,UP015 --fix || true
    echo "==> Phase 3: whitespace cleanup inside docstrings (via --unsafe-fixes)"
    ruff check "$LAMBDA_PATH" --select W293,W291 --fix --unsafe-fixes || true
    echo "==> Remaining issues after full-fix:"
    ruff check "$LAMBDA_PATH" --statistics || true
    ;;

  dead-code)
    require vulture
    echo "==> Running vulture over production code (tests excluded)"
    vulture "$LAMBDA_PATH" --exclude "$VULTURE_BASE_EXCLUDE,$VULTURE_TEST_EXCLUDE"
    ;;

  dead-code-tests)
    require vulture
    echo "==> Running vulture over the whole tree (test helpers, fixtures, stubs)"
    vulture "$LAMBDA_PATH"
    ;;

  types)
    require pyright
    echo "==> Running pyright (scope: pyproject [tool.pyright].include)"
    pyright
    ;;
esac
