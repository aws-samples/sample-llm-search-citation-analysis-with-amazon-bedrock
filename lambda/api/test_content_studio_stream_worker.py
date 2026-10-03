"""Durable DynamoDB Stream lifecycle tests for Content Studio generation."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock, call, patch

import pytest

from testing.content_studio_fixtures import (
    CONTENT_STUDIO_TABLE_NAME,
    ReconcileWorkerRun,
    load_content_studio_module,
    patched_stream_worker,
    pending_recovery_row,
    run_reconcile_worker,
    run_stream_worker,
    stream_insert_event,
    stream_worker_case,
)

_mod = load_content_studio_module("content_studio_stream_worker_under_test")

_BRAND_CONFIG = {"name": "Test Brand"}
_GENERATED = {
    "success": True,
    "content": {"title": "Generated title"},
    "raw_content": "Generated body",
    "model": "test-model",
    "competitor_sources_used": 2,
}
_MODEL_FAILURE = {
    "success": False,
    "error": "The model could not generate content.",
    "error_type": "generation",
}
_CLAIM_CONDITION = (
    "(#status = :pending OR "
    "(#status = :generating AND generation_owner = :owner AND "
    "(attribute_not_exists(generation_lease_expires_at) OR "
    "generation_lease_expires_at <= :now))) AND "
    "(attribute_not_exists(generation_attempts) OR "
    "generation_attempts < :max_attempts)"
)
_NO_FAILURES = {"batchItemFailures": []}


class UnexpectedGenerationError(RuntimeError):
    """An unexpected worker failure used to exercise stream retry behavior."""


def _row_fields(rows: dict[str, dict[str, Any]], expected: dict[str, object]) -> dict[str, object]:
    """The stored content row narrowed to the fields a case expects."""
    return {name: rows["content-1"][name] for name in expected}


def _deliver(resource: MagicMock, event: dict[str, Any], *, times: int = 1) -> MagicMock:
    """Deliver one stream event `times` times to a worker whose model succeeds; return the model spy."""
    generation = MagicMock(return_value=_GENERATED)
    with patched_stream_worker(_mod, resource, generation):
        for _ in range(times):
            _mod.handler(event, None)
    return generation


def _run_legacy_generation(**idea_overrides: object) -> tuple[dict[str, Any], dict[str, dict[str, Any]], MagicMock]:
    """Run a forwarded legacy generation event whose idea is the saved idea plus overrides."""
    resource, rows, _ = stream_worker_case()
    generation = MagicMock(return_value=_GENERATED)
    event = {
        "legacy_generation": True,
        "content_id": "content-1",
        "idea": {**rows["content-1"]["idea_data"], **idea_overrides},
    }

    with patched_stream_worker(_mod, resource, generation):
        result = _mod.handler(event, None)
    return result, rows, generation


def _recovery_payload(row: dict[str, Any]) -> dict[str, object]:
    """The worker payload scheduled recovery sends for one recoverable row."""
    return {
        "action": "generate",
        "content_id": row["id"],
        "idea": row["idea_data"],
        "generation_owner": "reconcile:recovery-id",
    }


def _reconcile(
    candidates: list[dict[str, Any]],
    *,
    pending: list[dict[str, Any]] | None = None,
    generating: list[dict[str, Any]] | None = None,
) -> ReconcileWorkerRun:
    """Reconcile `candidates` with one pending page then one generating page."""
    return run_reconcile_worker(
        _mod,
        candidates,
        [{"Items": pending or []}, {"Items": generating or []}],
    )


def _generating_recovery_row(owner: str, lease_expires_at: int) -> dict[str, Any]:
    """A first-attempt row a worker owns under the given lease."""
    return {
        **pending_recovery_row("content-1"),
        "status": "generating",
        "generation_attempts": 1,
        "generation_owner": owner,
        "generation_lease_expires_at": lease_expires_at,
    }


@pytest.mark.parametrize(
    ("generation_result", "run_options", "expected_row", "model_calls"),
    [
        (
            _GENERATED,
            {},
            {"status": "generated", "generated_content": {"title": "Generated title"}, "generation_attempts": 1},
            1,
        ),
        (
            _GENERATED,
            {
                "event_id": "timed-out-event",
                "current_status": "generating",
                "current_owner": "timed-out-event",
                "current_attempts": 1,
                "current_lease_expires_at": 1,
            },
            {"status": "generated", "generation_attempts": 2},
            1,
        ),
        (
            _MODEL_FAILURE,
            {},
            {
                "status": "failed",
                "error_message": "The model could not generate content.",
                "generation_terminal_reason": "generation",
            },
            1,
        ),
        (
            _GENERATED,
            {
                "event_id": "final-event",
                "current_attempts": 2,
                "generation_side_effect": UnexpectedGenerationError("third crash"),
            },
            {"status": "failed", "generation_attempts": 3, "generation_terminal_reason": "max_attempts_exhausted"},
            1,
        ),
        (_GENERATED, {"current_status": "failed"}, {"status": "failed"}, 0),
        (
            _GENERATED,
            {
                "event_id": "active-event",
                "current_status": "generating",
                "current_owner": "active-event",
                "current_attempts": 1,
                "current_lease_expires_at": 9_999_999_999,
            },
            {"status": "generating", "generation_attempts": 1},
            0,
        ),
        (
            _GENERATED,
            {
                "event_id": "new-event",
                "current_status": "generating",
                "current_owner": "original-event",
                "current_attempts": 1,
                "current_lease_expires_at": 1,
            },
            {"generation_owner": "original-event", "generation_attempts": 1},
            0,
        ),
        (_GENERATED, {"current_attempts": 3}, {"status": "pending", "generation_attempts": 3}, 0),
        (_GENERATED, {"event_status": "generated"}, {"status": "pending"}, 0),
        (_GENERATED, {"event_transport": None}, {"status": "pending"}, 0),
        (_GENERATED, {"event_transport": "dynamodb_stream"}, {"status": "pending"}, 0),
    ],
    ids=[
        "persists_generated_result_for_pending_insert",
        "resumes_same_owner_when_existing_lease_has_expired",
        "marks_row_failed_with_reason_when_model_returns_normal_failure",
        "terminalizes_row_when_third_unexpected_attempt_crashes",
        "skips_model_when_row_is_terminally_failed",
        "skips_model_when_same_owner_lease_remains_active",
        "skips_model_when_different_event_owns_inflight_row",
        "skips_model_when_pending_row_already_reached_attempt_cap",
        "skips_model_when_insert_image_was_not_pending",
        "skips_model_when_transport_marker_is_missing",
        "skips_model_when_transport_marker_is_unversioned",
    ],
)
def test_acknowledges_event_and_settles_row_as_the_claim_rules_dictate(
    generation_result: dict[str, Any],
    run_options: dict[str, Any],
    expected_row: dict[str, object],
    model_calls: int,
) -> None:
    run = run_stream_worker(_mod, generation_result, **run_options)

    assert run.response == _NO_FAILURES
    assert _row_fields(run.rows, expected_row) == expected_row
    assert run.generation.call_args_list == [call(run.rows["content-1"]["idea_data"], _BRAND_CONFIG)] * model_calls


def test_uses_saved_template_snapshot_when_stream_insert_is_processed() -> None:
    resource, rows, _ = stream_worker_case()
    snapshot = {
        **rows["content-1"]["idea_data"],
        "template_id": "template-1",
        "template_name": "Saved template",
        "template_modified": False,
        "prompt_template": "Saved prompt for {scope} and {keywords}.",
    }
    rows["content-1"]["idea_data"] = snapshot
    event = stream_insert_event(rows["content-1"])

    generation = _deliver(resource, event)

    generation.assert_called_once_with(snapshot, _BRAND_CONFIG)


def test_claims_pending_row_with_owner_lease_and_first_attempt() -> None:
    run = run_stream_worker(_mod, _GENERATED, event_id="stable-event-id")

    table = run.resource.Table(CONTENT_STUDIO_TABLE_NAME)
    claim = table.update_item.call_args_list[0].kwargs
    values = claim["ExpressionAttributeValues"]
    assert claim["ConditionExpression"] == _CLAIM_CONDITION
    assert values[":owner"] == "stable-event-id"
    assert values[":max_attempts"] == 3
    assert values[":lease_expires_at"] - values[":now"] == 360


def test_skips_duplicate_delivery_when_first_delivery_generated_content() -> None:
    resource, rows, event = stream_worker_case()

    generation = _deliver(resource, event, times=2)

    generation.assert_called_once_with(rows["content-1"]["idea_data"], _BRAND_CONFIG)
    assert rows["content-1"]["status"] == "generated"


def test_returns_row_to_pending_when_processing_crashes_before_attempt_cap() -> None:
    resource, rows, event = stream_worker_case(event_id="retryable-event")
    generation = MagicMock(side_effect=UnexpectedGenerationError("worker crashed"))

    with patched_stream_worker(_mod, resource, generation), pytest.raises(
        UnexpectedGenerationError,
        match="worker crashed",
    ):
        _mod.handler(event, None)

    assert rows["content-1"]["status"] == "pending"
    assert rows["content-1"]["generation_owner"] == "retryable-event"
    assert rows["content-1"]["generation_attempts"] == 1
    assert "generation_lease_expires_at" not in rows["content-1"]


def test_generates_content_when_same_event_retries_after_crash() -> None:
    resource, rows, event = stream_worker_case(event_id="retryable-event")
    generation = MagicMock(
        side_effect=[UnexpectedGenerationError("worker crashed"), _GENERATED]
    )

    with patched_stream_worker(_mod, resource, generation):
        with pytest.raises(UnexpectedGenerationError, match="worker crashed"):
            _mod.handler(event, None)
        result = _mod.handler(event, None)

    assert result == _NO_FAILURES
    assert rows["content-1"]["status"] == "generated"
    assert rows["content-1"]["generation_attempts"] == 2
    assert generation.call_count == 2


def test_forwards_old_async_event_to_worker_without_running_model() -> None:
    resource, rows, _ = stream_worker_case()
    generation = MagicMock(return_value=_GENERATED)
    lambda_client = MagicMock()
    lambda_client.invoke.return_value = {"StatusCode": 202}
    event = {
        "async_generation": True,
        "content_id": "content-1",
        "idea": rows["content-1"]["idea_data"],
    }
    expected_payload = json.dumps(
        {
            "legacy_generation": True,
            "content_id": "content-1",
            "idea": rows["content-1"]["idea_data"],
        },
        separators=(",", ":"),
    ).encode()

    with (
        patched_stream_worker(_mod, resource, generation),
        patch.object(_mod.boto3, "client", return_value=lambda_client),
    ):
        result = _mod.handler(event, None)

    assert result == {"statusCode": 202, "body": "Legacy generation forwarded"}
    lambda_client.invoke.assert_called_once_with(
        FunctionName="CitationAnalysis-ContentStudioWorker",
        InvocationType="Event",
        Payload=expected_payload,
    )
    generation.assert_not_called()


@pytest.mark.parametrize(
    ("content_id", "idea"),
    [
        ("   ", {"keyword": "Keyword one"}),
        ("content-1", {}),
    ],
    ids=["blank-content-id", "empty-idea"],
)
def test_rejects_invalid_old_async_event_without_invoking_worker(
    content_id: str,
    idea: dict[str, str],
) -> None:
    lambda_client = MagicMock()

    with patch.object(_mod.boto3, "client", return_value=lambda_client):
        result = _mod.handler(
            {"async_generation": True, "content_id": content_id, "idea": idea},
            None,
        )

    assert result == {"statusCode": 400, "body": "Invalid async event"}
    lambda_client.invoke.assert_not_called()


def test_processes_forwarded_legacy_generation_in_worker() -> None:
    result, rows, generation = _run_legacy_generation()

    assert result == {"statusCode": 200, "body": "Generation processing completed"}
    assert rows["content-1"]["status"] == "generated"
    assert rows["content-1"]["generation_owner"] == "legacy:content-1"
    generation.assert_called_once_with(rows["content-1"]["idea_data"], _BRAND_CONFIG)


def test_rejects_forwarded_generation_when_idea_differs_from_saved_row() -> None:
    result, rows, generation = _run_legacy_generation(keyword="Changed")

    assert result == {"statusCode": 400, "body": "Invalid generation event"}
    assert rows["content-1"]["status"] == "pending"
    generation.assert_not_called()


def test_dispatches_old_pending_row_without_original_stream_record() -> None:
    row = pending_recovery_row("content-1")
    run = _reconcile([row], pending=[row])

    assert run.response == {"dispatched": 1, "terminalized": 0}
    run.lambda_client.invoke.assert_called_once_with(
        FunctionName="CitationAnalysis-ContentStudioWorker",
        InvocationType="Event",
        Payload=json.dumps(_recovery_payload(run.rows["content-1"]), separators=(",", ":")).encode(),
    )
    assert run.table.query.call_count == 2


def test_pages_past_nonmatching_old_rows_to_find_versioned_recovery() -> None:
    row = pending_recovery_row("content-1")
    run = run_reconcile_worker(
        _mod,
        [row],
        [
            {"Items": [], "LastEvaluatedKey": {"id": "old-row"}},
            {"Items": [row]},
            {"Items": []},
        ],
    )

    assert run.response == {"dispatched": 1, "terminalized": 0}
    assert run.table.query.call_args_list[1].kwargs["ExclusiveStartKey"] == {
        "id": "old-row"
    }
    run.lambda_client.invoke.assert_called_once()


def test_persists_next_page_when_bounded_window_contains_only_legacy_rows() -> None:
    row = pending_recovery_row("content-1")
    legacy_pages = [
        {
            "Items": [],
            "LastEvaluatedKey": {
                "status": "pending",
                "created_at": f"2020-01-01T00:00:{index:02d}Z",
                "id": f"legacy-{index}",
            },
        }
        for index in range(10)
    ]
    run = run_reconcile_worker(
        _mod,
        [row],
        [*legacy_pages, {"Items": []}],
    )

    expected_cursor = legacy_pages[-1]["LastEvaluatedKey"]
    assert run.response == {"dispatched": 0, "terminalized": 0}
    assert run.rows[_mod._RECONCILIATION_CURSOR_ID]["pending_cursor"] == (
        expected_cursor
    )
    run.lambda_client.invoke.assert_not_called()


def test_dispatches_versioned_row_when_saved_page_follows_legacy_window() -> None:
    row = pending_recovery_row("content-1")
    cursor = {
        "status": "pending",
        "created_at": "2020-01-01T00:00:09Z",
        "id": "legacy-9",
    }
    cursor_row = {
        "id": _mod._RECONCILIATION_CURSOR_ID,
        "pending_cursor": cursor,
    }
    run = _reconcile([row, cursor_row], pending=[row])

    assert run.response == {"dispatched": 1, "terminalized": 0}
    assert run.table.query.call_args_list[0].kwargs["ExclusiveStartKey"] == cursor
    assert json.loads(run.lambda_client.invoke.call_args.kwargs["Payload"]) == _recovery_payload(row)


def test_dispatches_at_most_ten_recoverable_rows_per_reconcile() -> None:
    pending = [pending_recovery_row(f"content-{index:02d}") for index in range(12)]
    run = _reconcile(pending, pending=pending)

    assert run.response == {"dispatched": 10, "terminalized": 0}
    assert run.lambda_client.invoke.call_count == 10


def test_releases_expired_generating_lease_before_recovery_dispatch() -> None:
    row = _generating_recovery_row("timed-out-owner", 1)
    run = _reconcile([row], generating=[row])

    assert run.response == {"dispatched": 1, "terminalized": 0}
    assert run.rows["content-1"]["status"] == "pending"
    assert "generation_lease_expires_at" not in run.rows["content-1"]
    run.lambda_client.invoke.assert_called_once()


def test_leaves_active_generating_lease_untouched() -> None:
    row = _generating_recovery_row("active-owner", 9_999_999_999)
    run = _reconcile([row], generating=[row])

    assert run.response == {"dispatched": 0, "terminalized": 0}
    assert run.rows["content-1"]["status"] == "generating"
    run.lambda_client.invoke.assert_not_called()


def test_terminalizes_exhausted_pending_row_without_model_dispatch() -> None:
    row = {**pending_recovery_row("content-1"), "generation_attempts": 3}
    run = _reconcile([row], pending=[row])

    assert run.response == {"dispatched": 0, "terminalized": 1}
    assert run.rows["content-1"]["status"] == "failed"
    assert run.rows["content-1"]["generation_terminal_reason"] == (
        "max_attempts_exhausted"
    )
    run.lambda_client.invoke.assert_not_called()


@pytest.mark.parametrize(
    ("row", "page"),
    [
        ({**pending_recovery_row("content-1"), "generation_attempts": 3}, "pending"),
        (_generating_recovery_row("timed-out-owner", 1), "generating"),
    ],
    ids=["terminalize_exhausted", "release_expired_lease"],
)
def test_recovery_update_aliases_status_attribute_name(row: dict[str, Any], page: str) -> None:
    run = _reconcile([row], **{page: [row]})

    content_updates = [
        update.kwargs["ExpressionAttributeNames"]
        for update in run.table.update_item.call_args_list
        if update.kwargs["Key"] == {"id": "content-1"}
    ]
    assert content_updates == [{"#status": "status"}]
