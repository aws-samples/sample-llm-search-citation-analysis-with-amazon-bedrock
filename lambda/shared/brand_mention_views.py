"""
The bounded answers of ``GET /api/brand-mentions``: per-brand summaries and appearance pages.

A brand mention in one stored answer is an *appearance* (keyword, provider,
rank, sentiment and the extracted reason / quote / ranking context, a few
hundred bytes of mostly Spanish prose). A group answer used to ship every
appearance of the selected run, twice (``brands`` and the per-classification
lists), which grew past Lambda's 6 MiB response cap. Here:

- ``brand_summary`` builds one entry per brand whose size does not grow with
  the scope: aggregates, distinct providers, per-provider best rank,
  sentiment counts and only the ``APPEARANCE_PREVIEW_LIMIT`` best-ranked
  appearances; at most ``BRAND_LIMIT`` brands, with the totals reported.
- ``appearance_rows`` is the flat, ordered list of every appearance (each
  tagged with its brand) that the ``view=appearances`` pages cut with an
  offset cursor; the Excel exports and the brand drill-down follow it.
- ``list_runs`` / ``read_run_rows`` read one run of a keyword partition by
  key condition (the sort key starts with the run timestamp) instead of
  every run ever stored.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping
from typing import Any

from shared.answer_queries import latest_run_timestamp, previous_run_timestamp, query_keyword_run_rows
from shared.dynamo_decimal import to_int

# Brands in one summary answer, best aggregate score first (the total is reported).
BRAND_LIMIT = 100

# Best-ranked appearances embedded in each brand summary of a multi-keyword
# scope (the count is reported).
APPEARANCE_PREVIEW_LIMIT = 5

# The same for one keyword: a brand appears at most once per answer of the
# run, so this keeps every appearance of a run of up to 30 answers (10
# engines x 3 personas), which the Keyword Deep Dive's sentiment examples read.
KEYWORD_APPEARANCE_LIMIT = 30

# Newest distinct runs listed in ``available_runs``.
RUN_LISTING_LIMIT = 50

# Keywords of a multi-keyword scope whose run history is walked for
# ``available_runs`` (one small Query per run); every other keyword adds only
# its latest run. A workflow run stamps every keyword it covers, so a few
# keywords list the scope's runs without one Query per run per keyword.
RUN_LISTING_DEEP_KEYWORDS = 10

# Answer text kept per ``by_provider`` entry of a single-keyword answer.
FULL_RESPONSE_MAX_CHARS = 12_000

RESPONSE_PREVIEW_CHARS = 200

UNRANKED = 999

SENTIMENT_LABELS = ('positive', 'neutral', 'negative', 'mixed')

# What a scope (group / keyword ids / all) reads per row: no answer text.
SCOPE_PROJECTION = 'keyword, #ts, provider, brands, query_prompt_id, metadata'
SCOPE_ATTRIBUTE_NAMES: Mapping[str, str] = {'#ts': 'timestamp'}

# A single keyword's summary also shows each engine's answer.
KEYWORD_PROJECTION = f'{SCOPE_PROJECTION}, citations, seo_feedback, geo_feedback, #rs'
KEYWORD_ATTRIBUTE_NAMES: Mapping[str, str] = {'#ts': 'timestamp', '#rs': 'response'}


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def list_runs(table: Any, keyword: str, latest: str | None, max_runs: int = RUN_LISTING_LIMIT) -> list[str]:
    """``keyword``'s run timestamps from ``latest`` back, newest first, at most ``max_runs``.

    One ``Limit=1`` Query per run (``previous_run_timestamp``), so listing
    runs never reads the answers they hold.
    """
    runs: list[str] = []
    current = latest
    while current is not None and len(runs) < max_runs:
        runs.append(current)
        current = previous_run_timestamp(table, keyword, current)
    return runs


def read_run_rows(
    table: Any,
    keyword: str,
    timestamp: str | None,
    *,
    projection: str = SCOPE_PROJECTION,
    attribute_names: Mapping[str, str] = SCOPE_ATTRIBUTE_NAMES,
) -> tuple[str | None, list[dict[str, Any]]]:
    """The run ``timestamp`` of ``keyword`` (its latest run when ``None``) and that run's rows.

    ``(None, [])`` when no timestamp is given and the keyword was never analysed.
    """
    selected = timestamp or latest_run_timestamp(table, keyword)
    if selected is None:
        return None, []
    rows = query_keyword_run_rows(table, keyword, selected, projection=projection, attribute_names=attribute_names)
    # The sort-key prefix selects the run; the stored timestamp confirms it.
    return selected, [row for row in rows if row.get('timestamp') == selected]


def filter_rows(rows: Iterable[dict[str, Any]], query_prompt_id: str | None, provider: str | None) -> list[dict[str, Any]]:
    """The rows of one persona (rows without one are ``default``) and one provider, when given."""
    return [
        row for row in rows
        if (not query_prompt_id or row.get('query_prompt_id', 'default') == query_prompt_id)
        and (not provider or row.get('provider') == provider)
    ]


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------

def _result_model(result: Mapping[str, Any], provider: str) -> str:
    """The stored model identifier, falling back to its provider."""
    metadata = result.get('metadata')
    if isinstance(metadata, dict):
        model = metadata.get('model')
        if isinstance(model, str) and model:
            return model
    return provider


def _appearance(result: Mapping[str, Any], brand: Mapping[str, Any], provider: str) -> dict[str, Any]:
    return {
        'keyword': result.get('keyword') or '',
        'provider': provider,
        'model': _result_model(result, provider),
        'query_prompt_id': result.get('query_prompt_id', 'default'),
        'rank': brand.get('rank'),
        'mention_count': brand.get('mention_count'),
        'first_position': brand.get('first_position'),
        'sentiment': brand.get('sentiment'),
        'sentiment_reason': brand.get('sentiment_reason'),
        'sentiment_quote': brand.get('sentiment_quote'),
        'ranking_context': brand.get('ranking_context'),
    }


def _new_brand(name: str, brand: Mapping[str, Any]) -> dict[str, Any]:
    return {
        'name': name,
        'parent_company': brand.get('parent_company'),
        # The LLM-assigned classification of the brand's first mention.
        'classification': brand.get('classification', 'other'),
        'providers': set(),
        'keywords': set(),
        'total_mentions': 0,
        'best_rank': UNRANKED,
        'appearances': [],
    }


def _add_appearance(entry: dict[str, Any], result: Mapping[str, Any], brand: Mapping[str, Any], provider: str) -> None:
    rank = to_int(brand.get('rank'), UNRANKED)
    entry['providers'].add(provider)
    if result.get('keyword'):
        entry['keywords'].add(result['keyword'])
    entry['total_mentions'] += to_int(brand.get('mention_count'), 1)
    entry['best_rank'] = min(entry['best_rank'], rank)
    entry['appearances'].append(_appearance(result, brand, provider))


def collect_brands(results: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Every brand named in ``results`` with all its appearances, best aggregate score first.

    ``aggregate_score`` = distinct providers * 10 + (10 - best rank) + total
    mentions; ``overall_rank`` is the 1-based position in that order. Brands
    are matched case-insensitively and keep the casing of their first mention.
    """
    brands: dict[str, dict[str, Any]] = {}
    for result in results:
        provider = result.get('provider') or 'unknown'
        for brand in result.get('brands') or []:
            name = brand.get('name')
            if not name:
                continue
            entry = brands.setdefault(name.lower(), _new_brand(name, brand))
            _add_appearance(entry, result, brand, provider)

    ordered = list(brands.values())
    for entry in ordered:
        entry['provider_count'] = len(entry['providers'])
        entry['aggregate_score'] = entry['provider_count'] * 10 + (10 - entry['best_rank']) + entry['total_mentions']
    ordered.sort(key=lambda entry: entry['aggregate_score'], reverse=True)
    for position, entry in enumerate(ordered, 1):
        entry['overall_rank'] = position
    return ordered


