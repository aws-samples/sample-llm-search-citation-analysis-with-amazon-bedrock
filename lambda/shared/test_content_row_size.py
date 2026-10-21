"""fit_generation_result keeps a Content Studio row under the 400 KB item limit."""

from __future__ import annotations

from shared.content_row_size import CONTENT_TOO_LARGE_ERROR_TYPE, fit_generation_result
from testing.response_size import long_text

_IDEA = {"id": "idea-1", "keyword": "hotel en coruña"}


def test_returns_result_unchanged_when_row_fits() -> None:
    result = {"success": True, "content": {"body": "Texto"}, "raw_content": "Texto"}

    assert fit_generation_result(_IDEA, "generated", result) == ("generated", result)


def test_drops_raw_text_of_failed_result_when_it_would_overflow_the_row() -> None:
    result = {"success": False, "error": "Unparseable output", "raw_content": long_text(500_000)}

    assert fit_generation_result(_IDEA, "failed", result) == ("failed", {**result, "raw_content": ""})


def test_counts_stored_idea_towards_the_item_limit() -> None:
    idea = {**_IDEA, "brief": long_text(200_000)}
    result = {"success": True, "content": {"body": long_text(200_000)}, "raw_content": ""}

    status, fitted = fit_generation_result(idea, "generated", result)

    assert (status, fitted["error_type"]) == ("failed", CONTENT_TOO_LARGE_ERROR_TYPE)
