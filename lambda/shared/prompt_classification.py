"""
Which prompts (keywords) win, lose, or are an opportunity (``GET /api/prompt-insights``).

A keyword is classified from every row of its **latest run**: the
first-party side and the competitor side are tallied from the LLM-assigned
brand classification, then the keyword is *winning* (first party in the top
3), an *opportunity* (competitors named, the first party not), *losing* (the
first party absent or below 5th) or *neutral* (4th-5th, listed with the
winning prompts). The rules were in ``api/get-prompt-insights.py``; the
handler's live path, the ``actions`` partial and the ``prompts`` artifact
share them here.

Ranks are total orders (score, then the scope's keyword order), so a scope's
lists do not depend on the order its keywords were merged in.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from shared.dynamo_decimal import to_int
from shared.kpi_engine import percent
from shared.scope_order import brand_mentions, keyword_order

#: Rank sentinel for a brand side that was never mentioned; reported as ``best_rank: None``.
UNRANKED = 999

WINNING = 'winning'
LOSING = 'losing'
OPPORTUNITY = 'opportunity'
NEUTRAL = 'neutral'

#: The response list of each bucket, and the score each bucket ranks by.
LIST_KEYS = {WINNING: 'winning_prompts', LOSING: 'losing_prompts', OPPORTUNITY: 'opportunity_prompts'}
#: The one list a request's ``type`` keeps.
TYPE_LISTS = {'winning': LIST_KEYS[WINNING], 'losing': LIST_KEYS[LOSING], 'opportunities': LIST_KEYS[OPPORTUNITY]}
_SCORE_FIELDS = {WINNING: 'score', LOSING: 'improvement_potential', OPPORTUNITY: 'opportunity_score'}


@dataclass
class _BrandPresence:
    """Running tally of one brand side (first-party or competitors) across a keyword's latest run."""

    mentions: int = 0
    best_rank: int = UNRANKED
    providers: set[str] = field(default_factory=set)

    def record(self, provider: str, brand: Mapping[str, Any]) -> None:
        self.mentions += to_int(brand.get('mention_count'), 1)
        self.best_rank = min(self.best_rank, to_int(brand.get('rank'), UNRANKED))
        self.providers.add(provider)

    def coverage(self, total_providers: int) -> float:
        """Share of the run's rows whose provider named this side (0 for an empty run)."""
        return len(self.providers) / total_providers if total_providers > 0 else 0

    def as_dict(self, total_providers: int) -> dict[str, Any]:
        return {
            'mentions': self.mentions,
            'best_rank': self.best_rank if self.best_rank < UNRANKED else None,
            'provider_coverage': round(self.coverage(total_providers) * 100, 1),
            'providers': sorted(self.providers),
        }


def _tally_brand_presence(rows: Iterable[Mapping[str, Any]]) -> tuple[_BrandPresence, _BrandPresence]:
    first_party = _BrandPresence()
    competitors = _BrandPresence()
    for provider, brand in brand_mentions(rows):
        classification = brand.get('classification', 'other')
        if classification == 'first_party':
            first_party.record(provider, brand)
        elif classification == 'competitor':
            competitors.record(provider, brand)
    return first_party, competitors


def _classify(first_party: _BrandPresence, competitors: _BrandPresence, total_providers: int) -> dict[str, Any]:
    """The prompt's ``status`` plus the score field that status carries."""
    fp_provider_coverage = first_party.coverage(total_providers)
    if first_party.mentions > 0 and first_party.best_rank <= 3:
        score = (fp_provider_coverage * 50) + ((4 - first_party.best_rank) / 3 * 30) + (min(first_party.mentions, 10) / 10 * 20)
        return {'status': WINNING, 'score': round(score, 1)}
    if first_party.mentions == 0 and competitors.mentions > 0:
        opportunity_score = (competitors.coverage(total_providers) * 50) + (min(competitors.mentions, 10) / 10 * 50)
        return {'status': OPPORTUNITY, 'opportunity_score': round(opportunity_score, 1)}
    if first_party.mentions == 0 or first_party.best_rank > 5:
        improvement_potential = 100 - (fp_provider_coverage * 50) - ((10 - min(first_party.best_rank, 10)) / 10 * 50)
        return {'status': LOSING, 'improvement_potential': round(improvement_potential, 1)}
    return {'status': NEUTRAL}


def prompt_record(keyword: str, timestamp: str, rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """One keyword's prompt record from every row of its latest run (stamped ``timestamp``)."""
    total_providers = len(rows)
    first_party, competitors = _tally_brand_presence(rows)
    return {
        'keyword': keyword,
        'timestamp': timestamp,
        'first_party': first_party.as_dict(total_providers),
        'competitors': competitors.as_dict(total_providers),
        'total_providers': total_providers,
        **_classify(first_party, competitors, total_providers),
    }


def bucket_of(record: Mapping[str, Any]) -> str:
    """The list a record belongs to: neutral prompts sit with the winning ones."""
    status = str(record['status'])
    return WINNING if status == NEUTRAL else status


def record_order(record: Mapping[str, Any]) -> tuple[float, str, str]:
    """A record's rank inside its list: best score first, then the scope's keyword order."""
    return -float(record.get(_SCORE_FIELDS[bucket_of(record)], 0)), *keyword_order(str(record['keyword']))


def ranked_prompts(records: Iterable[Mapping[str, Any]], limit: int | None = None) -> dict[str, Any]:
    """The insights payload of a scope's records (any order): each list ranked (its top ``limit``; ``None``: whole) and the counts of every record."""
    buckets: dict[str, list[Mapping[str, Any]]] = {bucket: [] for bucket in LIST_KEYS}
    for record in records:
        buckets[bucket_of(record)].append(record)
    for bucket in buckets.values():
        bucket.sort(key=record_order)
    counts = {bucket: len(rows) for bucket, rows in buckets.items()}
    return {
        **{LIST_KEYS[bucket]: [dict(record) for record in rows[:limit]] for bucket, rows in buckets.items()},
        **prompt_counts(counts),
    }


def prompt_counts(counts: Mapping[str, int]) -> dict[str, Any]:
    """``total_prompts_analyzed`` and the ``summary`` block from the number of records in each list."""
    total = sum(counts.values())
    return {
        'total_prompts_analyzed': total,
        'summary': {
            'winning_count': counts[WINNING],
            'losing_count': counts[LOSING],
            'opportunity_count': counts[OPPORTUNITY],
            'win_rate': percent(counts[WINNING], total) if total else 0,
        },
    }


__all__ = ['LIST_KEYS', 'OPPORTUNITY', 'TYPE_LISTS', 'WINNING', 'bucket_of', 'prompt_counts', 'prompt_record', 'ranked_prompts', 'record_order']
