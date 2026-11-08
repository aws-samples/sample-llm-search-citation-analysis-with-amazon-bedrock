"""DataForSEO Backlinks API items and table doubles shared by the backlinks suites (fictional domains only)."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

SUMMARY_ITEM: dict[str, Any] = {
    'target': 'example.com', 'info': {'target_spam_score': 3}, 'lost_reffering_domains': 5,
    'new_reffering_domains': 12, 'lost_backlinks': 80, 'new_backlinks': 120, 'backlinks_spam_score': 7,
    'broken_pages': 4, 'broken_backlinks': 25, 'referring_pages': 9_100, 'referring_domains': 380,
    'backlinks': 12_400, 'rank': 41,
}
"""A summary with the new / lost referring domains under DataForSEO's misspelled names only."""

SUMMARY_ROW: dict[str, Any] = {
    'rank': 41, 'backlinks': 12_400, 'referring_domains': 380, 'referring_pages': 9_100, 'broken_backlinks': 25,
    'broken_pages': 4, 'backlinks_spam_score': 7, 'new_backlinks': 120, 'lost_backlinks': 80,
    'new_referring_domains': 12, 'lost_referring_domains': 5, 'target_spam_score': 3,
}

BACKLINK_ITEM: dict[str, Any] = {
    'domain_from': 'blog.example.org',
    'url_from': 'https://blog.example.org/review',
    'url_to': 'https://example.com/pricing',
    'anchor': 'Example pricing',
    'item_type': 'anchor',
    'dofollow': True,
    'attributes': ['noopener'],
    'rank': 22,
    'domain_from_rank': 55,
    'page_from_rank': 18,
    'backlink_spam_score': 0,
    'first_seen': '2026-08-01 10:00:00 +00:00',
    'last_seen': '2026-09-30 10:00:00 +00:00',
    'is_broken': False,
    'links_count': 2,
}

REFERRING_DOMAIN_ITEM: dict[str, Any] = {
    'domain': 'blog.example.org', 'backlinks': 14, 'referring_pages': 9, 'rank': 55, 'backlinks_spam_score': 12,
    'target_spam_score': 90, 'first_seen': '2025-02-01 00:00:00 +00:00', 'broken_backlinks': 1, 'broken_pages': 0,
}

TOP_PAGE_ITEM: dict[str, Any] = {
    'url': 'https://example.com/pricing', 'backlinks': 300, 'reffering_domains': 41, 'rank': 30, 'broken_backlinks': 2,
}

HISTORY_ITEMS: list[dict[str, Any]] = [
    {'date': '2026-09-01 00:00:00 +00:00', 'backlinks': 12_000, 'referring_domains': 370, 'rank': 40,
     'new_backlinks': 100, 'lost_backlinks': 70, 'new_referring_domains': 10, 'lost_referring_domains': 4},
    {'date': '2026-08-01 00:00:00 +00:00', 'backlinks': 11_500, 'referring_domains': 360, 'rank': 39,
     'new_backlinks': 90, 'lost_backlinks': 60, 'new_reffering_domains': 8, 'lost_reffering_domains': 3},
    {'backlinks': 1},
]
"""Newest first and one undated item, as the mapping must cope with both."""


@dataclass
class FakeSnapshotsTable:
    """``CitationAnalysis-SeoBacklinkSnapshots``: ``put_item`` / ``get_item`` / newest-first ``query`` in memory."""

    items: list[dict[str, Any]] = field(default_factory=list)
    queries: list[Mapping[str, Any]] = field(default_factory=list)

    def put_item(self, Item: dict[str, Any]) -> None:
        self.items = [item for item in self.items
                      if (item['domain'], item['snapshot_at']) != (Item['domain'], Item['snapshot_at'])]
        self.items.append(Item)

    def get_item(self, Key: Mapping[str, str]) -> dict[str, Any]:
        for item in self.items:
            if item['domain'] == Key['domain'] and item['snapshot_at'] == Key['snapshot_at']:
                return {'Item': item}
        return {}

    def query(self, **request: Any) -> dict[str, Any]:
        self.queries.append(request)
        domain = request['KeyConditionExpression'].get_expression()['values'][1]
        matching = sorted((item for item in self.items if item['domain'] == domain),
                          key=lambda item: item['snapshot_at'], reverse=not request.get('ScanIndexForward', True))
        return {'Items': matching[:request.get('Limit', len(matching))]}
