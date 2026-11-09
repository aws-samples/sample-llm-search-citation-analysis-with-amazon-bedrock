"""
KeywordLatest: what one keyword contributes to every scope snapshot (design 2.45.0 §2.1).

One gzip-JSON object per keyword, ``scope-snapshots/keywords/<sha256(keyword)[:32]>.json.gz``
in the keywords bucket, written by the Deduplication step when the keyword's
run is done (``record_keyword_latest``, after its KeywordRunKpis row) and by the
backfill's ``latest`` mode. The scope snapshot build folds every object.

Fields (``KeywordLatestDoc``, extending ``shared.partial_contract.KeywordLatest``):

- ``v``, ``keyword``, ``keyword_id``, ``config``: the format, the keyword and
  the fingerprint of the ``PartialConfig`` (brand config, enabled personas)
  the parts were built with (``config_fingerprint``).
- ``latest`` / ``previous``: the two newest runs by timestamp, each with every
  registered partial (``shared.partials.PARTIALS``) built from its rows. The
  previous run keeps only the partials whose ``PREVIOUS_RUN`` is set. A
  partial whose ``build`` is not written yet (``NotImplementedError``) or fails
  is left out of ``parts`` and logged; it never fails the keyword.
- ``tallies``: the ``RunTally`` of those two runs with every brand
  (``tally_entry``), the scope series' input.
- ``recent``: the base tally (no brands) of every run in the ``RECENT_DAYS``
  before the latest one, oldest first: trend presets of the last two months.
- ``series``: compact per-run KPIs of the last ``SERIES_RUNS`` runs
  (``{'k': SERIES_KPIS, 'r': [[timestamp, value, ...], ...]}``, oldest first):
  the stability facts.
- ``counts`` (when the writer was given a ``shared.keyword_counts.KeywordCounter``):
  the keyword's SearchResults, Citations and CrawledContent rows, which the
  ``stats`` artifact sums per market.

Writes are conditional (``If-Match`` on the ETag read, ``If-None-Match: *``
for a new object) and retried on a conflict, so a run and a backfill never
interleave; a rerun of the same run replaces it, so writes are idempotent.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, NotRequired, TypeGuard

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from shared.dynamodb_batch import collect_all_items
from shared.keyword_counts import KeywordCounter
from shared.keyword_run_kpis import tally_from_item, tally_item
from shared.kpi_engine import owned_domains_from
from shared.kpi_tally import RunTally, tally_kpis
from shared.partial_contract import KeywordLatest, KeywordLatestRun, Partial, PartialConfig, RunRows
from shared.partials import PARTIALS
from shared.snapshot_store import decode_json, encode_json, is_missing_object, is_precondition_failed

logger = logging.getLogger(__name__)

#: 2 (2.48.0): the counts carry ``citations_current`` (``shared.kpi_tally.COUNT_FIELDS``); a version-1 object is read
#: as absent and rebuilt from the answers (the ``latest`` backfill rewrites every object).
KEYWORD_LATEST_VERSION = 2
KEYWORDS_PREFIX = 'scope-snapshots/keywords/'
RECENT_DAYS = 62
SERIES_RUNS = 365
SERIES_KPIS = ('answers', 'mentions', 'mention_rate', 'average_position', 'visibility_score', 'share_of_voice', 'net_sentiment')
WRITE_ATTEMPTS = 3

#: Errors a partial's ``build`` may raise on rows it does not expect; the partial is left out, the keyword goes on.
_PARTIAL_ERRORS = (NotImplementedError, KeyError, TypeError, ValueError, AttributeError, IndexError, ArithmeticError)
_BRAND_CONFIG_NOISE = frozenset({'updated_at', 'created_at', 'config_id'})


class KeywordLatestDoc(KeywordLatest):
    """The stored object: the partial contract's fields plus the history blocks of the scope series."""

    tallies: dict[str, dict[str, Any]]
    recent: list[dict[str, Any]]
    series: dict[str, Any]
    counts: NotRequired[dict[str, Any]]


