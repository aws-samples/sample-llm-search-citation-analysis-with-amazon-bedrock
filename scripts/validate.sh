#!/usr/bin/env bash
# Every quality gate, in parallel lanes. CI (.github/workflows/quality-gates.yml) runs this script and
# nothing else, one lane per job, so a green local `npm run validate` is a green quality-gates run.
#
# The full guide (what each lane checks, the options, the logs, how to read and fix a failure, the
# workflow an AI agent follows) is the usage() text below: `npm run validate:help` or
# `bash scripts/validate.sh --help` prints it, with the current step list.
#
# bash 3.2 (macOS /bin/bash) compatible on purpose: no associative arrays, no `wait -n`.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$PWD"
# ruff, pyright, vulture and pytest from the repo-local virtualenv when there is one.
if [[ -d "$ROOT/.venv/bin" ]]; then PATH="$ROOT/.venv/bin:$PATH"; fi
export ROOT PATH

# ---- Options ----
SERIAL=0; FAIL_FAST=1; ONLY=""; LANE_ONLY=""; LIST=0; DRY_RUN=0; FAILED_ONLY=0; HELP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --serial) SERIAL=1 ;;
    --keep-going) FAIL_FAST=0 ;;
    --only) ONLY="${2:?--only needs a comma-separated group list}"; shift ;;
    --only=*) ONLY="${1#--only=}" ;;
    --lane) LANE_ONLY="${2:?--lane needs a comma-separated lane list}"; shift ;;
    --lane=*) LANE_ONLY="${1#--lane=}" ;;
    --list) LIST=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --failed) FAILED_ONLY=1 ;;
    -h|--help) HELP=1 ;;
    *) printf 'validate: unknown option %s (see --help)\n' "$1" >&2; exit 2 ;;
  esac
  shift
done
KNOWN_GROUPS="python cdk web repo codeql"
KNOWN_LANES="py tsc lint test web sec"

# ---- Steps: lane | groups | name | command (run with `bash -euo pipefail -c` from the repo root) ----
S_LANE=(); S_GROUPS=(); S_NAME=(); S_CMD=()
def() { S_LANE+=("$1"); S_GROUPS+=("$2"); S_NAME+=("$3"); S_CMD+=("$4"); }

# Python (pyproject.toml: ruff, pyright, vulture, pytest). scripts/lint-python.sh holds the flags.
def py   python      "ruff"                                  'bash scripts/lint-python.sh'
def py   python      "pyright"                               'bash scripts/lint-python.sh --types'
def py   python      "vulture: production code"              'bash scripts/lint-python.sh --dead-code'
def py   python      "vulture: whole tree"                   'bash scripts/lint-python.sh --dead-code-tests'
# CDK env vars <-> Lambda reads; web/src/types members <-> dashboard reads (scripts/check-contracts.py).
def py   python,cdk,web "contracts"                          'bash scripts/check-contracts.sh'
# Imports runtime libraries from the built shared layer (lambda/conftest.py).
def py   python      "pytest"                                'pytest -q -p no:cacheprovider'

# Release bookkeeping: package.json, web/package.json and CHANGELOG.md's newest release agree.
def tsc  repo        "version: CHANGELOG ↔ package.json"     'node scripts/check-version.mjs'
# The repo scripts' own tests: version check, dependency audit, scheduled-failure watch, this runner.
def tsc  repo        "node: repo script tests"               'node --test scripts/check-version.test.mjs scripts/dependency-audit.test.mjs scripts/scheduled-failure-watch.test.mjs scripts/validate.test.mjs'
def tsc  cdk         "tsc: CDK app"                          'npx tsc --noEmit'
def tsc  web         "tsc: dashboard"                        'cd web && npx tsc --noEmit'
# knip twice per package: a symbol only its own tests use counts as dead in the production pass.
def tsc  cdk         "knip: CDK app"                         'npx knip --no-progress'
def tsc  cdk         "knip --production: CDK app"            'npx knip --no-progress --production --strict'
def tsc  web         "knip: dashboard"                       'cd web && npx knip --no-progress'
def tsc  web         "knip --production: dashboard"          'cd web && npx knip --no-progress --production --strict'

