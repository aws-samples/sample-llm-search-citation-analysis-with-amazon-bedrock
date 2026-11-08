"""
Storage of site audits: table ``CitationAnalysis-SeoAudits`` (env ``DYNAMODB_TABLE_SEO_AUDITS``) and the
robots.txt copy in the SEO bucket (``SEO_BUCKET``).

One table, keys ``pk`` / ``sk``, a sparse index ``GSI1`` (``gsi1pk`` / ``gsi1sk``) and TTL ``ttl``. Only the
frontier URLs (crawl bookkeeping) expire, 90 days after they are queued; the audit, its pages, issues and link
summary are kept like every other crawl (TENETS.md, D2 and D5):

| item | pk | sk | GSI1 |
|---|---|---|---|
| audit | ``AUDIT#<id>`` | ``META`` | ``AUDITS`` / ``<started_at>#<id>`` (newest first) |
| frontier URL | ``AUDIT#<id>#URL`` | url hash | ``AUDIT#<id>#PENDING`` / ``<0 link, 1 sitemap>#<seq>`` while pending, ``AUDIT#<id>#LEASED#<chunk>`` while leased |
| page | ``AUDIT#<id>#PAGE`` | url hash | - |
| issue | ``AUDIT#<id>#ISSUE`` | ``<issue_type>#<issue id>`` | - |
| link graph summary | ``AUDIT#<id>`` | ``LINKS`` | - |

Claims are idempotent per chunk: a retried crawl step first gets back the URLs it had already leased. Links
are claimed before sitemap-only URLs, each in discovery order. Page HTML is never stored; robots.txt (up to
500 KiB, over DynamoDB's item limit) is kept at ``seo/site-audit/<id>/robots.txt``.
"""

from __future__ import annotations

import base64
import json
import os
import time
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from functools import cache
from typing import Any, Literal

import boto3
from boto3.dynamodb.conditions import Attr, Key

from shared.audit_issues import Issue
from shared.audit_urls import url_hash
from shared.bounded_reads import newest_items
from shared.dynamodb_batch import batch_get_items, collect_all_items
from shared.dynamodb_conditions import applied_conditionally
from shared.env_vars import resolve_table_env

AUDITS_TABLE_ENV = 'DYNAMODB_TABLE_SEO_AUDITS'
BUCKET_ENV = 'SEO_BUCKET'
TTL_SECONDS = 90 * 86_400
AUDIT_INDEX = 'GSI1'
AUDITS_LIST_KEY = 'AUDITS'
META = 'META'
LINKS = 'LINKS'
_BATCH_GET_SIZE = 100

Source = Literal['link', 'sitemap']
Item = dict[str, Any]
#: One page of items and the token of the next page (``None`` on the last page).
Batch = tuple[list[Item], str | None]


@dataclass(frozen=True)
class FrontierEntry:
    url: str
    depth: int | None
    source: Source
    in_sitemap: bool


def audit_pk(audit_id: str) -> str:
    return f'AUDIT#{audit_id}'


def _expires() -> int:
    return int(time.time()) + TTL_SECONDS


def encode_token(key: dict[str, Any] | None) -> str | None:
    """An opaque paging token for a ``LastEvaluatedKey``."""
    if not key:
        return None
    return base64.urlsafe_b64encode(json.dumps(key, sort_keys=True, default=str).encode()).decode()


def decode_token(token: str | None, partition: str) -> dict[str, Any] | None:
    """The ``ExclusiveStartKey`` of ``token``; ``None`` when absent or not a key of ``partition``."""
    if not token:
        return None
    try:
        key = json.loads(base64.urlsafe_b64decode(token.encode()))
    except (ValueError, UnicodeError):
        return None
    if not isinstance(key, dict) or key.get('pk') != partition or not isinstance(key.get('sk'), str):
        return None
    return {'pk': key['pk'], 'sk': key['sk']}


@cache
def _table() -> Any:
    return boto3.resource('dynamodb').Table(resolve_table_env(AUDITS_TABLE_ENV))


def _entry(item: dict[str, Any]) -> FrontierEntry:
    depth = item.get('depth')
    return FrontierEntry(
        url=str(item['url']),
        depth=int(depth) if depth is not None else None,
        source='link' if item.get('source') == 'link' else 'sitemap',
        in_sitemap=bool(item.get('in_sitemap')),
    )


def issue_item(issue: Issue) -> Item:
    """The stored attributes of an issue (besides its keys)."""
    return {
        'issue_type': issue.issue_type, 'page_url': issue.page_url, 'details': issue.details,
        'severity': issue.descriptor.severity, 'group': issue.descriptor.group,
    }


