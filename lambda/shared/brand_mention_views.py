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
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.answer_queries import latest_run_timestamp, previous_run_timestamp, query_keyword_run_rows
from shared.dynamo_decimal import to_int
from shared.keyword_major_pages import PageRequest, keyword_major_page
from shared.request_deadline import current_deadline
from shared.response_budget import take_within_budget
from shared.scope_source import route_scope
from shared.snapshot_artifacts import SOURCE_LIVE, SOURCE_SNAPSHOT, ScopeSource, encode_snapshot_cursor

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
    runs never reads the answers they hold, however many a run has. The
    listing stops early, after ``latest``, when the request's time budget
    (``shared.request_deadline``) is spent.
    """
    deadline = current_deadline()
    runs: list[str] = []
    current = latest
    while current is not None and len(runs) < max_runs:
        runs.append(current)
        if deadline.stop_reading('a run listing'):
            break
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
# Where a scope is answered from (design 2.45.0 §2, ``shared.scope_source``)
# ---------------------------------------------------------------------------

#: The most answers one keyword-run holds (10 personas x every AI and search provider), for the routing shortcut.
MAX_ANSWERS_PER_RUN = 100

#: Keywords whose latest run is counted to measure the answers per run of a scope.
ANSWER_PROBE_KEYWORDS = 3


def _run_row_count(table: Any, keyword: str) -> int:
    latest = latest_run_timestamp(table, keyword)
    if latest is None:
        return 0
    response = table.query(
        KeyConditionExpression=Key('keyword').eq(keyword) & Key('timestamp_provider').begins_with(f'{latest}#'),
        Select='COUNT',
    )
    return to_int(response.get('Count'), len(response.get('Items') or []))


def answers_per_run(table: Any, keywords: Sequence[str]) -> int:
    """The answers a keyword-run of the scope holds: the most of the first ``ANSWER_PROBE_KEYWORDS`` keywords' latest runs."""
    return max((_run_row_count(table, keyword) for keyword in keywords[:ANSWER_PROBE_KEYWORDS]), default=0)


def latest_run_source(table: Any, kind: str, keywords: Sequence[str]) -> ScopeSource:
    """``'live'`` or ``'snapshot'`` for a view that reads one run (the latest) of each keyword.

    ``route_scope`` with the answers per run counted on the scope's first
    keywords (two small Queries each), skipped when the keyword count alone
    decides: at least one answer per keyword over the budget is a snapshot,
    ``MAX_ANSWERS_PER_RUN`` within it is live.
    """
    count = len(keywords)
    if route_scope(kind, count, personas=1, engines=1, runs_needed=1) == SOURCE_SNAPSHOT:
        return SOURCE_SNAPSHOT
    if route_scope(kind, count, personas=MAX_ANSWERS_PER_RUN, engines=1, runs_needed=1) == SOURCE_LIVE:
        return SOURCE_LIVE
    return route_scope(kind, count, personas=answers_per_run(table, keywords), engines=1, runs_needed=1)


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


def appearance_from_row(result: Mapping[str, Any], brand: Mapping[str, Any], provider: str) -> dict[str, Any]:
    """One appearance of ``brand`` (a stored brand dict of ``result``) as the summary and the pages list it."""
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
    entry['appearances'].append(appearance_from_row(result, brand, provider))


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
    matching = _classified(brands, classification)
    return aggregated_block(
        [summarize_brand(entry, preview_limit) for entry in matching[:BRAND_LIMIT]],
        total=len(brands),
        matching=len(matching),
        classifications=Counter(entry['classification'] for entry in brands),
    )


def brand_list_page(
    results: Iterable[Mapping[str, Any]], classification: str | None, offset: int, preview_limit: int = APPEARANCE_PREVIEW_LIMIT,
) -> tuple[list[dict[str, Any]], int]:
    """One ``view=brands`` page: the ``BRAND_LIMIT`` brands of ``classification`` from ``offset`` (summary order) and how many match."""
    matching = _classified(collect_brands(results), classification)
    return [summarize_brand(entry, preview_limit) for entry in matching[offset:offset + BRAND_LIMIT]], len(matching)


