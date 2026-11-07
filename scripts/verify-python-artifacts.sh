#!/bin/bash
# Check a built Lambda Python tree before it ships.
#
#   verify-python-artifacts.sh (--docker | --python <cpython 3.12>) \
#       [--runtime-dir <dir>] <tree> [<first-party dir under tree> ...]
#
# Fails (exit 1, one line per problem) unless:
#   - every .py has `__pycache__/<name>.cpython-312.pyc` with the 3.12 magic
#     number and the source hash of that .py (PEP 552), and no other
#     interpreter's bytecode is present;
#   - first-party dirs are `checked-hash` (flags 0b11), everything else
#     `unchecked-hash` (0b01): no timestamp-based bytecode anywhere;
#   - each code object's file name is <runtime dir>/<path in tree>, so the
#     bytes do not depend on where or on which host the tree was built;
#   - every native extension (.so) is an x86_64 ELF, what the Lambda runtime loads.
#
# The check needs CPython 3.12 itself (the magic number and the source-hash key
# are per version): --docker runs it in public.ecr.aws/lambda/python:3.12,
# --python with the given interpreter. scripts/compile-python312.sh calls it
# after every compile, with the interpreter it compiled with.

set -euo pipefail

MODE=""
PYTHON=""
RUNTIME_DIR="/opt/python"
while [ $# -gt 0 ]; do
    case "$1" in
        --docker) MODE=docker; shift ;;
        --python) MODE=local; PYTHON="$2"; shift 2 ;;
        --runtime-dir) RUNTIME_DIR="$2"; shift 2 ;;
        *) break ;;
    esac
done
if [ -z "$MODE" ] || [ $# -lt 1 ]; then
    echo "usage: $0 (--docker | --python <python3.12>) [--runtime-dir <dir>] <tree> [<first-party dir> ...]" >&2
    exit 2
fi

TREE="$(cd "$1" && pwd)"
shift

read -r -d '' CHECK <<'PY' || true
import importlib.util
import marshal
import os
import sys

tree, runtime_dir, first_party = sys.argv[1], sys.argv[2], sys.argv[3:]
assert sys.version_info[:2] == (3, 12), sys.version
tag = sys.implementation.cache_tag
problems = []
counts = {"py": 0, "so": 0}


def is_first_party(relative):
    return any(relative == d or relative.startswith(d + "/") for d in first_party)


def check_source(path, relative):
    counts["py"] += 1
    directory, name = os.path.split(path)
    pyc = os.path.join(directory, "__pycache__", name[:-3] + "." + tag + ".pyc")
    if not os.path.isfile(pyc):
        problems.append(f"no {tag} bytecode: {relative}")
        return
    with open(pyc, "rb") as handle:
        data = handle.read()
    with open(path, "rb") as handle:
        source = handle.read()
    flags = int.from_bytes(data[4:8], "little")
    wanted = 0b11 if is_first_party(relative) else 0b01
    if data[:4] != importlib.util.MAGIC_NUMBER:
        problems.append(f"not 3.12 bytecode: {relative}")
    elif flags != wanted:
        problems.append(f"invalidation flags {flags:#04b}, expected {wanted:#04b}: {relative}")
    elif data[8:16] != importlib.util.source_hash(source):
        problems.append(f"stale bytecode: {relative}")
    elif marshal.loads(data[16:]).co_filename != runtime_dir + "/" + relative:
        problems.append(f"build path in bytecode ({marshal.loads(data[16:]).co_filename}): {relative}")


def check_extension(path, relative):
    counts["so"] += 1
    with open(path, "rb") as handle:
        header = handle.read(20)
    # ELF magic, ELFCLASS64, little-endian, e_machine EM_X86_64 (0x3e).
    if header[:6] != b"\x7fELF\x02\x01" or header[18:20] != b"\x3e\x00":
        problems.append(f"not an x86_64 ELF extension: {relative}")


for root, dirs, files in os.walk(tree):
    dirs.sort()
    for name in sorted(files):
        path = os.path.join(root, name)
        relative = os.path.relpath(path, tree).replace(os.sep, "/")
        if name.endswith(".py"):
            check_source(path, relative)
        elif name.endswith(".pyc") and not name.endswith("." + tag + ".pyc"):
            problems.append(f"foreign bytecode: {relative}")
        elif name.endswith(".so") or ".so." in name:
            check_extension(path, relative)

for problem in problems[:50]:
    print(problem, file=sys.stderr)
if problems:
    sys.exit(f"{len(problems)} problem(s) in {tree}")
print(f"verified {counts['py']} modules ({tag}, hash-based) and {counts['so']} x86_64 extensions")
PY

if [ "$MODE" = docker ]; then
    docker run --rm \
        --platform linux/amd64 \
        --entrypoint "" \
        -v "$TREE":/tree:ro \
        public.ecr.aws/lambda/python:3.12 \
        python3.12 -c "$CHECK" /tree "$RUNTIME_DIR" "$@"
else
    "$PYTHON" -c "$CHECK" "$TREE" "$RUNTIME_DIR" "$@"
fi
