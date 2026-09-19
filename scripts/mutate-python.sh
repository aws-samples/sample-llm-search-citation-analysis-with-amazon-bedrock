#!/usr/bin/env bash
# Targeted mutation testing for one Lambda module (mutmut).
#
# Usage:
#   scripts/mutate-python.sh <module.py> <test_file.py> [more test files...]
#   scripts/mutate-python.sh lambda/shared/scope_params.py lambda/shared/test_scope_params.py
#
# Why targeted: mutmut rewrites the module in place, one mutation at a time,
# and runs the given tests against each. A mutant that no test kills means
# either the tests do not pin that behaviour or the mutated statement has no
# observable effect -- the class of dead code no reference-based tool can see.
# A whole-tree run is hours; one module against its own tests is minutes, so
# this is a scheduled / per-PR-when-relevant job, not part of `npm run validate`.
#
# Reading the result: `mutmut results` lists survivors; `mutmut show <id>`
# prints the diff of one. For each survivor decide: add the test that kills it,
# or delete the statement it proves inert. Never leave a survivor unexplained.
#
# Requires the toolchain from lambda/requirements-dev.txt (mutmut is pinned there).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ -d "$REPO_ROOT/.venv/bin" ]; then
  export PATH="$REPO_ROOT/.venv/bin:$PATH"
fi

if [ "$#" -lt 2 ]; then
  sed -n '2,6p' "$0"
  exit 2
fi

MODULE="$1"
shift
TESTS=("$@")

for tool in mutmut pytest; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool not found — install the Python toolchain: python3 -m venv .venv && .venv/bin/pip install -r lambda/requirements-dev.txt" >&2
    exit 127
  fi
done

# mutmut keys its cache on the tests directory; use the module's own directory
# (tests live beside the code in this repo). Stale cache entries from an
# earlier module are harmless but noisy, so start clean.
rm -f .mutmut-cache

echo "==> mutating $MODULE against: ${TESTS[*]}"
mutmut run \
  --paths-to-mutate "$MODULE" \
  --tests-dir "$(dirname "$MODULE")" \
  --runner "scripts/mutate-python-runner.sh ${TESTS[*]}"

echo
echo "==> results (survivors need a killing test or a deletion)"
mutmut results
