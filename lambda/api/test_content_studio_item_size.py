"""The worker keeps a Content Studio row under DynamoDB's 400 KB item limit.

Before the guard, a generation whose content plus raw model text plus stored
idea passed 400 KB made ``update_item`` fail: the result was lost and the row
stayed ``generating`` until the lease expired and the attempt was retried.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from shared.content_row_size import CONTENT_TOO_LARGE_ERROR_TYPE, ITEM_BUDGET_BYTES, stored_bytes
from testing.content_studio_fixtures import load_content_studio_module, patched_stream_worker, stream_worker_case
from testing.response_size import long_text

_mod = load_content_studio_module("content_studio_item_size_under_test")


def _generated(body_characters: int, raw_characters: int) -> dict[str, object]:
    return {
        "success": True,
        "content": {"title": "Guía de hoteles", "body": long_text(body_characters)},
        "raw_content": long_text(raw_characters),
        "model": "test-model",
        "competitor_sources_used": 1,
    }


def _run(generation_result: dict[str, object]) -> dict[str, object]:
    """Deliver one stream insert whose model answers ``generation_result``; return the stored row."""
    resource, rows, event = stream_worker_case()
    with patched_stream_worker(_mod, resource, MagicMock(return_value=generation_result)):
        _mod.handler(event, None)
    return rows["content-1"]


def test_keeps_raw_content_when_row_fits_the_item_limit() -> None:
    row = _run(_generated(2_000, 2_000))

    assert (row["status"], row["raw_content"]) == ("generated", long_text(2_000))


def test_drops_raw_content_first_when_row_would_exceed_the_item_limit() -> None:
    row = _run(_generated(150_000, 300_000))

    assert (row["status"], row["raw_content"]) == ("generated", "")
    assert stored_bytes(row) <= ITEM_BUDGET_BYTES


def test_fails_row_with_clear_reason_when_content_alone_exceeds_the_item_limit() -> None:
    row = _run(_generated(450_000, 10))

    assert (row["status"], row["generation_terminal_reason"]) == ("failed", CONTENT_TOO_LARGE_ERROR_TYPE)
    assert str(row["error_message"]).startswith("The generated content is too large to store")
    assert row["generated_content"] == {}
