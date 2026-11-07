"""DataForSEO Backlinks API items -> the API's JSON rows (``web/src/types/api/seoBacklinks.ts``).

Every field is nullable: DataForSEO omits or nulls fields freely, and an unknown value must stay distinguishable
from zero (a spam score of 0 is "clean", a missing one is "unknown"). Numbers that arrive as booleans or text are
treated as missing.

DataForSEO sends some ``*_referring_*`` fields under the misspelled ``*_reffering_*`` name, alongside or instead of
the correct one; every such field reads the correct spelling first, then the misspelled one.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def number(value: object) -> int | float | None:
    """``value`` when it is a real number (never a bool), else ``None``."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return value


def text(value: object) -> str | None:
    """A non-empty string, else ``None``."""
    if not isinstance(value, str):
        return None
    return value or None


def flag(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def referring(item: Mapping[str, Any], field: str) -> int | float | None:
    """``item[field]``, or its misspelled ``reffering`` twin when the correct one is absent or null."""
    correct = number(item.get(field))
    if correct is not None:
        return correct
    return number(item.get(field.replace('referring', 'reffering')))


def day(value: object) -> str | None:
    """The ``YYYY-MM-DD`` of a DataForSEO timestamp (``2026-09-01 00:00:00 +00:00``)."""
    stamp = text(value)
    return stamp[:10] if stamp and len(stamp) >= 10 else None


SUMMARY_FIELDS = (
    'rank', 'backlinks', 'referring_domains', 'referring_pages', 'broken_backlinks', 'broken_pages',
    'backlinks_spam_score', 'new_backlinks', 'lost_backlinks', 'new_referring_domains', 'lost_referring_domains',
)


def summary_row(item: object) -> dict[str, Any] | None:
    """The overview metrics of ``summary/live``'s ``result[0]``; ``None`` for ``[]`` / ``[null]`` (no data)."""
    if not isinstance(item, Mapping):
        return None
    info = item.get('info')
    target_spam = number(info.get('target_spam_score')) if isinstance(info, Mapping) else None
    row: dict[str, Any] = {field: referring(item, field) for field in SUMMARY_FIELDS}
    row['target_spam_score'] = target_spam
    return row


def history_rows(items: list[Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """``(trends, new_lost)`` of ``history/live`` items, oldest first; items without a date are dropped."""
    dated = sorted(
        ((stamp, item) for item in items if isinstance(item, Mapping) and (stamp := day(item.get('date')))),
        key=lambda pair: pair[0],
    )
    trends = [{
        'date': stamp,
        'backlinks': number(item.get('backlinks')),
        'referring_domains': referring(item, 'referring_domains'),
        'rank': number(item.get('rank')),
    } for stamp, item in dated]
    new_lost = [{
        'date': stamp,
        'new_backlinks': number(item.get('new_backlinks')),
        'lost_backlinks': number(item.get('lost_backlinks')),
        'new_referring_domains': referring(item, 'new_referring_domains'),
        'lost_referring_domains': referring(item, 'lost_referring_domains'),
    } for stamp, item in dated]
    return trends, new_lost


def _rel_attributes(item: Mapping[str, Any]) -> list[str]:
    for field in ('rel_attributes', 'attributes'):
        value = item.get(field)
        if isinstance(value, list):
            return [entry for entry in value if isinstance(entry, str)]
    return []


def _links_count(item: Mapping[str, Any]) -> int | None:
    value = number(item.get('links_count'))
    return int(value) if value is not None else None


def backlink_row(item: Mapping[str, Any]) -> dict[str, Any]:
    """One link. ``last_seen`` is when the link was lost, else last seen or visited: never the time it vanished."""
    lost_date = text(item.get('lost_date'))
    spam = number(item.get('backlink_spam_score'))
    is_lost = flag(item.get('is_lost'))
    return {
        'domain_from': text(item.get('domain_from')),
        'url_from': text(item.get('url_from')),
        'url_to': text(item.get('url_to')),
        'anchor': text(item.get('anchor')),
        'item_type': text(item.get('item_type')),
        'dofollow': flag(item.get('dofollow')),
        'rel_attributes': _rel_attributes(item),
        'rank': number(item.get('rank')),
        'domain_from_rank': number(item.get('domain_from_rank')),
        'page_from_rank': number(item.get('page_from_rank')),
        'spam_score': spam if spam is not None else number(item.get('backlinks_spam_score')),
        'first_seen': text(item.get('first_seen')),
        'last_seen': lost_date or text(item.get('last_seen')) or text(item.get('last_visited')),
        'is_lost': is_lost if is_lost is not None else lost_date is not None,
        'is_broken': flag(item.get('is_broken')) or False,
        'links_count': _links_count(item),
    }


def referring_domain_row(item: Mapping[str, Any]) -> dict[str, Any]:
    """One referring domain; its spam score is that of its links (``backlinks_spam_score``), never the target's."""
    return {
        'domain': text(item.get('domain')),
        'backlinks': number(item.get('backlinks')),
        'referring_pages': referring(item, 'referring_pages'),
        'rank': number(item.get('rank')),
        'spam_score': number(item.get('backlinks_spam_score')),
        'first_seen': text(item.get('first_seen')),
        'broken_backlinks': number(item.get('broken_backlinks')),
        'broken_pages': number(item.get('broken_pages')),
    }


def top_page_row(item: Mapping[str, Any]) -> dict[str, Any]:
    return {
        'page': text(item.get('page')) or text(item.get('url')),
        'rank': number(item.get('rank')),
        'broken_backlinks': number(item.get('broken_backlinks')),
        'backlinks': number(item.get('backlinks')),
        'referring_domains': referring(item, 'referring_domains'),
    }
