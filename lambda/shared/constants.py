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

# ---------------------------------------------------------------------------
# Visibility score (0-100) weights — used by get-visibility-metrics.py AND
# get-historical-trends.py.
#
# The weights sum to 100 intentionally:
#   40 (provider coverage) + 30 (rank) + 20 (mentions) + 10 (sentiment) = 100.
#
# If you change any of these, update ALL four — the formula is a weighted
# average, not independent factors. See `calculate_visibility_score` in
# get-visibility-metrics.py for the authoritative implementation.
# ---------------------------------------------------------------------------
VISIBILITY_PROVIDER_WEIGHT = 40
VISIBILITY_RANK_WEIGHT = 30
VISIBILITY_MENTION_WEIGHT = 20
VISIBILITY_SENTIMENT_WEIGHT = 10

# Rank math caps: treat ranks worse than 10 as "off the list". `11 - rank`
# produces a 0-10 inverse, divided by 10 to normalize to 0-1.
VISIBILITY_RANK_CAP = 10
VISIBILITY_RANK_INVERSE_BASE = 11

# Mention math: logarithmic saturation at 50 mentions. After 50 mentions
# additional counts stop contributing to the score — prevents one extremely
# prolific brand from washing out everyone else.
VISIBILITY_MENTION_SATURATION_COUNT = 50
# The log base is `saturation + 1` because log(50 + 1) maps 50 mentions to
# the score's ceiling. Callers use `math.log(n + 1) / math.log(51)`.
VISIBILITY_MENTION_LOG_BASE = VISIBILITY_MENTION_SATURATION_COUNT + 1

# Sentinel for "not ranked" — flows through best_rank reducers. Any number
# above VISIBILITY_RANK_CAP gives the same score (zero rank contribution),
# so 999 is arbitrary but safe.
UNRANKED_SENTINEL = 999


# ---------------------------------------------------------------------------
# Trend direction classifier thresholds — used by get-historical-trends.py.
#
# `get_trend_direction` runs a linear regression over a series of visibility
# scores. Slope is in score-points per period (day/week/month depending on
# the caller's selection). The thresholds were tuned for the 0-100 visibility
# range — a slope of +2 means gaining ~2 score points per period on average,
# which is a meaningful dashboard change.
# ---------------------------------------------------------------------------
TREND_DIRECTION_IMPROVING_SLOPE = 2.0
TREND_DIRECTION_DECLINING_SLOPE = -2.0


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
