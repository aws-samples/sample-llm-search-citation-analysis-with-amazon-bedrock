"""
The scope-snapshot builders of the action lists (track S4), registered by ``shared.artifact_{gaps,prompts,recommendations,competitor}``.

Every builder folds one entry per keyword out of the keyword's ``actions``
partial (``EntriesBuilder``: ``gaps``, ``prompt``, ``findings``, ``ideas`` or
``competitor``), finalizes the scope's list with the shared rule and serves
it from the stored build:

- ``gaps``: ``citation_gap_rules.scope_gap_rollup``; ``keyword_summaries``
  paged, the first 30 of every gap ranked (the handler crawl-enriches them)
  with ``gaps_total`` / ``gaps_next_token``, and the totals; the whole
  ranked list is its own artifact (``GAPS_LIST``), paged by ``view=gaps``.
- ``prompts``: ``prompt_classification.ranked_prompts``, every list whole
  (2.45.0 wave 5); served as each list's first ``limit`` with
  ``<list>_next_token`` / ``<list>_total``, or (``type``) one list's page.
- ``recommendations``: ``recommendation_rules.rule_recommendations``, paged,
  with ``by_priority`` over the whole list and ``llm_keywords`` (the
  ``LLM_PROMPT_KEYWORDS`` highest-impact keywords, which the handler takes out).
- ``content-ideas``: ``content_idea_rules.ideas_artifact``, every idea;
  served with ids and this month's seasonal ideas for the tenant's
  ``industry``, ``limit`` a page (``ideas_next_token``, ``ideas_total``; ``total_count`` = ``ideas_total``).
- ``competitor``: one ``competitor_evidence.competitor_rollup`` per competitor
  any keyword ranks; served for one ``competitor`` with its outranked keywords
  paged and its first outreach targets (``view=outreach`` pages every
  exclusive source), or for every configured one (``competitors``), first
  page each.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from shared.action_artifacts import KeywordEntries, entries_of, fold_entries, list_page, offset_of, served
from shared.citation_gap_rules import scope_gap_rollup
from shared.competitor_evidence import OUTREACH_TARGETS_LIMIT, competitor_rollup
from shared.content_idea_rules import MAX_IDEAS, ideas_artifact, served_ideas
from shared.partial_contract import KeywordLatest
from shared.prompt_classification import LIST_KEYS, TYPE_LISTS, ranked_prompts
from shared.recommendation_rules import by_priority, highest_impact_keywords, rule_recommendations
from shared.snapshot_artifacts import SnapshotArtifacts, SnapshotScope, encode_snapshot_cursor

#: The most prompts a request may ask for a list (``limit``): one page.
STORED_PER_LIST = 100

#: Keywords a ``use_llm`` prompt names at most.
LLM_PROMPT_KEYWORDS = 50

Body = dict[str, Any]


@dataclass(frozen=True)
class EntriesBuilder:
    """A builder keeping, per keyword, the ``entry`` field of its ``actions`` partial.

    It stores ``store(folded, entries)`` under its ``name`` and serves
    ``shape(stored, params, build_id)`` with the build's scope fields
    (``None`` when the build does not hold it).
    """

    name: str
    entry: str
    store: Callable[[int, list[Any]], Any]
    shape: Callable[[Mapping[str, Any], Mapping[str, Any], str], Body]

    def fold(self, acc: KeywordEntries | None, latest: KeywordLatest, scope: SnapshotScope) -> KeywordEntries:
        del scope
        return fold_entries(acc, latest, lambda part: part.get(self.entry))

    def finalize(self, acc: KeywordEntries | None) -> Body:
        return {self.name: self.store(*entries_of(acc))}

    def serve(self, artifacts: SnapshotArtifacts, params: Mapping[str, Any]) -> Body | None:
        stored = artifacts.load(self.name)
        return None if stored is None else served(self.shape(stored, params, artifacts.build_id), artifacts)


# ---------------------------------------------------------------------------
# gaps
# ---------------------------------------------------------------------------

#: The artifact holding a scope's every gap ranked (``view=gaps``), apart from the rollup every body reads.
GAPS_LIST = 'gaps-list'
#: Gaps a ``view=gaps`` page holds.
GAPS_PAGE = 50


def gaps_body(stored: Mapping[str, Any], params: Mapping[str, Any], build_id: str) -> Body:
    """The ``/citation-gaps`` scope body: one page of keyword summaries, the first gaps of the whole ranked list and the totals."""
    summaries = stored['keyword_summaries']
    page, next_token = list_page(summaries, params, build_id)
    top_gaps = stored['top_gaps']
    gaps_total = int(stored.get('gaps_total', len(top_gaps)))
    return {
        'scope': params.get('scope'),
        'keywords_truncated': False,
        'keywords_analyzed': stored['keywords_analyzed'],
        'keyword_summaries': page,
        'keyword_summaries_total': len(summaries),
        'keyword_summaries_next_token': next_token,
        'top_gaps': [dict(gap) for gap in top_gaps],
        'gaps_total': gaps_total,
        'gaps_next_token': encode_snapshot_cursor(len(top_gaps), gaps_total, build_id),
        'gaps_truncated': bool(stored.get('gaps_truncated')),
        'total_gaps': stored['total_gaps'],
        'total_high_priority': stored['total_high_priority'],
    }


def gaps_page(listed: Mapping[str, Any], params: Mapping[str, Any], build_id: str) -> Body:
    """A ``view=gaps`` page: ``GAPS_PAGE`` gaps of the whole ranked list from ``offset``, ``gaps_total`` and the ``next_token``."""
    every = listed['gaps']
    offset = offset_of(params)
    return {
        'scope': params.get('scope'),
        'keywords_truncated': False,
        'gaps': [dict(gap) for gap in every[offset:offset + GAPS_PAGE]],
        'gaps_total': len(every),
        'gaps_truncated': bool(listed['truncated']),
        'next_token': encode_snapshot_cursor(offset + GAPS_PAGE, len(every), build_id),
    }


@dataclass(frozen=True)
class GapsBuilder(EntriesBuilder):
    """The gaps builder: the rollup under ``gaps`` and every gap ranked under ``GAPS_LIST`` (``view=gaps`` reads only that one)."""

    def finalize(self, acc: KeywordEntries | None) -> Body:
        rollup = scope_gap_rollup(entries_of(acc)[1])
        every = rollup.pop('gaps')
        rollup['gaps_total'] = len(every)
        return {self.name: rollup, GAPS_LIST: {'gaps': every, 'truncated': rollup['gaps_truncated']}}

    def serve(self, artifacts: SnapshotArtifacts, params: Mapping[str, Any]) -> Body | None:
        if params.get('view') != 'gaps':
            return super().serve(artifacts, params)
        listed = artifacts.load(GAPS_LIST)
        return None if listed is None else served(gaps_page(listed, params, artifacts.build_id), artifacts)


def gaps_builder() -> EntriesBuilder:
    """The ``/citation-gaps`` rollup of a scope; ``params`` carries ``limit``, ``offset``, ``view`` and the ``scope`` block to echo."""
    return GapsBuilder('gaps', 'gaps', lambda _folded, entries: scope_gap_rollup(entries), gaps_body)


# ---------------------------------------------------------------------------
# prompts
# ---------------------------------------------------------------------------

def prompts_body(stored: Mapping[str, Any], params: Mapping[str, Any], build_id: str) -> Body:
    """The ``/prompt-insights`` body of the stored ranked lists: each list's page of ``limit`` at ``offset`` (only the ``type`` one when asked).

    Every list carries ``<list>_total`` and ``<list>_next_token`` (the same
    GET with ``type=<list's type>`` and that token answers the next page).
    """
    limit, offset = min(int(params['limit']), STORED_PER_LIST), offset_of(params)
    only = TYPE_LISTS.get(str(params.get('type') or 'all'))
    chosen = list(LIST_KEYS.values()) if only is None else [only]
    lists: Body = {}
    for key in chosen:
        ranked = stored[key]
        lists[key] = [dict(record) for record in ranked[offset:offset + limit]]
        lists[f'{key}_total'] = len(ranked)
        lists[f'{key}_next_token'] = encode_snapshot_cursor(offset + limit, len(ranked), build_id)
    return {'total_prompts_analyzed': stored['total_prompts_analyzed'], **lists, 'summary': dict(stored['summary']), 'truncated': False}


def prompts_builder() -> EntriesBuilder:
    """The prompt lists of a scope, from each keyword's latest run; ``params`` carries ``limit``, ``type`` and ``offset``."""
    return EntriesBuilder('prompts', 'prompt', lambda _folded, records: ranked_prompts(records), prompts_body)


# ---------------------------------------------------------------------------
# recommendations and content ideas
# ---------------------------------------------------------------------------

def recommendations_page(stored: Mapping[str, Any], params: Mapping[str, Any], build_id: str) -> Body:
    """One page of the stored recommendations, the counts of the whole list and the LLM prompt's keywords."""
    recommendations = stored['list']
    page, next_token = list_page(recommendations, params, build_id)
    return {
        'recommendations': [dict(rec) for rec in page],
        'total': len(recommendations),
        'total_count': len(recommendations),
        'next_token': next_token,
        'by_priority': by_priority(recommendations),
        'llm_keywords': list(stored['llm_keywords']),
    }


def _stored_recommendations(_folded: int, findings: list[Any]) -> Body:
    return {'list': rule_recommendations(findings), 'llm_keywords': highest_impact_keywords(findings, LLM_PROMPT_KEYWORDS)}


def recommendations_builder() -> EntriesBuilder:
    """The rule-based recommendations of a scope; ``params`` carries ``limit`` and ``offset``."""
    return EntriesBuilder('recommendations', 'findings', _stored_recommendations, recommendations_page)


def _ideas_body(stored: Mapping[str, Any], params: Mapping[str, Any], build_id: str) -> Body:
    """One page of the scope's every idea (``limit`` from ``offset``), ``ideas_total`` (and ``total_count``) of them all and the ``ideas_next_token``.

    The ideas list is the body's own list, so its cursor and total are
    ``<list>_next_token`` / ``<list>_total`` (the 2.45.0 paging rule); the
    next page is the same GET with ``next_token``.
    """
    ideas = served_ideas(stored, str(params.get('industry') or 'general'))
    page, next_token = list_page(ideas, {'limit': MAX_IDEAS, **params}, build_id)
    return {'ideas': page, 'ideas_total': len(ideas), 'ideas_next_token': next_token, 'total_count': len(ideas), 'truncated': False}


def content_ideas_builder() -> EntriesBuilder:
    """The content ideas of a scope; ``params`` carries the brand configuration's ``industry``."""
    return EntriesBuilder('content-ideas', 'ideas', lambda _folded, entries: ideas_artifact(entries), _ideas_body)


# ---------------------------------------------------------------------------
# competitor
# ---------------------------------------------------------------------------

def competitor_rollups(evidence: Sequence[Mapping[str, Any]]) -> Body:
    """Every competitor's rollup (without its display name) by lower-cased name."""
    rollups = {}
    for name in sorted({name for entry in evidence for name in entry['competitors']}):
        rollup = competitor_rollup(name, evidence)
        del rollup['competitor']
        rollups[name] = rollup
    return rollups


_NO_ROLLUP: Body = {'outranked_keywords': [], 'exclusive_source_count': 0, 'high_priority_source_count': 0, 'outreach_targets': []}


#: Outreach targets a ``view=outreach`` page holds.
OUTREACH_PAGE = 50


def paged_rollup(stored: Mapping[str, Any], competitor: str, params: Mapping[str, Any], build_id: str) -> Body:
    """``competitor``'s stored rollup: its outranked keywords cut to the page ``params`` asks for, its first outreach targets.

    ``outreach_targets`` lists the ``OUTREACH_TARGETS_LIMIT`` best of every
    exclusive source (``outreach_targets_total``, ``outreach_targets_next_token``).
    """
    rollup = stored['rollups'].get(competitor.lower()) or _NO_ROLLUP
    outranked = rollup['outranked_keywords']
    outreach = rollup['outreach_targets']
    page, next_token = list_page(outranked, params, build_id)
    return {
        'competitor': competitor,
        **rollup,
        'outreach_targets': [dict(source) for source in outreach[:OUTREACH_TARGETS_LIMIT]],
        'outreach_targets_total': len(outreach),
        'outreach_targets_next_token': encode_snapshot_cursor(OUTREACH_TARGETS_LIMIT, len(outreach), build_id),
        'outranked_keywords': page,
        'outranked_keywords_total': len(outranked),
        'outranked_keywords_next_token': next_token,
    }


def outreach_page(stored: Mapping[str, Any], competitor: str, params: Mapping[str, Any], build_id: str) -> Body:
    """A ``view=outreach`` page of ``competitor``'s exclusive sources: ``OUTREACH_PAGE`` from ``offset``, the total and ``next_token``."""
    outreach = (stored['rollups'].get(competitor.lower()) or _NO_ROLLUP)['outreach_targets']
    offset = offset_of(params)
    return {
        'competitor': competitor,
        'outreach_targets': [dict(source) for source in outreach[offset:offset + OUTREACH_PAGE]],
        'outreach_targets_total': len(outreach),
        'next_token': encode_snapshot_cursor(offset + OUTREACH_PAGE, len(outreach), build_id),
    }


def competitor_body(stored: Mapping[str, Any], params: Mapping[str, Any], build_id: str) -> Body:
    """The body for ``params['competitor']`` (one rollup, or with ``view=outreach`` one outreach page) or every configured one."""
    header = {'keywords_analyzed': stored['keywords_folded'], 'keywords_truncated': False}
    competitor = params.get('competitor')
    if competitor and params.get('view') == 'outreach':
        return {**header, 'competitor': competitor, 'rollup': outreach_page(stored, str(competitor), params, build_id)}
    if competitor:
        return {**header, 'competitor': competitor, 'rollup': paged_rollup(stored, str(competitor), params, build_id)}
    configured = [str(name) for name in params.get('competitors') or []]
    first_pages = {**params, 'offset': 0}
    return {
        **header,
        'competitors': configured,
        'competitors_truncated': False,
        'rollups': [paged_rollup(stored, name, first_pages, build_id) for name in configured],
    }


def competitor_builder() -> EntriesBuilder:
    """The competitor rollups of a scope; ``params`` carries ``competitor`` or ``competitors``, ``limit`` and ``offset``."""
    return EntriesBuilder('competitor', 'competitor', lambda folded, evidence: {'keywords_folded': folded, 'rollups': competitor_rollups(evidence)}, competitor_body)


__all__ = [
    'GAPS_LIST',
    'GAPS_PAGE',
    'LLM_PROMPT_KEYWORDS',
    'OUTREACH_PAGE',
    'STORED_PER_LIST',
    'EntriesBuilder',
    'competitor_builder',
    'content_ideas_builder',
    'gaps_builder',
    'prompts_builder',
    'recommendations_builder',
]
