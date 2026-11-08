"""Fixtures of the Domain Overview, domain snapshots and SEO vs GEO traffic suites.

Fictional domains only: you are ``example.com``, the competitor "Acme" is ``acme.example.org``.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from decimal import Decimal
from operator import itemgetter
from typing import Any
from unittest.mock import MagicMock

from shared.dataforseo_domain import DomainOverview, RankedKeyword

SNAPSHOT_AT = '2026-10-05T04:00:00Z'
OLDER_SNAPSHOT_AT = '2026-09-28T04:00:00Z'
SNAPSHOT_ENV: Mapping[str, str] = {'DYNAMODB_TABLE_SEO_DOMAIN_SNAPSHOTS': 'test-seo-domain-snapshots'}


def ranked_item(
    keyword: str = 'cheap flights', *, rank_absolute: int | None = 4, rank_group: int | None = 3,
    etv: float | None = 120.5, url: str | None = 'https://www.example.com/flights?x=1', volume: int | None = 2400,
    search_intent_info: object = None,
) -> dict[str, Any]:
    """One ``ranked_keywords`` item as DataForSEO Labs answers it (``search_intent_info`` defaults to commercial)."""
    return {
        'keyword_data': {
            'keyword': keyword,
            'keyword_info': {'search_volume': volume, 'cpc': 1.25},
            'keyword_properties': {'keyword_difficulty': 37.4},
            'search_intent_info': {'main_intent': 'commercial'} if search_intent_info is None else search_intent_info,
        },
        'ranked_serp_element': {
            'serp_item': {
                'url': url, 'relative_url': None, 'rank_absolute': rank_absolute, 'rank_group': rank_group,
                'etv': etv, 'domain': 'www.example.com',
            },
        },
    }


def overview_item(count: int = 1520, etv: float = 8450.6, cost: float = 12034.567) -> dict[str, Any]:
    """One ``domain_rank_overview`` item."""
    return {'metrics': {'organic': {
        'count': count, 'etv': etv, 'estimated_paid_traffic_cost': cost, 'pos_1': 10, 'pos_2_3': 20, 'pos_4_10': 70,
        'pos_11_20': 100, 'pos_21_30': 50, 'pos_31_40': 40, 'pos_41_50': 30, 'pos_51_60': 1, 'pos_91_100': 2,
    }}}


def overview(count: int | None = 1520, traffic: int | None = 8451) -> DomainOverview:
    return DomainOverview(organic_keywords=count, estimated_traffic=traffic, traffic_cost=12034.57,
                          position_buckets=(('1', 10), ('2-3', 20)), cost_usd=0.01212)


def ranked_keyword(keyword: str = 'cheap flights', position: int | None = 3, etv: float | None = 120.5) -> RankedKeyword:
    return RankedKeyword(keyword=keyword, position=position, organic_position=position, search_volume=2400, etv=etv,
                         cpc=1.25, keyword_difficulty=37, url='https://example.com/flights', relative_url='/flights',
                         intent='commercial')


def _snapshot_query(items: list[dict[str, Any]]) -> MagicMock:
    """A ``Table.query`` over ``items``: the pk condition, ``ScanIndexForward`` and ``Limit``."""
    def answer(**params: Any) -> dict[str, Any]:
        pk = params['KeyConditionExpression'].get_expression()['values'][1]
        newest_first = sorted((item for item in items if item['pk'] == pk), key=itemgetter('snapshot_at'), reverse=True)
        ordered = newest_first if params.get('ScanIndexForward') is False else newest_first[::-1]
        return {'Items': ordered[:params.get('Limit', len(ordered))]}

    return MagicMock(side_effect=answer)


class FakeSnapshots:
    """``CitationAnalysis-SeoDomainSnapshots`` over ``items``; ``put_item`` appends."""

    def __init__(self, items: Sequence[Mapping[str, Any]] = ()) -> None:
        self.items: list[dict[str, Any]] = [dict(item) for item in items]
        self.put_item = MagicMock(side_effect=lambda Item: self.items.append(dict(Item)))
        self.query = _snapshot_query(self.items)


class FakeS3:
    """An S3 client over ``objects`` (key -> JSON-able payload)."""

    def __init__(self, objects: Mapping[str, Any] | None = None) -> None:
        self.objects: dict[str, bytes] = {key: json.dumps(value).encode() for key, value in (objects or {}).items()}
        self.put_object = MagicMock(side_effect=self._put)
        self.get_object = MagicMock(side_effect=self._get)

    def _put(self, *, Bucket: str, Key: str, Body: bytes, **_extra: Any) -> dict[str, Any]:
        self.objects[Key] = Body
        return {}

    def _get(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        body = MagicMock()
        body.read.return_value = self.objects[Key]
        return {'Body': body}

    def payload(self, key: str) -> Any:
        return json.loads(self.objects[key])


def stored_snapshot(
    domain: str = 'example.com', market_id: str = 'global', snapshot_at: str = SNAPSHOT_AT, *,
    organic_keywords: int = 1520, keywords_stored: int = 1,
) -> dict[str, Any]:
    """A snapshot item as DynamoDB returns it."""
    return {
        'pk': f'{domain}#{market_id}', 'snapshot_at': snapshot_at, 'domain': domain, 'market_id': market_id,
        'source': 'dataforseo_labs', 'organic_keywords': Decimal(organic_keywords), 'estimated_traffic': Decimal(8451),
        'traffic_cost': Decimal('12034.57'), 'position_buckets': {'1': Decimal(10), '2-3': Decimal(20)},
        'keywords_stored': Decimal(keywords_stored),
        'keywords_s3_key': f'seo/domain-snapshots/{domain}/{market_id}/{snapshot_at}.json',
    }


def snapshot_object(*keywords: tuple[str, int | None, float | None]) -> dict[str, Any]:
    """The S3 payload of a snapshot with ``(keyword, position, etv)`` entries."""
    return {'keywords': [
        {'keyword': keyword, 'position': position, 'etv': etv, 'url': None, 'search_volume': None}
        for keyword, position, etv in keywords
    ]}
