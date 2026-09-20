#!/usr/bin/env bash
# Targeted mutation testing for one Lambda module (mutmut).
#
# Usage:
#   scripts/mutate-python.sh [--patch <git-range>] <module.py> <test_file.py> [more test files...]
#   scripts/mutate-python.sh lambda/shared/scope_params.py lambda/shared/test_scope_params.py
#   scripts/mutate-python.sh --patch e9c33b9..64bd280 lambda/api/manage-alerts.py lambda/api/test_manage_alerts.py
#
# Why targeted: mutmut rewrites the module in place, one mutation at a time,
# and runs the given tests against each. A mutant that no test kills means
# either the tests do not pin that behaviour or the mutated statement has no
# observable effect -- the class of dead code no reference-based tool can see.
# A whole-tree run is hours; one module against its own tests is minutes, so
# this is a scheduled / per-PR-when-relevant job, not part of `npm run validate`.
# Use --patch for release/PR work so only lines added or changed in that git
# range are mutated; mutmut parses the temporary zero-context diff itself.
#
# Reading the result: `mutmut results` lists survivors; `mutmut show <id>`
# prints the diff of one. For each survivor decide: add the test that kills it,
# or delete the statement it proves inert. Never leave a survivor unexplained.
#
# Requires the Python 3.12 toolchain from lambda/requirements-dev.txt.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Respect an activated environment. Otherwise use the repository environment.
if [ -z "${VIRTUAL_ENV:-}" ] && [ -d "$REPO_ROOT/.venv/bin" ]; then
  export PATH="$REPO_ROOT/.venv/bin:$PATH"
fi

usage() {
  printf '%s\n' \
    'Usage:' \
    '  scripts/mutate-python.sh [--patch <git-range>] <module.py> <test_file.py> [more test files...]' \
    '  scripts/mutate-python.sh lambda/shared/scope_params.py lambda/shared/test_scope_params.py' \
    '  scripts/mutate-python.sh --patch e9c33b9..64bd280 lambda/api/manage-alerts.py lambda/api/test_manage_alerts.py'
}

PATCH_RANGE=''
case "${1:-}" in
  --patch)
    if [ "$#" -lt 4 ]; then
      usage
      exit 2
    fi
    PATCH_RANGE="$2"
    shift 2
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  -*)
    printf 'Unknown option: %s\n' "$1" >&2
    usage >&2
    exit 2
    ;;
esac

if [ "$#" -lt 2 ]; then
  usage
  exit 2
fi

MODULE="$1"
shift
TESTS=("$@")

for tool in git mutmut pytest python; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool not found — install the Python 3.12 toolchain: python3.12 -m venv .venv && .venv/bin/pip install -r lambda/requirements-dev.txt" >&2
    exit 127
  fi
done

if ! python -c 'import sys; raise SystemExit(sys.version_info[:2] != (3, 12))'; then
  printf 'Mutation testing requires Python 3.12, matching the Lambda runtime; activate a Python 3.12 environment first.\n' >&2
  exit 2
fi

if [ ! -f "$MODULE" ]; then
  printf 'Module not found: %s\n' "$MODULE" >&2
  exit 2
fi

PATCH_FILE=''
MODULE_SNAPSHOT="$(mktemp "${TMPDIR:-/tmp}/mutmut-module.XXXXXX")"
cp "$MODULE" "$MODULE_SNAPSHOT"

cleanup() {
  local status="$?"
  trap - EXIT
  if ! cmp -s "$MODULE_SNAPSHOT" "$MODULE"; then
    printf 'mutmut did not restore %s; restoring the pre-run source snapshot\n' "$MODULE" >&2
    cp "$MODULE_SNAPSHOT" "$MODULE"
    if [ "$status" -eq 0 ]; then
      status=1
    fi
  fi
  rm -f "$MODULE_SNAPSHOT"
  if [ -n "$PATCH_FILE" ]; then
    rm -f "$PATCH_FILE"
  fi
  exit "$status"
}
trap cleanup EXIT

if [ -n "$PATCH_RANGE" ]; then
  PATCH_FILE="$(mktemp "${TMPDIR:-/tmp}/mutmut-patch.XXXXXX")"
  git diff --unified=0 --no-ext-diff --output="$PATCH_FILE" "$PATCH_RANGE" -- "$MODULE"
  if [ ! -s "$PATCH_FILE" ]; then
    printf 'No changes for %s in git range %s\n' "$MODULE" "$PATCH_RANGE" >&2
    exit 2
  fi
fi

# mutmut keys its cache on the tests directory; use the module's own directory
# (tests live beside the code in this repo). Start every campaign clean so its
# counts and survivor IDs cannot be contaminated by an earlier module.
rm -f .mutmut-cache

if [ -n "$PATCH_RANGE" ]; then
  echo "==> mutating changed lines in $MODULE from $PATCH_RANGE against: ${TESTS[*]}"
else
  echo "==> mutating $MODULE against: ${TESTS[*]}"
fi

MUTMUT_ARGS=(
  run
  --paths-to-mutate "$MODULE"
  --tests-dir "$(dirname "$MODULE")"
  --runner "scripts/mutate-python-runner.sh ${TESTS[*]}"
  --simple-output
  --no-progress
)
if [ -n "$PATCH_FILE" ]; then
  MUTMUT_ARGS+=(--use-patch-file "$PATCH_FILE")
fi

set +e
mutmut "${MUTMUT_ARGS[@]}"
RUN_STATUS="$?"

echo
echo "==> results (survivors need a killing test or a deletion)"
mutmut results
RESULTS_STATUS="$?"
set -e

if [ "$RUN_STATUS" -ne 0 ]; then
  exit "$RUN_STATUS"
fi
exit "$RESULTS_STATUS"