def _provider_ranks(appearances: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    """Each provider's best rank of the brand."""
    ranks: dict[str, int] = {}
    for appearance in appearances:
        rank = to_int(appearance.get('rank'), UNRANKED)
        provider = appearance['provider']
        ranks[provider] = min(rank, ranks.get(provider, UNRANKED))
    return ranks


def _sentiment_counts(appearances: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    """How many appearances carry each sentiment label (unlabelled ones are not counted)."""
    counts = Counter(appearance.get('sentiment') for appearance in appearances)
    return {label: counts[label] for label in SENTIMENT_LABELS if counts[label]}


def summarize_brand(entry: Mapping[str, Any], preview_limit: int = APPEARANCE_PREVIEW_LIMIT) -> dict[str, Any]:
    """The bounded summary of one ``collect_brands`` entry, with its ``preview_limit`` best-ranked appearances."""
    appearances: list[dict[str, Any]] = entry['appearances']
    preview = sorted(appearances, key=lambda appearance: to_int(appearance.get('rank'), UNRANKED))
    return {
        'name': entry['name'],
        'parent_company': entry['parent_company'],
        'classification': entry['classification'],
        'providers': sorted(entry['providers']),
        'provider_count': entry['provider_count'],
        'provider_ranks': _provider_ranks(appearances),
        'total_mentions': entry['total_mentions'],
        'best_rank': entry['best_rank'],
        'aggregate_score': entry['aggregate_score'],
        'overall_rank': entry['overall_rank'],
        'keyword_count': len(entry['keywords']),
        'appearance_count': len(appearances),
        'sentiment_counts': _sentiment_counts(appearances),
        'appearances': preview[:preview_limit],
    }


def _classified(brands: list[dict[str, Any]], classification: str | None) -> list[dict[str, Any]]:
    if not classification:
        return brands
    return [entry for entry in brands if entry['classification'] == classification]


def brand_summary(
    results: Iterable[Mapping[str, Any]], classification: str | None, preview_limit: int = APPEARANCE_PREVIEW_LIMIT,
) -> dict[str, Any]:
    """The ``aggregated`` block of a summary answer.

    ``brands``: the best ``BRAND_LIMIT`` brands of ``classification`` (all
    classifications when ``None``); ``matching_brands`` how many there are;
    ``total_unique_brands`` and ``summary`` count every brand of the rows.
    """
    brands = collect_brands(results)
    counts = Counter(entry['classification'] for entry in brands)
    matching = _classified(brands, classification)
    return {
        'brands': [summarize_brand(entry, preview_limit) for entry in matching[:BRAND_LIMIT]],
        'total_unique_brands': len(brands),
        'matching_brands': len(matching),
        'brands_truncated': len(matching) > BRAND_LIMIT,
        'summary': {
            'first_party_count': counts['first_party'],
            'competitor_count': counts['competitor'],
            'other_count': counts['other'],
        },
    }


def appearance_rows(
    results: Iterable[Mapping[str, Any]], classification: str | None, brand: str | None,
) -> list[dict[str, Any]]:
    """Every appearance of the brands of ``classification`` (only ``brand`` when given), in summary order.

    Each row names its brand and classification, so a page is readable on its
    own (one Excel row per appearance).
    """
    wanted = brand.strip().lower() if brand else None
    return [
        {
            'brand': entry['name'],
            'classification': entry['classification'],
            'overall_rank': entry['overall_rank'],
            **appearance,
        }
        for entry in _classified(collect_brands(results), classification)
        if wanted is None or entry['name'].lower() == wanted
        for appearance in entry['appearances']
    ]


def provider_entry(row: Mapping[str, Any]) -> dict[str, Any]:
    """One engine's answer in a single-keyword summary, its text cut at ``FULL_RESPONSE_MAX_CHARS``."""
    response = row.get('response') or ''
    preview = response[:RESPONSE_PREVIEW_CHARS] + '...' if len(response) > RESPONSE_PREVIEW_CHARS else response
    return {
        'provider': row.get('provider'),
        'timestamp': row.get('timestamp'),
        'query_prompt_id': row.get('query_prompt_id', 'default'),
        'brands': row.get('brands', []),
        'response_preview': preview,
        'full_response': response[:FULL_RESPONSE_MAX_CHARS],
        'response_truncated': len(response) > FULL_RESPONSE_MAX_CHARS,
        'response_length': len(response),
        'seo_feedback': row.get('seo_feedback', ''),
        'geo_feedback': row.get('geo_feedback', ''),
        'citations': row.get('citations', []),
    }


__all__ = [
    'APPEARANCE_PREVIEW_LIMIT',
    'BRAND_LIMIT',
    'FULL_RESPONSE_MAX_CHARS',
    'KEYWORD_APPEARANCE_LIMIT',
    'KEYWORD_ATTRIBUTE_NAMES',
    'KEYWORD_PROJECTION',
    'RUN_LISTING_DEEP_KEYWORDS',
    'RUN_LISTING_LIMIT',
    'SCOPE_ATTRIBUTE_NAMES',
    'SCOPE_PROJECTION',
    'appearance_rows',
    'brand_summary',
    'collect_brands',
    'filter_rows',
    'list_runs',
    'provider_entry',
    'read_run_rows',
    'summarize_brand',
]