def with_brands_cursor(aggregated: Mapping[str, Any], build_id: str) -> dict[str, Any]:
    """The summary's ``aggregated`` block with ``brands_total`` and the token of the next brand page (2.45.0).

    ``brands`` is the first ``BRAND_LIMIT`` of every matching brand;
    ``brands_next_token`` pages the rest with ``view=brands`` (``None`` when
    they all fit). The token names ``build_id``: the snapshot build, a view
    job's build, or ``live``.
    """
    total = int(aggregated['matching_brands'])
    return {**aggregated, 'brands_total': total, 'brands_next_token': encode_snapshot_cursor(BRAND_LIMIT, total, build_id)}


def brands_page_block(brands: list[dict[str, Any]], total: int, offset: int, build_id: str) -> dict[str, Any]:
    """The ``aggregated`` block of a ``view=brands`` page: its brands, ``brands_total`` and ``next_token``."""
    return {'brands': brands, 'brands_total': total, 'next_token': encode_snapshot_cursor(offset + BRAND_LIMIT, total, build_id)}


def aggregated_block(brands: list[dict[str, Any]], *, total: int, matching: int, classifications: Mapping[str, int]) -> dict[str, Any]:
    """The ``aggregated`` block around its listed ``brands``: ``total`` brands, ``matching`` the filter, counts by classification."""
    return {
        'brands': brands,
        'total_unique_brands': total,
        'matching_brands': matching,
        'brands_truncated': matching > BRAND_LIMIT,
        'summary': {
            'first_party_count': classifications.get('first_party', 0),
            'competitor_count': classifications.get('competitor', 0),
            'other_count': classifications.get('other', 0),
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


def rank_map(brands: Iterable[Mapping[str, Any]]) -> dict[str, list[Any]]:
    """``collect_brands`` entries by brand key: ``[overall_rank, appearance count, classification, name]``.

    The same shape the snapshot's brand index stores per combo, so live and
    snapshot appearance pages order and label appearances alike.
    """
    return {
        entry['name'].lower(): [entry['overall_rank'], len(entry['appearances']), entry['classification'], entry['name']]
        for entry in brands
    }


def keyword_appearances(
    rows: Iterable[Mapping[str, Any]],
    ranks: Mapping[str, Sequence[Any]],
    classification: str | None,
    brand: str | None,
) -> list[dict[str, Any]]:
    """One keyword's appearances in keyword-major order: by the brand's ``overall_rank``, then as read.

    ``rows`` are the keyword's rows of the selected run (already filtered by
    persona and provider), in sort-key order; ``ranks`` is ``rank_map`` of
    the whole scope (or the snapshot's brand index); a brand it does not
    know is not listed. ``classification`` and ``brand`` filter as
    ``appearance_rows`` does.
    """
    wanted = brand.strip().lower() if brand else None
    found: list[dict[str, Any]] = []
    for row in rows:
        provider = row.get('provider') or 'unknown'
        for stored in row.get('brands') or []:
            name = stored.get('name')
            ranked = ranks.get(name.lower()) if name else None
            if ranked is None or (classification and ranked[2] != classification):
                continue
            if wanted is not None and name.lower() != wanted:
                continue
            found.append({
                'brand': ranked[3], 'classification': ranked[2], 'overall_rank': ranked[0],
                **appearance_from_row(row, stored, provider),
            })
    found.sort(key=lambda appearance: appearance['overall_rank'])
    return found


def appearance_page(request: PageRequest[dict[str, Any]]) -> tuple[list[dict[str, Any]], str | None]:
    """One keyword-major page of appearances (at most ``limit``, within the page byte budget) and its ``next_token``.

    ``request.read(index)`` is ``keyword_appearances`` of the keyword at
    ``index``; only the keywords the page covers are read.
    """
    def within_budget(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return take_within_budget(items, max_items=request.limit)[0]

    return keyword_major_page(request, within_budget)


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
    'aggregated_block',
    'answers_per_run',
    'appearance_from_row',
    'appearance_page',
    'appearance_rows',
    'brand_list_page',
    'brand_summary',
    'brands_page_block',
    'collect_brands',
    'filter_rows',
    'keyword_appearances',
    'latest_run_source',
    'list_runs',
    'provider_entry',
    'rank_map',
    'read_run_rows',
    'summarize_brand',
    'with_brands_cursor',
]