def with_counts(doc: KeywordLatestDoc, stored: KeywordLatestDoc | None, counter: KeywordCounter | None, run_rows: Mapping[str, int]) -> KeywordLatestDoc:
    """``doc`` with its ``counts`` block refreshed for the runs ``run_rows`` (timestamp: rows); without a counter or a readable count, none."""
    counts = None if counter is None else counter.counts(doc['keyword'], (stored or {}).get('counts'), run_rows)
    if counts is not None:
        doc['counts'] = counts
    else:
        doc.pop('counts', None)
    return doc


class KeywordLatestConflict(RuntimeError):
    """Every conditional write lost to a concurrent writer."""


# ---------------------------------------------------------------------------
# Naming and configuration
# ---------------------------------------------------------------------------

def keyword_latest_key(keyword: str) -> str:
    return f'{KEYWORDS_PREFIX}{hashlib.sha256(keyword.encode("utf-8")).hexdigest()[:32]}.json.gz'


def canonical_value(value: Any) -> Any:
    """``value`` with sets sorted and Decimals as numbers, so equal configurations serialize equally."""
    if isinstance(value, Mapping):
        return {str(key): canonical_value(item) for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))}
    if isinstance(value, (set, frozenset)):
        return sorted((canonical_value(item) for item in value), key=str)
    if isinstance(value, (list, tuple)):
        return [canonical_value(item) for item in value]
    if isinstance(value, Decimal):
        return float(value)
    return value


def config_fingerprint(config: PartialConfig) -> str:
    """A digest of what the parts depend on: the brand config (without its timestamps) and the enabled personas."""
    brand = {key: value for key, value in config.brand_config.items() if key not in _BRAND_CONFIG_NOISE}
    text = json.dumps({'brand': canonical_value(brand), 'personas': sorted(config.personas)}, sort_keys=True, default=str)
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:32]


def personas_fingerprint(personas: Iterable[str]) -> str:
    return hashlib.sha256('\n'.join(sorted(set(personas))).encode('utf-8')).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Parts and tallies
# ---------------------------------------------------------------------------

def build_parts(rows: RunRows, config: PartialConfig) -> dict[str, Partial | None]:
    """Every registered partial of one run; a partial that is not written yet or fails is left out (logged)."""
    parts: dict[str, Partial | None] = {}
    for name, module in PARTIALS.items():
        try:
            parts[name] = module.build(rows, config)
        except NotImplementedError:
            logger.info('KeywordLatest: the %s partial is not implemented yet; skipped', name)
        except _PARTIAL_ERRORS:
            logger.exception('KeywordLatest: the %s partial failed; skipped', name)
    return parts


def _previous_parts(parts: Mapping[str, Partial | None]) -> dict[str, Partial | None]:
    """The parts a run keeps once it is the previous one."""
    return {name: part for name, part in parts.items() if name in PARTIALS and PARTIALS[name].PREVIOUS_RUN}


def tally_entry(tally: RunTally, *, brands: bool = True) -> dict[str, Any]:
    """``tally`` as a KeywordLatest stores it: the KeywordRunKpis row layout without the keyword (and the brands when not asked)."""
    entry = {key: value for key, value in tally_item(tally, built_at='').items() if key not in ('keyword', 'built_at')}
    if not brands:
        entry.pop('brands', None)
    return entry


def entry_tally(keyword: str, entry: Mapping[str, Any]) -> RunTally | None:
    """The tally a ``tally_entry`` holds, or ``None`` for a malformed one."""
    return tally_from_item({**entry, 'keyword': keyword})


def latest_tallies(doc: KeywordLatestDoc) -> list[RunTally]:
    """The full tallies of the keyword's latest and previous runs, oldest first."""
    tallies = (entry_tally(doc['keyword'], entry) for _, entry in sorted(doc.get('tallies', {}).items()))
    return [tally for tally in tallies if tally is not None]


def recent_tallies(doc: KeywordLatestDoc) -> list[RunTally]:
    """The base tallies (no brands) of the keyword's runs in the ``RECENT_DAYS`` before its latest run, oldest first."""
    tallies = (entry_tally(doc['keyword'], entry) for entry in doc.get('recent', []))
    return [tally for tally in tallies if tally is not None]