# ESLint over the CDK app and web/src (eslint.config.mjs, custom rules in .eslint-rules/).
def lint cdk,web     "eslint"                                'npx eslint .'
# Duplication against the reviewed baseline in .jscpd-baseline/ (failOnNewClones: 0).
def lint cdk,web     "jscpd: TypeScript"                     'npx jscpd bin lib web/src'
def lint cdk,web     "jscpd: TypeScript tests"               'npx jscpd --config .jscpd.tests.json bin lib web/src'
def lint python      "jscpd: Python"                         'npx jscpd --config .jscpd.python.json lambda scripts'
def lint python      "jscpd: Python tests"                   'npx jscpd --config .jscpd.python-tests.json lambda'
# Secrets in the working tree (.gitleaks.toml, reviewed fingerprints in .gitleaksignore).
def lint repo        "gitleaks: working tree"                'bash scripts/gitleaks-tree.sh'
# The workflows under .github/: actionlint (+ shellcheck where installed) and zizmor --offline.
def lint repo        "actions: actionlint + zizmor"          'bash scripts/actions-lint.sh'

# The CDK stack tests synthesize the app, which stages web/dist as the dashboard asset and reads both built
# layers (lib/constructs/python-layer.ts), so the dashboard is built first in the same lane.
def test cdk,web     "vite build: dashboard"                 'cd web && npx vite build --logLevel warn'
def test cdk         "vitest: CDK app"                       'npx vitest run'
def web  web         "vitest: dashboard"                     'cd web && npx vitest run'

# CodeQL security-and-quality (scripts/codeql-local.sh). Skipped on GitHub Actions, where the repository's
# CodeQL code scanning analyses every pull request; locally it skips itself without a CodeQL CLI.
# shellcheck disable=SC2016 # the command is expanded by the step shell, not here
def sec  codeql      "codeql: security and quality"          'if [ -n "${GITHUB_ACTIONS:-}" ] || [ "${VALIDATE_SKIP_CODEQL:-0}" = 1 ]; then echo "codeql: skipped (GitHub code scanning / VALIDATE_SKIP_CODEQL)"; else bash scripts/codeql-local.sh; fi'

