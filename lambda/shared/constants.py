"""
Shared constants for scoring formulas, aggregation thresholds, and limits.

These values were previously inlined as magic numbers in individual
handlers. Audit item 27 called out the readability + tunability cost of
scattering them; this module collects the ones that have cross-handler
meaning so the formulas become self-documenting.

Rule of thumb for what belongs here:
- A number that appears in more than one file OR
- A number whose meaning is not obvious from context AND changing it
  requires a coordinated review across files.

If a number is truly local to one function (e.g. a retry count tuned to a
specific API's throttling behavior), leave it inline with a comment.
"""

from __future__ import annotations

# Sentinel for "not ranked" — flows through best_rank reducers; any real
# position is below it, so 999 is arbitrary but safe.
UNRANKED_SENTINEL = 999


# ---------------------------------------------------------------------------
# Deduplication limits — used by deduplication/handler.py.
#
# `MAX_CITATIONS_PER_KEYWORD` bounds how many deduplicated citations survive
# the prioritize step. Raising this grows the Citations table and the payload
# size to downstream consumers; lowering it drops lower-priority sources.
# Env var `MAX_CITATIONS_PER_KEYWORD` overrides at runtime.
# ---------------------------------------------------------------------------
MAX_CITATIONS_PER_KEYWORD_DEFAULT = 20


# ---------------------------------------------------------------------------
# Query prompt limits — used by manage-query-prompts.py.
#
# Soft business cap: 10 prompts per user. Increasing requires also bumping
# the `scan(Limit=...)` in `list_prompts` to match.
# ---------------------------------------------------------------------------
MAX_QUERY_PROMPTS_DEFAULT = 10

# ---------------------------------------------------------------------------
# Keyword text limit — the single cap for every route that accepts keyword
# text: manage-keywords, promote-keywords, manage-schedule, the
# keyword-research request schema, `decorators.require_keyword`'s default,
# and the search handler's `sanitize_user_input` bound. Each file previously
# declared its own 500 (bugs.md 3.3); change it here and every route moves
# together.
# ---------------------------------------------------------------------------
MAX_KEYWORD_LENGTH = 500
