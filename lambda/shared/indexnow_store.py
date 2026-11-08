"""IndexNow keys and submission history, as dedicated items of ``CitationAnalysis-SeoCache`` that never expire.

* ``indexnow-key#<domain>``: ``{domain, key, created_at, created_by}``, one per owned domain (its subdomains
  share it). The key is 32 lower-case hex characters. It is not a secret: it is published at
  ``https://<host>/<key>.txt`` for the engines to verify ownership. Creation is race-safe (a conditional put;
  the loser reads the winner's key).
* ``indexnow-history``: ``{submissions: [...]}``, the ``HISTORY_LIMIT`` newest submissions, newest first.

These items carry no ``ttl`` attribute, so the table's expiry never removes them.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from functools import cache
from typing import Any

import boto3

from shared.dynamodb_conditions import applied_conditionally
from shared.env_vars import resolve_table_env
from shared.utils import get_timestamp

CACHE_TABLE_ENV = 'DYNAMODB_TABLE_SEO_CACHE'
HISTORY_KEY = 'indexnow-history'
HISTORY_LIMIT = 20


class KeyNotStoredError(LookupError):
    """The key write lost a race, yet no key is stored for the domain."""


@cache
def _table() -> Any:
    return boto3.resource('dynamodb').Table(resolve_table_env(CACHE_TABLE_ENV))


def key_item_key(domain: str) -> str:
    return f'indexnow-key#{domain}'


def new_key() -> str:
    """32 random lower-case hex characters (IndexNow accepts 8 to 128 of ``[a-zA-Z0-9-]``)."""
    return uuid.uuid4().hex


def site_key(domain: str) -> str | None:
    item = _table().get_item(Key={'cache_key': key_item_key(domain)}, ConsistentRead=True).get('Item') or {}
    key = item.get('key')
    return key if isinstance(key, str) else None


def site_keys(domains: list[str]) -> dict[str, str]:
    """The key of each domain that has one."""
    found = {domain: site_key(domain) for domain in domains}
    return {domain: key for domain, key in found.items() if key}


def ensure_key(domain: str, created_by: str) -> tuple[str, bool]:
    """``(key, created)``: the domain's key, created when it has none."""
    existing = site_key(domain)
    if existing:
        return existing, False
    item = {
        'cache_key': key_item_key(domain), 'domain': domain, 'key': new_key(),
        'created_at': get_timestamp(), 'created_by': created_by,
    }
    if applied_conditionally(lambda: _table().put_item(Item=item, ConditionExpression='attribute_not_exists(cache_key)')):
        return item['key'], True
    # A concurrent first use stored its key first: that one is the domain's key.
    winner = site_key(domain)
    if winner is None:
        raise KeyNotStoredError(domain)
    return winner, False


def history() -> list[dict[str, Any]]:
    item = _table().get_item(Key={'cache_key': HISTORY_KEY}).get('Item') or {}
    entries = item.get('submissions')
    return [entry for entry in entries if isinstance(entry, dict)] if isinstance(entries, list) else []


def record_submission(submission: Mapping[str, Any]) -> None:
    """Put ``submission`` first in the history, keeping the ``HISTORY_LIMIT`` newest."""
    entries = [dict(submission), *history()][:HISTORY_LIMIT]
    _table().put_item(Item={'cache_key': HISTORY_KEY, 'submissions': entries})