def series_values(tally: RunTally, owned_domains: Sequence[str]) -> list[Any]:
    """One ``series`` row: the run's timestamp and its ``SERIES_KPIS`` (``shared.kpi_tally.tally_kpis``)."""
    kpis = tally_kpis([tally], owned_domains)
    return [tally.timestamp, *(kpis.get(name) for name in SERIES_KPIS)]


# ---------------------------------------------------------------------------
# Folding a run into the object
# ---------------------------------------------------------------------------

def _moment(timestamp: str) -> datetime | None:
    try:
        return datetime.fromisoformat(timestamp)
    except ValueError:
        return None


def empty_doc(keyword: str, keyword_id: str, config: str) -> KeywordLatestDoc:
    return {
        'v': KEYWORD_LATEST_VERSION, 'keyword': keyword, 'keyword_id': keyword_id, 'config': config,
        'latest': None, 'previous': None, 'tallies': {}, 'recent': [], 'series': {'k': list(SERIES_KPIS), 'r': []},
    }


def _place(latest: KeywordLatestRun | None, previous: KeywordLatestRun | None, run: KeywordLatestRun) -> tuple[KeywordLatestRun | None, KeywordLatestRun | None]:
    """The two newest runs once ``run`` is added (a run of the same timestamp replaces it)."""
    stamp = run['timestamp']
    if latest is None or stamp >= latest['timestamp']:
        if latest is not None and stamp > latest['timestamp']:
            previous = {'timestamp': latest['timestamp'], 'parts': _previous_parts(latest['parts'])}
        return run, previous
    if previous is None or stamp >= previous['timestamp']:
        return latest, {'timestamp': stamp, 'parts': _previous_parts(run['parts'])}
    return latest, previous


def _recent_entry(tally: RunTally) -> dict[str, Any]:
    """One ``recent`` entry: the run's base tally (no brands) and its timestamp."""
    return {**tally_entry(tally, brands=False), 'run_timestamp': tally.timestamp}


def _recent(entries: Iterable[Mapping[str, Any]], latest: str | None) -> list[dict[str, Any]]:
    """``entries`` of the ``RECENT_DAYS`` up to ``latest``, oldest first, one per run."""
    by_run = {str(entry['run_timestamp']): dict(entry) for entry in entries}
    newest = _moment(latest) if latest else None
    cutoff = None if newest is None else newest - timedelta(days=RECENT_DAYS)
    kept = [stamp for stamp in by_run if cutoff is None or ((moment := _moment(stamp)) is not None and moment >= cutoff)]
    return [by_run[stamp] for stamp in sorted(kept)]


def _series(series: Mapping[str, Any], row: list[Any]) -> dict[str, Any]:
    rows = {str(existing[0]): existing for existing in series.get('r', []) if series.get('k') == list(SERIES_KPIS)}
    rows[str(row[0])] = row
    return {'k': list(SERIES_KPIS), 'r': [rows[stamp] for stamp in sorted(rows)][-SERIES_RUNS:]}


def fold_run(
    doc: KeywordLatestDoc | None, run: KeywordLatestRun, full: RunTally, *,
    keyword_id: str, config: str, owned_domains: Sequence[str],
) -> KeywordLatestDoc:
    """``doc`` (``None`` for a keyword without one) with ``run`` and its full tally added.

    An object built for another ``config`` keeps only its history: its parts
    describe another brand configuration, so the run starts the two newest
    runs afresh (the backfill's ``latest`` mode rebuilds the previous one).
    """
    keyword = full.keyword
    base = doc if is_keyword_latest(doc) else None
    fresh = empty_doc(keyword, keyword_id or (base or {}).get('keyword_id') or '', config)
    if base is not None:
        fresh['recent'], fresh['series'] = base.get('recent', []), base.get('series', fresh['series'])
        if base.get('config') == config:
            fresh['latest'], fresh['previous'], fresh['tallies'] = base['latest'], base['previous'], dict(base.get('tallies', {}))
    latest, previous = _place(fresh['latest'], fresh['previous'], run)
    tallies = {**fresh['tallies'], full.timestamp: tally_entry(full)}
    fresh['latest'], fresh['previous'] = latest, previous
    kept = [placed['timestamp'] for placed in (latest, previous) if placed is not None]
    fresh['tallies'] = {stamp: tallies[stamp] for stamp in kept if stamp in tallies}
    recent = [*fresh['recent'], _recent_entry(full)]
    fresh['recent'] = _recent(recent, latest['timestamp'] if latest else None)
    fresh['series'] = _series(fresh['series'], series_values(full, owned_domains))
    return fresh


