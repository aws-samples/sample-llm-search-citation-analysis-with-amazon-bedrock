#!/bin/bash
# Precompile a Lambda Python tree to CPython 3.12 bytecode.
#
#   compile-python312.sh [--docker] [--runtime-dir <dir>] <tree> [<first-party dir under tree> ...]
#
# /var/task and /opt are read-only on Lambda, so a module shipped without its
# `__pycache__/<name>.cpython-312.pyc` is recompiled on EVERY cold start
# (measured at 32-73% of a router's import time). Shipping the bytecode
# removes that, but only bytecode from CPython 3.12 itself counts: the magic
# number is per minor version and the runtime silently ignores any other.
#
# Invalidation mode:
#   - third-party code (everything under <tree>): `unchecked-hash`. The .pyc
#     stores a source hash and no mtime, so the same input always produces the
#     same bytes (stable CDK asset hash) and the runtime never re-reads the
#     source to validate it.
#   - first-party dirs (e.g. `shared`): `checked-hash`. Also mtime-free and
#     deterministic; the runtime hashes the source on import, so a .py edited
#     in place can never run against stale bytecode.
# The .py files stay next to the .pyc: tracebacks, inspect and checked-hash
# validation read them.
#
# Each code object records its file name. compileall would write the build
# path (a host path, or the container's mount point), so the same input built
# on two hosts gave different bytes. `-d` records <runtime dir>/<path in tree>
# instead: where Lambda mounts the tree (/opt/python for a layer, the default).
#
# --docker compiles inside public.ecr.aws/lambda/python:3.12 (linux/amd64),
# the runtime's own interpreter. Without it the host needs CPython 3.12:
# $PYTHON312, `python3.12` on PATH, or `uv` (which fetches 3.12 if needed).
# Any other version fails the build. The result is then checked by
# scripts/verify-python-artifacts.sh with the same interpreter.

set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USE_DOCKER=false
RUNTIME_DIR="/opt/python"
while [ $# -gt 0 ]; do
    case "$1" in
        --docker) USE_DOCKER=true; shift ;;
        --runtime-dir) RUNTIME_DIR="$2"; shift 2 ;;
        *) break ;;
    esac
done
if [ $# -lt 1 ]; then
    echo "usage: $0 [--docker] [--runtime-dir <dir>] <tree> [<first-party dir> ...]" >&2
    exit 2
fi

TREE="$(cd "$1" && pwd)"
shift
FIRST_PARTY=("$@")

# Builds that differ only in when they ran must produce identical bytes.
export SOURCE_DATE_EPOCH=0
export PYTHONHASHSEED=0

compile_commands() {
    local python="$1" root="$2"
    # A worker per CPU (-j 0). Each file's bytes depend only on its source,
    # not on scheduling (verified by building twice; see README).
    "$python" -m compileall -q -j 0 --invalidation-mode unchecked-hash -d "$RUNTIME_DIR" "$root"
    for dir in "${FIRST_PARTY[@]+"${FIRST_PARTY[@]}"}"; do
        "$python" -m compileall -q -f -j 0 --invalidation-mode checked-hash -d "$RUNTIME_DIR/$dir" "$root/$dir"
    done
}

if [ "$USE_DOCKER" = true ]; then
    FIRST_PARTY_ARGS=""
    for dir in "${FIRST_PARTY[@]+"${FIRST_PARTY[@]}"}"; do
        FIRST_PARTY_ARGS+=" && python3.12 -m compileall -q -f -j 0 --invalidation-mode checked-hash -d '$RUNTIME_DIR/$dir' '/tree/$dir'"
    done
    docker run --rm \
        --platform linux/amd64 \
        --entrypoint "" \
        -e SOURCE_DATE_EPOCH=0 \
        -e PYTHONHASHSEED=0 \
        -v "$TREE":/tree \
        public.ecr.aws/lambda/python:3.12 \
        bash -c "python3.12 -m compileall -q -j 0 --invalidation-mode unchecked-hash -d '$RUNTIME_DIR' /tree${FIRST_PARTY_ARGS}"
    bash "$SCRIPTS_DIR/verify-python-artifacts.sh" --docker --runtime-dir "$RUNTIME_DIR" "$TREE" "${FIRST_PARTY[@]+"${FIRST_PARTY[@]}"}"
    exit 0
fi

PYTHON_CMD=()
if [ -n "${PYTHON312:-}" ]; then
    PYTHON_CMD=("$PYTHON312")
elif command -v python3.12 &> /dev/null; then
    PYTHON_CMD=("$(command -v python3.12)")
elif command -v uv &> /dev/null; then
    PYTHON_CMD=("$(uv python find --no-project 3.12 2>/dev/null || true)")
    if [ -z "${PYTHON_CMD[0]}" ]; then
        uv python install 3.12
        PYTHON_CMD=("$(uv python find --no-project 3.12)")
    fi
else
    echo "CPython 3.12 not found: set PYTHON312, put python3.12 on PATH, install uv, or start Docker." >&2
    exit 1
fi

if ! "${PYTHON_CMD[0]}" -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)'; then
    echo "Bytecode must be compiled by CPython 3.12 (the Lambda runtime); ${PYTHON_CMD[0]} is $("${PYTHON_CMD[0]}" -V 2>&1)." >&2
    exit 1
fi

compile_commands "${PYTHON_CMD[0]}" "$TREE"
bash "$SCRIPTS_DIR/verify-python-artifacts.sh" --python "${PYTHON_CMD[0]}" --runtime-dir "$RUNTIME_DIR" "$TREE" "${FIRST_PARTY[@]+"${FIRST_PARTY[@]}"}"