class AuditStore:
    """DynamoDB storage of audits; one instance per invocation (tests pass a table and resource stub)."""

    def __init__(self, table: Any | None = None, resource: Any | None = None) -> None:
        self.table = table if table is not None else _table()
        self.resource = resource if resource is not None else boto3.resource('dynamodb')

    # -- audits ----------------------------------------------------------------
    def create_audit(self, audit: dict[str, Any]) -> None:
        audit_id = audit['audit_id']
        item = {
            **audit, 'pk': audit_pk(audit_id), 'sk': META, 'gsi1pk': AUDITS_LIST_KEY,
            'gsi1sk': f"{audit['started_at']}#{audit_id}", 'seq': 0,
        }
        self.table.put_item(Item=item, ConditionExpression=Attr('pk').not_exists())

    def get_audit(self, audit_id: str) -> dict[str, Any] | None:
        return self.table.get_item(Key={'pk': audit_pk(audit_id), 'sk': META}, ConsistentRead=True).get('Item')

    def update_audit(self, audit_id: str, changes: dict[str, Any], *, only_if_status: tuple[str, ...] = ()) -> bool:
        """Set ``changes`` on the audit; with ``only_if_status`` only while its status is one of them."""
        names = {f'#f{index}': name for index, name in enumerate(changes)}
        values = {f':v{index}': value for index, value in enumerate(changes.values())}
        params: dict[str, Any] = {
            'Key': {'pk': audit_pk(audit_id), 'sk': META},
            'UpdateExpression': 'SET ' + ', '.join(f'#f{index} = :v{index}' for index in range(len(changes))),
            'ExpressionAttributeNames': names,
            'ExpressionAttributeValues': values,
        }
        if only_if_status:
            params['ConditionExpression'] = Attr('status').is_in(list(only_if_status))
        return applied_conditionally(lambda: self.table.update_item(**params))

    def list_audits(self, limit: int) -> list[dict[str, Any]]:
        return newest_items(self.table, 'gsi1pk', AUDITS_LIST_KEY, limit, index_name=AUDIT_INDEX)

    def _next_seq(self, audit_id: str, count: int) -> int:
        response = self.table.update_item(
            Key={'pk': audit_pk(audit_id), 'sk': META}, UpdateExpression='ADD seq :n',
            ExpressionAttributeValues={':n': count}, ReturnValues='UPDATED_NEW',
        )
        return int(response['Attributes']['seq']) - count

    # -- frontier ----------------------------------------------------------------
    def _existing(self, audit_id: str, hashes: list[str]) -> dict[str, dict[str, Any]]:
        partition = f'{audit_pk(audit_id)}#URL'
        found: dict[str, dict[str, Any]] = {}
        for start in range(0, len(hashes), _BATCH_GET_SIZE):
            keys = [{'pk': partition, 'sk': value} for value in hashes[start:start + _BATCH_GET_SIZE]]
            for item in batch_get_items(self.resource, self.table.name, keys):
                found[str(item['sk'])] = item
        return found

    def add_frontier(self, audit_id: str, entries: Iterable[FrontierEntry], limit: int) -> int:
        """Queue the URLs not seen yet (at most ``limit`` new ones); returns how many were added.

        A URL first found in a sitemap and later through a link takes the link's depth and is claimed as a link.
        """
        unique = {url_hash(entry.url): entry for entry in reversed(list(entries))}
        existing = self._existing(audit_id, list(unique))
        partition = f'{audit_pk(audit_id)}#URL'
        for key, item in existing.items():
            self._merge(audit_id, item, unique[key])
        fresh = [(key, entry) for key, entry in unique.items() if key not in existing][:max(0, limit)]
        if not fresh:
            return 0
        first_seq = self._next_seq(audit_id, len(fresh))
        with self.table.batch_writer() as writer:
            for offset, (key, entry) in enumerate(fresh):
                priority = 0 if entry.source == 'link' else 1
                writer.put_item(Item={
                    'pk': partition, 'sk': key, 'url': entry.url, 'depth': entry.depth, 'source': entry.source,
                    'in_sitemap': entry.in_sitemap, 'state': 'pending', 'seq': first_seq + offset,
                    'gsi1pk': f'{audit_pk(audit_id)}#PENDING', 'gsi1sk': f'{priority}#{first_seq + offset:09d}',
                    'ttl': _expires(),
                })
        return len(fresh)

    def _merge(self, audit_id: str, item: dict[str, Any], entry: FrontierEntry) -> None:
        key = {'pk': item['pk'], 'sk': item['sk']}
        if entry.in_sitemap and not item.get('in_sitemap'):
            self.table.update_item(Key=key, UpdateExpression='SET in_sitemap = :t', ExpressionAttributeValues={':t': True})
        if entry.source == 'link' and item.get('source') == 'sitemap' and item.get('state') == 'pending':
            self.table.update_item(
                Key=key, UpdateExpression='SET #src = :link, depth = :depth, gsi1sk = :sort',
                ExpressionAttributeNames={'#src': 'source'},
                ExpressionAttributeValues={
                    ':link': 'link', ':depth': entry.depth, ':sort': f"0#{int(item.get('seq', 0)):09d}",
                },
            )

    def claim(self, audit_id: str, chunk_no: int, limit: int) -> list[FrontierEntry]:
        """The URLs of crawl chunk ``chunk_no``: those it already leased, else up to ``limit`` pending ones."""
        leased_key = f'{audit_pk(audit_id)}#LEASED#{chunk_no}'
        leased = collect_all_items(self.table.query, IndexName=AUDIT_INDEX, KeyConditionExpression=Key('gsi1pk').eq(leased_key))
        if leased:
            return [_entry(item) for item in leased]
        if limit <= 0:
            return []
        pending = self.table.query(
            IndexName=AUDIT_INDEX, KeyConditionExpression=Key('gsi1pk').eq(f'{audit_pk(audit_id)}#PENDING'), Limit=limit,
        ).get('Items', [])
        return [_entry(item) for item in pending if self._lease(item, leased_key, chunk_no)]

    def _lease(self, item: dict[str, Any], leased_key: str, chunk_no: int) -> bool:
        """Move a pending URL to chunk ``chunk_no``; ``False`` when another step leased it first."""
        return applied_conditionally(lambda: self.table.update_item(
            Key={'pk': item['pk'], 'sk': item['sk']},
            UpdateExpression='SET #state = :leased, gsi1pk = :key, chunk_no = :chunk',
            ConditionExpression=Attr('state').eq('pending'),
            ExpressionAttributeNames={'#state': 'state'},
            ExpressionAttributeValues={':leased': 'leased', ':key': leased_key, ':chunk': chunk_no},
        ))

    def has_pending(self, audit_id: str) -> bool:
        response = self.table.query(
            IndexName=AUDIT_INDEX, KeyConditionExpression=Key('gsi1pk').eq(f'{audit_pk(audit_id)}#PENDING'), Limit=1,
        )
        return bool(response.get('Items'))

    def mark_crawled(self, audit_id: str, url: str) -> None:
        self.table.update_item(
            Key={'pk': f'{audit_pk(audit_id)}#URL', 'sk': url_hash(url)},
            UpdateExpression='SET #state = :crawled REMOVE gsi1pk, gsi1sk',
            ExpressionAttributeNames={'#state': 'state'}, ExpressionAttributeValues={':crawled': 'crawled'},
        )

    # -- pages and issues --------------------------------------------------------
    def put_page(self, audit_id: str, page: Item) -> None:
        self.table.put_item(Item={
            **page, 'pk': f'{audit_pk(audit_id)}#PAGE', 'sk': url_hash(page['url']),
        })

    def page(self, audit_id: str, url: str) -> Item | None:
        return self.table.get_item(Key={'pk': f'{audit_pk(audit_id)}#PAGE', 'sk': url_hash(url)}).get('Item')

    def pages(self, audit_id: str) -> list[Item]:
        return collect_all_items(self.table.query, KeyConditionExpression=Key('pk').eq(f'{audit_pk(audit_id)}#PAGE'))

    def _query_batch(self, partition: str, token: str | None, params: dict[str, Any]) -> Batch:
        start = decode_token(token, partition)
        response = self.table.query(**params, **({'ExclusiveStartKey': start} if start else {}))
        return list(response.get('Items', [])), encode_token(response.get('LastEvaluatedKey'))

    def page_batch(self, audit_id: str, limit: int, token: str | None) -> Batch:
        partition = f'{audit_pk(audit_id)}#PAGE'
        return self._query_batch(partition, token, {'KeyConditionExpression': Key('pk').eq(partition), 'Limit': limit})

    def put_issues(self, audit_id: str, issues: Iterable[Issue]) -> None:
        partition = f'{audit_pk(audit_id)}#ISSUE'
        with self.table.batch_writer(overwrite_by_pkeys=['pk', 'sk']) as writer:
            for issue in issues:
                writer.put_item(Item={
                    **issue_item(issue), 'pk': partition, 'sk': f'{issue.issue_type}#{issue.issue_id(audit_id)}',
                })

    def issues(self, audit_id: str) -> Iterator[Item]:
        yield from collect_all_items(self.table.query, KeyConditionExpression=Key('pk').eq(f'{audit_pk(audit_id)}#ISSUE'))

    def issues_of_type(self, audit_id: str, issue_type: str, limit: int, token: str | None) -> Batch:
        partition = f'{audit_pk(audit_id)}#ISSUE'
        condition = Key('pk').eq(partition) & Key('sk').begins_with(f'{issue_type}#')
        return self._query_batch(partition, token, {'KeyConditionExpression': condition, 'Limit': limit})

    def put_link_summary(self, audit_id: str, summary: Item) -> None:
        self.table.put_item(Item={**summary, 'pk': audit_pk(audit_id), 'sk': LINKS})


def _bucket() -> str:
    return os.environ[BUCKET_ENV]


def robots_key(audit_id: str) -> str:
    return f'seo/site-audit/{audit_id}/robots.txt'


def save_robots(audit_id: str, status: int, text: str) -> None:
    """Keep the robots.txt body the crawl and the AI-readiness checks evaluate."""
    boto3.client('s3').put_object(
        Bucket=_bucket(), Key=robots_key(audit_id), Body=text.encode('utf-8'),
        ContentType='text/plain; charset=utf-8', Metadata={'status': str(status)},
    )


def load_robots(audit_id: str) -> tuple[int, str]:
    response = boto3.client('s3').get_object(Bucket=_bucket(), Key=robots_key(audit_id))
    status = int(response.get('Metadata', {}).get('status', '0') or 0)
    return status, response['Body'].read().decode('utf-8', errors='replace')
