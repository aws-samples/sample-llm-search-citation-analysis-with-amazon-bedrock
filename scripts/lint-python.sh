#!/usr/bin/env bash
# Run Python linters for the Lambda codebase.
#
# Usage:
#   scripts/lint-python.sh              # Check-only, exits non-zero on issues
#   scripts/lint-python.sh --fix        # Apply safe auto-fixes in place
#   scripts/lint-python.sh --full-fix   # Apply safe + whitespace-in-docstring fixes (uses --unsafe-fixes selectively)
#   scripts/lint-python.sh --dead-code  # Run vulture at 80% confidence (strict)
#   scripts/lint-python.sh --dead-code-loose  # Run vulture at 60% (more signal, filters mock return_value noise)
#
# Requires: ruff and vulture on PATH. Install once with:
#   pipx install ruff
#   pipx install vulture
#
# For running the test suite (pytest, boto3, hypothesis), see
# lambda/requirements-dev.txt.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Lambda source tree — exclude vendored deps and build artifacts.
LAMBDA_PATH="./lambda"

# Vulture exclusions and ignores. The project loads handlers dynamically via
# shared/router.py::HandlerLoader, so `handler` itself is never called
# in-repo; AWS invokes it at runtime. Decorators like @api_handler change
# the signature in ways vulture can't see through.
VULTURE_EXCLUDE='*/.deps/*,*/layer/python/*,*/crawler-layer/python/*,*/__pycache__/*'
VULTURE_IGNORE_NAMES='handler,lambda_handler,default,_api_handler,_route_handler'
VULTURE_IGNORE_DECORATORS='@api_handler,@route_handler,@validate,@parse_json_body,@paginate,@cors_preflight,@require_group,@retry_with_backoff,@pytest.fixture,@pytest.mark.parametrize'

MODE="check"
for arg in "$@"; do
  case "$arg" in
    --fix)              MODE="fix" ;;
    --full-fix)         MODE="full-fix" ;;
    --dead-code)        MODE="dead-code" ;;
    --dead-code-loose)  MODE="dead-code-loose" ;;
    -h|--help)
      sed -n '2,12p' "$0"
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

run_vulture() {
  local confidence="$1"
  vulture "$LAMBDA_PATH" \
    --exclude "$VULTURE_EXCLUDE" \
    --ignore-names "$VULTURE_IGNORE_NAMES" \
    --ignore-decorators "$VULTURE_IGNORE_DECORATORS" \
    --min-confidence "$confidence" \
    --sort-by-size
}

# Filter out the mock_object.return_value noise that vulture emits for test
# files. These are not real dead code — they're mock-object attribute
# assignments that vulture can't resolve without running the test harness.
filter_mock_noise() {
  grep -v 'return_value' || true
}

require ruff

case "$MODE" in
  check)
    echo "==> Running ruff (check-only)"
    ruff check "$LAMBDA_PATH"
    ;;

  fix)
    echo "==> Running ruff --fix (safe auto-fixes only)"
    ruff check "$LAMBDA_PATH" --fix
    echo "==> Remaining issues after fix:"
    ruff check "$LAMBDA_PATH" --statistics || true
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
    echo "==> Running vulture at 80% confidence"
    run_vulture 80
    ;;

  dead-code-loose)
    require vulture
    echo "==> Running vulture at 60% confidence (filtering mock return_value noise)"
    run_vulture 60 | filter_mock_noise
    ;;
esac
