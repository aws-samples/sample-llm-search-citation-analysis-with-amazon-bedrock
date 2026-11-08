"""DataForSEO endpoint test doubles: market codes, task results, wire items and a recording ``post_live``.

Tests of ``shared.dataforseo_keywords`` / ``shared.dataforseo_serp`` and the Google AI Overviews client
(``search/google_ai_overview.py``) patch ``shared.dataforseo_client.post_live`` (and ``escape_keyword``) with these, so they never depend on
the client's real transport or status ladder. Domains are fictional (``example.com`` family).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import patch

import pytest

from shared import dataforseo_client
from shared.dataforseo_client import DataForSeoError, TaskResult
from shared.dataforseo_locations import MarketCodes

LABS_US = MarketCodes(location_code=2840, language_code='en', keyword_data='labs')
ADS_IS = MarketCodes(location_code=2352, language_code='is', keyword_data='google_ads')


def task_result(
    result: list[Any] | None = None, *, cost: float = 0.01, no_results: bool = False, task_id: str = 'task-1',
) -> TaskResult:
    """A successful ``post_live`` return value."""
    rows = result or []
    return TaskResult(
        task={'id': task_id, 'status_code': 20000, 'cost': cost, 'result': rows},
        result=rows,
        cost_usd=cost,
        no_results=no_results,
    )


def labs_task(items: list[Any], *, cost: float = 0.02) -> TaskResult:
    """A Labs response: items under ``result[0].items``."""
    return task_result([{'items': items, 'total_count': len(items)}], cost=cost)


def dataforseo_error(code: str, provider_status: int | None, *, cost: float | None = None) -> DataForSeoError:
    """A ``DataForSeoError`` as the client raises it."""
    return DataForSeoError(code, f'DataForSEO failed ({provider_status})', cost_usd=cost,
                           provider_status=provider_status)


def labs_item(keyword: str, volume: int | None = 1000, **overrides: Any) -> dict[str, Any]:
    """A Labs keyword item (suggestions / ideas / overview shape)."""
    item: dict[str, Any] = {
        'keyword': keyword,
        'keyword_info': {
            'search_volume': volume,
            'cpc': 1.5,
            'competition': 0.4,
            'competition_level': 'MEDIUM',
            'monthly_searches': [{'year': 2026, 'month': 7, 'search_volume': volume}],
        },
        'keyword_properties': {'keyword_difficulty': 20},
        'search_intent_info': {'main_intent': 'informational'},
    }
    item.update(overrides)
    return item


def labs_items(*keywords: str) -> list[dict[str, Any]]:
    """One default Labs item per keyword."""
    return [labs_item(keyword) for keyword in keywords]


def ads_item(keyword: str | None, volume: int | None = 1300, **overrides: Any) -> dict[str, Any]:
    """A Google Ads keyword item (items sit directly in ``task.result``)."""
    item: dict[str, Any] = {
        'keyword': keyword,
        'search_volume': volume,
        'cpc': 2.54,
        'competition': 'HIGH',
        'competition_index': 42,
        'monthly_searches': [{'year': 2026, 'month': 5, 'search_volume': volume}],
    }
    item.update(overrides)
    return item


def organic_item(rank_group: int | None, domain: str, **overrides: Any) -> dict[str, Any]:
    """An organic SERP item."""
    item: dict[str, Any] = {
        'type': 'organic',
        'rank_group': rank_group,
        'rank_absolute': (rank_group or 0) + 1,
        'domain': domain,
        'url': f'https://{domain}/page',
        'title': f'{domain} title',
        'description': f'{domain} description',
    }
    item.update(overrides)
    return item


def ai_overview_item(markdown: str | None, references: list[Any] | None = None,
                     sub_items: list[Any] | None = None) -> dict[str, Any]:
    """An ``ai_overview`` SERP item."""
    return {
        'type': 'ai_overview',
        'markdown': markdown,
        'references': references or [],
        'items': sub_items or [],
        'asynchronous_ai_overview': True,
    }


#: An overview citing two references (one nested) and carrying a link that is not a citation.
TRACKER_OVERVIEW = ai_overview_item(
    'Use Example Tracker.[[1]](https://tracker.example.com/blog)',
    references=[{'url': 'https://tracker.example.com/blog', 'title': 'Tracker blog'}],
    sub_items=[{
        'references': [{'url': 'https://analytics.example.org/docs'}],
        'links': [{'url': 'https://code.example.net/repo'}],
    }],
)


def serp_result(items: list[Any], **overrides: Any) -> dict[str, Any]:
    """``task.result[0]`` of an organic live/advanced call."""
    result: dict[str, Any] = {
        'keyword': 'example keyword',
        'check_url': 'https://www.google.com/search?q=example+keyword',
        'datetime': '2026-09-18 09:00:00 +00:00',
        'item_types': list(dict.fromkeys(item['type'] for item in items if isinstance(item, Mapping))),
        'items': items,
    }
    result.update(overrides)
    return result


def escape_keyword_fake(text: str) -> str:
    """The documented ``escape_keyword`` rule, for tests that patch the client."""
    return text.replace('%', '%25').replace('+', '%2B')


Responder = Callable[[str, dict[str, Any]], TaskResult]
Outcome = TaskResult | DataForSeoError


@dataclass
class PostLiveCall:
    """One recorded ``post_live`` call."""

    path: str
    task: dict[str, Any]
    options: dict[str, Any]


@dataclass
class FakePostLive:
    """Stands in for ``dataforseo_client.post_live``: answers by path (or in order) and records calls."""

    by_path: Mapping[str, Outcome | Responder] = field(default_factory=dict)
    sequence: list[Outcome] = field(default_factory=list)
    calls: list[PostLiveCall] = field(default_factory=list)

    def __call__(self, path: str, task: dict[str, Any], **options: Any) -> TaskResult:
        self.calls.append(PostLiveCall(path=path, task=task, options=options))
        outcome = self.sequence.pop(0) if self.sequence else self.by_path[path]
        if isinstance(outcome, DataForSeoError):
            raise outcome
        if isinstance(outcome, TaskResult):
            return outcome
        return outcome(path, task)

    def paths(self) -> list[str]:
        """The called paths, in call order."""
        return [call.path for call in self.calls]

    def task_for(self, path: str) -> dict[str, Any]:
        """The task body of the first call to ``path``."""
        return next(call.task for call in self.calls if call.path == path)


def recording_post_live_fixture():
    """A fixture yielding a ``FakePostLive`` in place of ``post_live``, with the documented ``escape_keyword`` rule.

    Assign it to a module attribute (``fake = recording_post_live_fixture()``); pytest registers it under that name.
    """
    @pytest.fixture
    def _recording_post_live() -> Iterator[FakePostLive]:
        post_live = FakePostLive()
        with patch.object(dataforseo_client, 'post_live', post_live), \
                patch.object(dataforseo_client, 'escape_keyword', escape_keyword_fake):
            yield post_live

    return _recording_post_live
