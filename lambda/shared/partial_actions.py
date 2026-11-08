"""
The ``actions`` partial (track S4): one keyword's findings for the action lists.

``build`` reads one keyword's run rows once and keeps, for that keyword:

- ``gaps``: its citation-gap summary and best gaps (``citation_gap_rules``);
- ``prompt``: its winning / losing / opportunity record (``prompt_classification``);
- ``findings``: the inputs of the recommendation rules (``recommendation_rules``);
- ``competitor``: per configured competitor its best rank against the first
  party's and its exclusive sources with lift and priority (``competitor_evidence``);
- ``ideas``: its content ideas (``content_idea_rules``).

The merge keeps per-keyword entries (``{'keywords': {keyword: part}}``), so the
artifacts can sort and page them; for one keyword seen twice the newer run
wins, which keeps the merge order-free.
"""

from __future__ import annotations

import json

from shared.citation_gap_rules import keyword_gap_entry
from shared.competitor_evidence import keyword_evidence
from shared.content_idea_rules import keyword_idea_entry
from shared.partial_contract import Partial, PartialConfig, RunRows
from shared.prompt_classification import prompt_record
from shared.recommendation_rules import keyword_finding

PREVIOUS_RUN = False


def build(rows: RunRows, config: PartialConfig) -> Partial | None:
    """The keyword's action findings of this run; ``None`` for a run without rows."""
    keyword = next((str(row['keyword']) for row in rows if row.get('keyword')), '')
    if not keyword:
        return None
    timestamp = max(str(row.get('timestamp') or '') for row in rows)
    brand_config = config.brand_config
    return {
        'keyword': keyword,
        'timestamp': timestamp,
        'gaps': keyword_gap_entry(keyword, rows, brand_config),
        'prompt': prompt_record(keyword, timestamp, rows),
        'findings': keyword_finding(keyword, rows, brand_config),
        'competitor': keyword_evidence(keyword, rows, brand_config),
        'ideas': keyword_idea_entry(keyword, rows, brand_config),
    }


def _newer(kept: Partial, part: Partial) -> bool:
    """Whether ``part`` replaces ``kept`` (same keyword): the later run, and on a tie the larger encoding, so either order agrees."""
    if part['timestamp'] != kept['timestamp']:
        return str(part['timestamp']) > str(kept['timestamp'])
    return json.dumps(part, sort_keys=True, default=str) > json.dumps(kept, sort_keys=True, default=str)


def merge(acc: Partial | None, part: Partial) -> Partial:
    """``acc`` with ``part``'s keyword entry added (``part`` itself is kept, never changed)."""
    merged = acc if acc is not None else {'keywords': {}}
    kept = merged['keywords'].get(part['keyword'])
    if kept is None or _newer(kept, part):
        merged['keywords'][part['keyword']] = part
    return merged


__all__ = ['PREVIOUS_RUN', 'build', 'merge']