# ---------------------------------------------------------------------------
# S3
# ---------------------------------------------------------------------------

def is_keyword_latest(value: object) -> TypeGuard[KeywordLatestDoc]:
    """Whether ``value`` is a KeywordLatest object of the current format (another format reads as absent)."""
    return (
        isinstance(value, dict) and value.get('v') == KEYWORD_LATEST_VERSION and isinstance(value.get('keyword'), str)
        and isinstance(value.get('tallies'), dict) and isinstance(value.get('recent'), list) and isinstance(value.get('series'), dict)
    )


def read_keyword_latest(s3: Any, bucket: str, keyword: str) -> tuple[KeywordLatestDoc | None, str | None]:
    """The stored object of ``keyword`` and its ETag, or ``(None, None)`` when there is none."""
    try:
        response = s3.get_object(Bucket=bucket, Key=keyword_latest_key(keyword))
    except ClientError as error:
        if is_missing_object(error):
            return None, None
        raise
    doc = decode_json(response['Body'].read())
    return (doc if is_keyword_latest(doc) else None), response.get('ETag')


def update_keyword_latest(s3: Any, bucket: str, keyword: str, update: Callable[[KeywordLatestDoc | None], KeywordLatestDoc]) -> KeywordLatestDoc:
    """Read ``keyword``'s object, apply ``update`` and write it back only over the version read (retried on conflict)."""
    key = keyword_latest_key(keyword)
    for _ in range(WRITE_ATTEMPTS):
        doc, etag = read_keyword_latest(s3, bucket, keyword)
        updated = update(doc)
        condition = {'IfMatch': etag} if etag else {'IfNoneMatch': '*'}
        try:
            s3.put_object(Bucket=bucket, Key=key, Body=encode_json(updated), ContentType='application/gzip', **condition)
        except ClientError as error:
            if is_precondition_failed(error):
                continue
            raise
        return updated
    raise KeywordLatestConflict(f'KeywordLatest of {keyword!r}: {WRITE_ATTEMPTS} conflicting writes')


def record_keyword_latest(
    s3: Any, bucket: str, run_rows: RunRows, full: RunTally, config: PartialConfig, *, keyword_id: str = '',
    counter: KeywordCounter | None = None,
) -> KeywordLatestDoc:
    """Fold one finished run (its SearchResults rows and full tally) into the keyword's object (and its ``counts`` with ``counter``)."""
    run: KeywordLatestRun = {'timestamp': full.timestamp, 'parts': build_parts(run_rows, config)}
    fingerprint = config_fingerprint(config)
    owned = owned_domains_from(config.brand_config)

    def update(doc: KeywordLatestDoc | None) -> KeywordLatestDoc:
        folded = fold_run(doc, run, full, keyword_id=keyword_id, config=fingerprint, owned_domains=owned)
        return with_counts(folded, doc, counter, {full.timestamp: len(run_rows)})

    return update_keyword_latest(s3, bucket, full.keyword, update)


# ---------------------------------------------------------------------------
# Rebuilding an object whole (the backfill's ``latest`` mode)
# ---------------------------------------------------------------------------

def read_full_run_rows(search_table: Any, keyword: str, timestamp: str) -> list[dict[str, Any]]:
    """Every SearchResults row of ``keyword``'s run ``timestamp``, every attribute (the partials read more than an answer)."""
    return collect_all_items(
        search_table.query,
        KeyConditionExpression=Key('keyword').eq(keyword) & Key('timestamp_provider').begins_with(f'{timestamp}#'),
    )


def is_current(doc: KeywordLatestDoc | None, config: str, runs: Sequence[str]) -> bool:
    """Whether ``doc`` was built for ``config`` and holds exactly the runs ``runs`` (newest first) as latest and previous."""
    if doc is None or doc.get('config') != config:
        return False
    held = [placed['timestamp'] for placed in (doc['latest'], doc['previous']) if placed is not None]
    return held == list(runs)


