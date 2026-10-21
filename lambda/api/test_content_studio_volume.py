"""Volume tests for GET /api/content-studio/history.

Before: ``limit`` up to 100 rows of the ALL-projection status index, each
with ``generated_content``, ``raw_content`` (up to 8,000 output tokens) and the
stored idea. With 25 KB of Spanish body, 25 KB of raw text and a 20 KB brief
per row, 100 rows came to about 9 MB of body (about 10.5 MB on the wire), far
over the 6 MiB Lambda cap. Now rows leave out the idea and raw text and each
page is cut to the 1 MB page budget, continued by ``next_token``.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from testing.content_studio_fixtures import content_studio_resource, load_content_studio_module
from testing.events import api_gateway_event, parse_response
from testing.response_size import assert_within_page_budget, long_text

_mod = load_content_studio_module("content_studio_volume_under_test")


def _row(index: int, status: str, *, body: int, raw: int, brief: int) -> dict[str, Any]:
    stamp = f"2026-09-{1 + index // 1440:02d}T{index // 60 % 24:02d}:{index % 60:02d}:00Z"
    return {
        "id": f"content-{status}-{index:04d}",
        "keyword": f"hotel en coruña {index}",
        "idea_title": f"Guía {index}",
        "content_angle": "create_new_landing_page",
        "status": status,
        "viewed": True,
        "created_at": stamp,
        "updated_at": stamp,
        "generation_transport": "dynamodb_stream_v1",
        "generated_content": {"title": f"Guía {index}", "body": long_text(body)},
        "raw_content": long_text(raw),
        "idea_data": {"id": f"idea-{index}", "brief": {"instructions": long_text(brief)}},
    }


def _status_table(rows: list[dict[str, Any]]) -> MagicMock:
    """A content table whose StatusCreatedIndex queries honour Limit and ExclusiveStartKey."""
    by_status: dict[str, list[dict[str, Any]]] = {}
    for row in sorted(rows, key=lambda item: item["created_at"], reverse=True):
        by_status.setdefault(row["status"], []).append(row)

    def query(**params: Any) -> dict[str, Any]:
        if params.get("Select") == "COUNT":
            return {"Count": 0}
        status = params["KeyConditionExpression"].get_expression()["values"][1]
        items = by_status.get(status, [])
        start = 0
        if "ExclusiveStartKey" in params:
            start = [item["id"] for item in items].index(params["ExclusiveStartKey"]["id"]) + 1
        page = items[start:start + params["Limit"]]
        response: dict[str, Any] = {"Items": [dict(item) for item in page]}
        if start + len(page) < len(items):
            last = page[-1]
            response["LastEvaluatedKey"] = {"id": last["id"], "status": status, "created_at": last["created_at"]}
        return response

    table = MagicMock()
    table.query.side_effect = query
    return table


def _get(table: MagicMock, query: dict[str, str]) -> dict[str, Any]:
    event = api_gateway_event("GET", "/content-studio/history", query=query)
    with patch.object(_mod, "dynamodb", content_studio_resource(content_table=table)):
        return _mod._api_handler(event, None)


_STATUSES = ("pending", "generating", "generated", "failed")


@pytest.fixture(scope="module")
def heavy_rows() -> list[dict[str, Any]]:
    return [_row(index, _STATUSES[index % 4], body=25_000, raw=25_000, brief=20_000) for index in range(400)]


def test_stays_within_page_budget_when_history_rows_are_large(heavy_rows: list[dict[str, Any]]) -> None:
    response = _get(_status_table(heavy_rows), {"limit": "100"})

    assert_within_page_budget(response)


def test_continues_with_next_token_when_page_budget_cuts_the_page(heavy_rows: list[dict[str, Any]]) -> None:
    _status, body = parse_response(_get(_status_table(heavy_rows), {"limit": "100"}))

    assert 0 < len(body["history"]) < 100
    assert body["next_token"] is not None


def test_leaves_out_idea_and_raw_text_when_rows_are_listed(heavy_rows: list[dict[str, Any]]) -> None:
    _status, body = parse_response(_get(_status_table(heavy_rows), {"limit": "5"}))

    assert [sorted(set(item) & {"idea_data", "raw_content"}) for item in body["history"]] == [[]] * 5


@settings(max_examples=25, deadline=None)
@given(
    st.lists(st.sampled_from(_STATUSES), max_size=40),
    st.integers(min_value=1, max_value=9),
)
def test_following_next_token_returns_every_row_once_newest_first(statuses: list[str], limit: int) -> None:
    rows = [_row(index, status, body=10, raw=10, brief=10) for index, status in enumerate(statuses)]
    table = _status_table(rows)
    collected: list[str] = []
    query: dict[str, str] = {"limit": str(limit)}
    for _page in range(200):
        _status, body = parse_response(_get(table, query))
        collected.extend(item["id"] for item in body["history"])
        if body["next_token"] is None:
            break
        query = {"limit": str(limit), "next_token": body["next_token"]}

    expected = [row["id"] for row in sorted(rows, key=lambda row: row["created_at"], reverse=True)]
    assert collected == expected


def test_rejects_malformed_next_token_with_400() -> None:
    status, body = parse_response(_get(_status_table([]), {"next_token": "e30"}))

    assert (status, body) == (400, {"error": "Invalid next_token", "field": "next_token"})
