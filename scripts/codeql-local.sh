#!/usr/bin/env bash
# Run GitHub's CodeQL code-quality (and security) queries locally, so a push
# never meets a finding the local gates did not show first.
#
# Usage:
#   scripts/codeql-local.sh            # Python and JavaScript/TypeScript
#   scripts/codeql-local.sh python     # one language
#
# Uses the CodeQL CLI from `gh extension install github/gh-codeql` (or a
# `codeql` binary on PATH). CodeQL is free for open source; this repository is
# MIT-0. The suites are the code-quality suites, the ones the
# github-code-quality review comments from (security queries already run in the
# repository's CodeQL workflow).
# Exits non-zero when any query reports a result; the SARIF files are kept
# in .codeql-local/ (git-ignored) for inspection.
#
# Skipped (exit 0 with a notice) when no CodeQL CLI is installed, so the
# pre-push hook stays usable on a fresh clone; set CODEQL_REQUIRED=1 to fail
# instead.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if command -v codeql >/dev/null 2>&1; then
  CODEQL=(codeql)
elif command -v gh >/dev/null 2>&1 && gh codeql version >/dev/null 2>&1; then
  CODEQL=(gh codeql)
else
  if [ "${CODEQL_REQUIRED:-0}" = "1" ]; then
    echo "codeql-local: no CodeQL CLI (gh extension install github/gh-codeql)" >&2
    exit 127
  fi
  echo "codeql-local: skipped, no CodeQL CLI (install with: gh extension install github/gh-codeql)"
  exit 0
fi

OUT="$REPO_ROOT/.codeql-local"
CONFIG="$SCRIPT_DIR/codeql/codeql-config.yml"
mkdir -p "$OUT"

suites_for() {
  case "$1" in
    python) echo "codeql/python-queries:codeql-suites/python-code-quality.qls" ;;
    javascript) echo "codeql/javascript-queries:codeql-suites/javascript-code-quality.qls" ;;
    *) echo "codeql-local: unknown language $1 (python | javascript)" >&2; exit 2 ;;
  esac
}

languages=("$@")
[ "${#languages[@]}" -eq 0 ] && languages=(python javascript)

"${CODEQL[@]}" pack download codeql/python-queries codeql/javascript-queries >/dev/null

failed=0
for language in "${languages[@]}"; do
  db="$OUT/db-$language"
  sarif="$OUT/$language.sarif"
  echo "==> codeql $language: database"
  rm -rf "$db"
  if ! "${CODEQL[@]}" database create "$db" --language="$language" --source-root="$REPO_ROOT" \
    --codescanning-config="$CONFIG" --overwrite > "$OUT/$language-create.log" 2>&1; then
    tail -40 "$OUT/$language-create.log" >&2
    exit 1
  fi
  echo "==> codeql $language: analyze"
  # shellcheck disable=SC2046 # the suite list is intentionally word-split
  "${CODEQL[@]}" database analyze "$db" $(suites_for "$language") --format=sarif-latest --output="$sarif" \
    --threads=0 --quiet
  count=$(python3 - "$sarif" <<'PY'
import json, sys
runs = json.load(open(sys.argv[1]))['runs']
results = [r for run in runs for r in run.get('results', [])]
for r in results:
    loc = r['locations'][0]['physicalLocation']
    print(f"{loc['artifactLocation']['uri']}:{loc.get('region', {}).get('startLine', '?')}: "
          f"[{r['ruleId']}] {r['message']['text'].splitlines()[0]}", file=sys.stderr)
print(len(results))
PY
)
  echo "codeql $language: $count result(s)"
  [ "$count" -eq 0 ] || failed=1
done

exit "$failed"