def history_doc(keyword: str, keyword_id: str, config: str, history: Iterable[RunTally], owned_domains: Sequence[str]) -> KeywordLatestDoc:
    """An object without runs whose ``recent`` and ``series`` come from stored per-run tallies (KeywordRunKpis rows)."""
    doc = empty_doc(keyword, keyword_id, config)
    tallies = sorted((tally for tally in history if tally.engines), key=lambda tally: tally.timestamp)
    newest = tallies[-1].timestamp if tallies else None
    doc['recent'] = _recent(map(_recent_entry, tallies), newest)
    doc['series'] = {'k': list(SERIES_KPIS), 'r': [series_values(tally, owned_domains) for tally in tallies][-SERIES_RUNS:]}
    return doc


def _carry_newer_runs(rebuilt: KeywordLatestDoc, stored: KeywordLatestDoc | None, *, owned_domains: Sequence[str]) -> KeywordLatestDoc:
    """``rebuilt`` plus the runs of ``stored`` (same config) newer than its latest: a run written while the rebuild read."""
    if stored is None or stored.get('config') != rebuilt['config']:
        return rebuilt
    newest = rebuilt['latest']['timestamp'] if rebuilt['latest'] else ''
    for placed in (stored['previous'], stored['latest']):
        entry = None if placed is None else stored['tallies'].get(placed['timestamp'])
        full = None if entry is None else entry_tally(rebuilt['keyword'], entry)
        if placed is not None and full is not None and placed['timestamp'] > newest:
            rebuilt = fold_run(rebuilt, placed, full, keyword_id=rebuilt['keyword_id'], config=rebuilt['config'], owned_domains=owned_domains)
    return rebuilt


def rebuild_keyword_latest(
    s3: Any, bucket: str, runs: Sequence[tuple[RunRows, RunTally]], history: Iterable[RunTally], config: PartialConfig,
    *, keyword: str, keyword_id: str = '', counter: KeywordCounter | None = None,
) -> KeywordLatestDoc:
    """Replace ``keyword``'s object with one built from its newest ``runs`` (rows and full tally) over ``history``.

    The parts are rebuilt for ``config``; a run a concurrent workflow wrote
    after the rows were read is kept (the write is conditional, so it is seen).
    """
    fingerprint = config_fingerprint(config)
    owned = owned_domains_from(config.brand_config)
    folded: list[tuple[KeywordLatestRun, RunTally]] = [
        ({'timestamp': full.timestamp, 'parts': build_parts(rows, config)}, full) for rows, full in sorted(runs, key=lambda pair: pair[1].timestamp)
    ]

    def update(stored: KeywordLatestDoc | None) -> KeywordLatestDoc:
        known_id = keyword_id or (stored or {}).get('keyword_id') or ''
        doc = history_doc(keyword, known_id, fingerprint, history, owned)
        for run, full in folded:
            doc = fold_run(doc, run, full, keyword_id=known_id, config=fingerprint, owned_domains=owned)
        return with_counts(_carry_newer_runs(doc, stored, owned_domains=owned), stored, counter, run_rows)

    run_rows = {full.timestamp: len(rows) for rows, full in runs}

    return update_keyword_latest(s3, bucket, keyword, update)


__all__ = [
    'KEYWORDS_PREFIX',
    'KEYWORD_LATEST_VERSION',
    'RECENT_DAYS',
    'SERIES_KPIS',
    'SERIES_RUNS',
    'KeywordLatestConflict',
    'KeywordLatestDoc',
    'build_parts',
    'canonical_value',
    'config_fingerprint',
    'empty_doc',
    'entry_tally',
    'fold_run',
    'history_doc',
    'is_current',
    'is_keyword_latest',
    'keyword_latest_key',
    'latest_tallies',
    'personas_fingerprint',
    'read_full_run_rows',
    'read_keyword_latest',
    'rebuild_keyword_latest',
    'recent_tallies',
    'record_keyword_latest',
    'series_values',
    'tally_entry',
    'update_keyword_latest',
    'with_counts',
]