# ---- Help ----
usage() {
  cat <<'EOF'
scripts/validate.sh: every quality gate of this repository (npm run validate)

WHAT IT DOES
  Runs every check a pull request must pass, the same way locally and in CI. Each check is a STEP with zero
  findings allowed. Steps are grouped into LANES that run at the same time; inside a lane the steps run in
  order. The first failing step stops the run (the other lanes are stopped too), prints the last 80 lines of
  its log, and the run ends with a table of every step's status and duration.

  CI (.github/workflows/quality-gates.yml) runs `--lane <name>` once per lane, each on its own runner, plus a
  final `scripts/validate.sh` check that is green only when every lane is. Same script, same steps: a green
  local run is a green CI run (except `sec`, see below).

LANES
  py    Python: ruff, pyright, vulture (production code, then the whole tree), the cross-boundary contract
        checks (scripts/check-contracts.py), pytest
  tsc   TypeScript and repo checks: version agreement (package.json, web/package.json, CHANGELOG.md), the
        repo scripts' own tests, tsc for the CDK app and the dashboard, knip (and knip --production)
  lint  ESLint, jscpd (TypeScript and Python, code and tests, against .jscpd-baseline/), gitleaks over the
        working tree, actionlint + zizmor over .github/
  test  vite build of the dashboard (the CDK app stages web/dist), then the CDK Vitest suite
  web   the dashboard Vitest suite
  sec   CodeQL security-and-quality (scripts/codeql-local.sh). Skipped on GitHub Actions, where the
        repository's CodeQL code scanning runs; skipped locally with a notice when no CodeQL CLI is installed

GROUPS (for --only)
  python  every Python step        cdk   the CDK app (bin/, lib/)     web  the dashboard (web/)
  repo    version, script tests, gitleaks, Actions lint                 codeql  CodeQL

OPTIONS
  (none)            every step, lanes in parallel, stop at the first failure
  --keep-going      let the other lanes finish after a failure (see every failing gate in one run)
  --failed          re-run only the steps that did not pass in the last run (npm run validate:failed)
  --only <groups>   only the steps tagged with one of these groups, comma-separated (--only python,web)
  --lane <lanes>    only the steps of these lanes, comma-separated (--lane py,tsc)
  --serial          every step one after another (a loaded machine, or to read the output in order)
  --list            print the steps (lane, groups, name) and exit (npm run validate:list)
  --dry-run         schedule and report every step with its command replaced by a no-op (tests the runner)
  -h, --help        this text
  Exit codes: 0 every selected step passed; 1 a step failed; 2 a usage error (unknown option, lane, group,
  or nothing selected); 130 interrupted.

LOGS
  Each run writes .cache/validate/logs/<timestamp>/ (gitignored): one <nn>-<step>.log per step with its full
  output, and timings.tsv (status, seconds, lane, step) that --failed reads. The console shows progress
  lines only; the detail is in the step logs.

PREREQUISITES (once per clone; CONTRIBUTING.md, "Local gates")
  npm install && (cd web && npm install)
  python3.12 -m venv .venv && .venv/bin/pip install -r lambda/requirements-dev.txt
  bash lambda/layer/build-layer.sh && bash lambda/crawler-layer/build-layer.sh   (again after lambda/shared/ changes)
  gitleaks, actionlint, zizmor on PATH (macOS: brew install gitleaks actionlint zizmor); shellcheck optional
  A missing tool fails its step with an install hint; it is never skipped silently.

ENVIRONMENT
  VALIDATE_LOG_ROOT     where runs are logged (default .cache/validate/logs)
  VALIDATE_LOG_DIR      this run's log directory (default $VALIDATE_LOG_ROOT/<timestamp>)
  VALIDATE_SKIP_CODEQL=1  skip CodeQL        CODEQL_REQUIRED=1  fail instead of skipping without a CodeQL CLI

FOR AI AGENTS (and anyone fixing a red run)
  1. Run `npm run validate` once, from the repo root, after the change is complete. It takes a few minutes;
     do not interrupt it, and do not run two at once (they share node_modules, .venv and the layers).
  2. On failure, read the FAILED block it prints (the last 80 lines of the step's log). When that is not
     enough, open the step's log file named there; do not re-run the whole gate to see more output.
  3. Fix the cause in the code or the test. Never make a gate pass by weakening it: no raised limit, no
     `# noqa`, `eslint-disable`, `type: ignore` or `@ts-ignore`, no new allowlist or baseline entry, no
     deleted or skipped test. An allowlist or baseline change needs a human reviewer's decision and a reason.
  4. Re-run only what failed with `npm run validate:failed` (or `--only <group>` for the area you changed),
     then run the full `npm run validate` once more before pushing: a fix in one place can break another.
  5. A step that fails for a reason outside the change (a tool not installed, a layer not built, a network
     error) is reported as such, with the step name and the log line, instead of being worked around.
  6. A green run ends with "validate: every gate passed". Anything else is not green.
  The repository's tenets (TENETS.md) are the bar a change is reviewed against; this script checks the
  mechanical part of it.

STEPS (current list, from --list)
EOF
}

# ---- Selection ----
in_list() { local want="$1" item; shift; for item in "$@"; do [[ "$item" == "$want" ]] && return 0; done; return 1; }
for want in ${ONLY//,/ }; do
  # shellcheck disable=SC2086 # the known lists are word-split on purpose
  in_list "$want" $KNOWN_GROUPS || { printf 'validate: unknown group %s (%s)\n' "$want" "$KNOWN_GROUPS" >&2; exit 2; }
done
for want in ${LANE_ONLY//,/ }; do
  # shellcheck disable=SC2086
  in_list "$want" $KNOWN_LANES || { printf 'validate: unknown lane %s (%s)\n' "$want" "$KNOWN_LANES" >&2; exit 2; }
done

# --failed: the step names whose status was not ok in the newest earlier run (dry runs never count).
LOG_ROOT="${VALIDATE_LOG_ROOT:-$ROOT/.cache/validate/logs}"
RERUN=""
if [[ "$FAILED_ONLY" -eq 1 ]]; then
  LAST_RUN=""
  while IFS= read -r t; do
    [[ -e "${t%/timings.tsv}/dry-run" && "$DRY_RUN" -eq 0 ]] && continue
    LAST_RUN="${t%/timings.tsv}"; break
  done < <(ls -1t "$LOG_ROOT"/*/timings.tsv 2>/dev/null || true)
  if [[ -z "$LAST_RUN" ]]; then
    printf 'validate: --failed needs an earlier run (none under %s)\n' "$LOG_ROOT" >&2; exit 2
  fi
  RERUN="$(awk -F'\t' '$1 != "ok" { print $4 }' "$LAST_RUN/timings.tsv")"
  if [[ -z "$RERUN" ]]; then
    printf 'validate: every step of the last run (%s) passed; nothing to re-run\n' "$LAST_RUN"; exit 0
  fi
  printf 'validate: re-running the step(s) that did not pass in %s\n' "$LAST_RUN"
fi

S_HOME=("${S_LANE[@]}")   # the lane a step is defined in; --lane selects by it, also under --serial
selected() {  # step index -> 0 when it runs in this invocation
  local want have
  if [[ -n "$LANE_ONLY" ]]; then
    # shellcheck disable=SC2086
    in_list "${S_HOME[$1]}" ${LANE_ONLY//,/ } || return 1
  fi
  if [[ "$FAILED_ONLY" -eq 1 ]]; then
    grep -qxF "${S_NAME[$1]}" <<<"$RERUN" || return 1
  fi
  [[ -z "$ONLY" ]] && return 0
  for want in ${ONLY//,/ }; do
    for have in ${S_GROUPS[$1]//,/ }; do [[ "$want" == "$have" ]] && return 0; done
  done
  return 1
}

if [[ "$HELP" -eq 1 ]]; then
  usage
  for i in "${!S_NAME[@]}"; do printf '  %-5s %-16s %s\n' "${S_LANE[$i]}" "${S_GROUPS[$i]}" "${S_NAME[$i]}"; done
  exit 0
fi
if [[ "$LIST" -eq 1 ]]; then
  for i in "${!S_NAME[@]}"; do
    if selected "$i"; then printf '%-5s %-16s %s\n' "${S_LANE[$i]}" "${S_GROUPS[$i]}" "${S_NAME[$i]}"; fi
  done
  exit 0
fi
if [[ "$SERIAL" -eq 1 ]]; then for i in "${!S_LANE[@]}"; do S_LANE[i]=serial; done; fi
# --dry-run: the same scheduling, lanes and report with every command a no-op. VALIDATE_DRY_RUN_FAIL=<step
# name> makes that one step exit 1 instead, so scripts/validate.test.mjs can drive the failure paths.
if [[ "$DRY_RUN" -eq 1 ]]; then
  for i in "${!S_CMD[@]}"; do
    if [[ "${S_NAME[$i]}" == "${VALIDATE_DRY_RUN_FAIL:-}" ]]; then S_CMD[i]='exit 1'; else S_CMD[i]=':'; fi
  done
fi

# ---- Run ----
LOG_DIR="${VALIDATE_LOG_DIR:-$LOG_ROOT/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$LOG_DIR"
if [[ "$DRY_RUN" -eq 1 ]]; then : > "$LOG_DIR/dry-run"; fi
RESULTS="$LOG_DIR/results.tsv"   # index \t exit code \t seconds
STARTED="$LOG_DIR/started.tsv"   # index
: > "$RESULTS"; : > "$STARTED"; : > "$LOG_DIR/timings.tsv"
step_log() { printf '%s/%02d-%s.log' "$LOG_DIR" "$1" "$(printf '%s' "${S_NAME[$1]}" | tr -cs 'A-Za-z0-9' '-' | sed 's/-$//')"; }
exec 3>&1   # progress lines go to the console from every lane

run_lane() {
  local lane="$1" i rc t0 dur
  for i in "${!S_NAME[@]}"; do
    if [[ "${S_LANE[$i]}" != "$lane" ]] || ! selected "$i"; then continue; fi
    printf '%s\n' "$i" >> "$STARTED"
    printf '%s  [%-6s] start  %s\n' "$(date +%T)" "$lane" "${S_NAME[$i]}" >&3
    t0=$(date +%s)
    rc=0
    (cd "$ROOT" && bash -euo pipefail -c "${S_CMD[$i]}") > "$(step_log "$i")" 2>&1 < /dev/null || rc=$?
    dur=$(( $(date +%s) - t0 ))
    printf '%s\t%s\t%s\n' "$i" "$rc" "$dur" >> "$RESULTS"
    if [[ "$rc" -ne 0 ]]; then
      printf '%s  [%-6s] FAIL   %s (%ss, exit %s)\n' "$(date +%T)" "$lane" "${S_NAME[$i]}" "$dur" "$rc" >&3
      return 1
    fi
    printf '%s  [%-6s] ok     %s (%ss)\n' "$(date +%T)" "$lane" "${S_NAME[$i]}" "$dur" >&3
  done
}

tree_pids() {  # a pid, then every descendant (parents before children)
  local child
  printf '%s\n' "$1"
  for child in $(pgrep -P "$1" 2>/dev/null || true); do tree_pids "$child"; done
}
kill_tree() {  # a lane and every process it started; listed first, then killed, so none is missed
  local p
  for p in $(tree_pids "$1"); do kill "$p" 2>/dev/null || true; done
}

LANES=()
for lane in $(printf '%s\n' "${S_LANE[@]}" | awk '!seen[$0]++'); do
  for i in "${!S_NAME[@]}"; do
    if [[ "${S_LANE[$i]}" == "$lane" ]] && selected "$i"; then LANES+=("$lane"); break; fi
  done
done
if [[ "${#LANES[@]}" -eq 0 ]]; then
  printf 'validate: no step matches%s%s\n' "${ONLY:+ --only $ONLY}" "${LANE_ONLY:+ --lane $LANE_ONLY}" >&2; exit 2
fi
T_ALL=$(date +%s)
SELECTED=0; for i in "${!S_NAME[@]}"; do if selected "$i"; then SELECTED=$(( SELECTED + 1 )); fi; done
printf 'validate: %s step(s) in %s lane(s) [%s], logs in %s\n' "$SELECTED" "${#LANES[@]}" "${LANES[*]}" "$LOG_DIR"
printf 'validate: what each step checks, how to read a failure and the workflow for agents: npm run validate:help\n'
if [[ -z "${GITHUB_ACTIONS:-}" ]]; then printf 'validate: on failure, fix the cause (never a suppression), then npm run validate:failed\n'; fi
PIDS=(); LANE_DONE=()
stop_all() { local p; for p in "${PIDS[@]+"${PIDS[@]}"}"; do kill_tree "$p"; done; }   # bash 3.2 + set -u: empty-safe
for lane in "${LANES[@]}"; do
  run_lane "$lane" &
  PIDS+=("$!"); LANE_DONE+=(0)
done
trap 'stop_all; exit 130' INT TERM

FAILED=0; STOPPED=0
remaining=${#PIDS[@]}
while [[ "$remaining" -gt 0 ]]; do
  for k in "${!PIDS[@]}"; do
    [[ "${LANE_DONE[k]}" -eq 0 ]] || continue
    kill -0 "${PIDS[$k]}" 2>/dev/null && continue
    rc=0; wait "${PIDS[$k]}" || rc=$?
    LANE_DONE[k]=1; remaining=$(( remaining - 1 ))
    if [[ "$rc" -ne 0 ]]; then
      FAILED=1
      if [[ "$FAIL_FAST" -eq 1 && "$STOPPED" -eq 0 && "$remaining" -gt 0 ]]; then
        STOPPED=1
        printf '%s  validate: lane %s failed; stopping the other lanes (--keep-going to let them finish)\n' "$(date +%T)" "${LANES[$k]}"
        stop_all
      fi
    fi
  done
  if [[ "$remaining" -gt 0 ]]; then sleep 1; fi
done
trap - INT TERM
TOTAL=$(( $(date +%s) - T_ALL ))

# ---- Report ----
result_of() { awk -F'\t' -v i="$1" '$1 == i { print $2 "\t" $3 }' "$RESULTS"; }
printf '\n%-8s %6s  %-6s %s\n' STATUS SECONDS LANE STEP
for i in "${!S_NAME[@]}"; do
  selected "$i" || continue
  r="$(result_of "$i")"
  if [[ -n "$r" ]]; then
    rc="${r%%$'\t'*}"; dur="${r##*$'\t'}"
    if [[ "$rc" -eq 0 ]]; then status=ok
    elif [[ "$STOPPED" -eq 1 && ( "$rc" -eq 143 || "$rc" -eq 137 ) ]]; then status=stopped
    else status=FAIL
    fi
  elif grep -qx "$i" "$STARTED"; then status=stopped; dur=-
  else status=not-run; dur=-
  fi
  printf '%-8s %6s  %-6s %s\n' "$status" "$dur" "${S_LANE[$i]}" "${S_NAME[$i]}"
  printf '%s\t%s\t%s\t%s\n' "$status" "$dur" "${S_LANE[$i]}" "${S_NAME[$i]}" >> "$LOG_DIR/timings.tsv"
done
printf '%-8s %6s  wall clock\n' total "$TOTAL"

if [[ "$FAILED" -ne 0 ]]; then
  while IFS=$'\t' read -r i rc _dur; do
    [[ "$rc" -eq 0 ]] && continue
    [[ "$STOPPED" -eq 1 && ( "$rc" -eq 143 || "$rc" -eq 137 ) ]] && continue   # stopped, not failed
    log="$(step_log "$i")"
    printf '\n======== FAILED: %s (exit %s), last 80 lines of %s ========\n' "${S_NAME[$i]}" "$rc" "$log"
    tail -n 80 "$log"
    printf '======== end of %s ========\n' "${S_NAME[$i]}"
  done < "$RESULTS"
  printf "\nvalidate: FAILED (logs in %s; npm run validate:failed re-runs what did not pass)\n" "$LOG_DIR"
  exit 1
fi
printf '\nvalidate: every gate passed (logs in %s)\n' "$LOG_DIR"
