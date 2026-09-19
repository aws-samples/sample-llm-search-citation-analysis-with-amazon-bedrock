#!/usr/bin/env bash
# The test command mutmut runs against each mutant (see scripts/mutate-python.sh).
#
# mutmut 2 counts a mutant as killed only when this exits 1. pytest exits 2
# when a mutant makes the module fail to import (a collection error) — the
# strongest possible kill — so every non-zero exit is normalised to 1.
# mutmut splits its --runner string with shlex, not a shell, which is why this
# lives in a file instead of a `|| exit 1` suffix.
set -uo pipefail

python -m pytest -q -x -p no:cacheprovider "$@" || exit 1
